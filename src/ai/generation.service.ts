import { Injectable, Logger } from "@nestjs/common";
import { StudioJob } from "@prisma/client";
import { Database } from "../infrastructure/database";
import { Facts } from "./content";
import { costMicros, openAIConfig, OpenAIConfig } from "./config";
import {
  callOpenAI,
  GenerationError,
  parseCopy,
  POLICY_VERSION,
  PROMPT_VERSION,
  responseRequest,
} from "./openai";

@Injectable()
export class OpenAIGeneration {
  private readonly logger = new Logger(OpenAIGeneration.name);
  private failures = 0;
  private unavailableUntil = 0;
  constructor(private readonly db: Database) {}

  private async reserve(
    job: StudioJob,
    config: OpenAIConfig,
    request: ReturnType<typeof responseRequest>,
  ) {
    // UTF-8 bytes plus framing/schema headroom conservatively bound input tokens.
    const bytes = Buffer.byteLength(JSON.stringify(request));
    if (bytes > 32000)
      throw new GenerationError(
        "needs_input",
        "Shorten the product facts before generating.",
      );
    const reservedMicros = costMicros(
      bytes + 2048,
      config.maxOutputTokens,
      config,
    );
    const day = new Date().toISOString().slice(0, 10);
    return this.db.$transaction(async (tx) => {
      const current = await tx.studioJob.findFirst({
        where: {
          id: job.id,
          status: "running",
          leaseToken: job.leaseToken,
          leaseUntil: { gt: new Date() },
        },
      });
      if (!current)
        throw new GenerationError(
          "unavailable",
          "This generation request expired.",
        );
      await tx.aiBudgetDay.upsert({
        where: { date: day },
        create: { date: day },
        update: {},
      });
      await tx.$queryRaw`SELECT date FROM "AiBudgetDay" WHERE date = ${day} FOR UPDATE`;
      const budget = await tx.aiBudgetDay.findUniqueOrThrow({
        where: { date: day },
      });
      const exposure =
        budget.spentMicros + budget.reservedMicros + reservedMicros;
      if (exposure > config.dailyBudgetMicros)
        throw new GenerationError(
          "budget",
          "AI has reached its daily spending allowance. Saved work and manual drafts remain available.",
        );
      const warn =
        !budget.alerted && exposure * 100n >= config.dailyBudgetMicros * 80n;
      await tx.aiBudgetDay.update({
        where: { date: day },
        data: {
          reservedMicros: { increment: reservedMicros },
          ...(warn ? { alerted: true } : {}),
        },
      });
      if (warn) this.logger.warn("AI_DAILY_BUDGET_80_PERCENT");
      return tx.aiAttempt.create({
        data: {
          jobId: job.id,
          day,
          model: config.model,
          promptVersion: PROMPT_VERSION,
          policyVersion: POLICY_VERSION,
          priceVersion: config.priceVersion,
          inputRate: config.inputRate,
          outputRate: config.outputRate,
          reservedMicros,
        },
      });
    });
  }

  async generate(job: StudioJob): Promise<string[]> {
    const config = openAIConfig();
    if (!config || config.model !== job.model)
      throw new GenerationError(
        "unavailable",
        "AI configuration changed or is incomplete. Start a new request after setup is complete.",
      );
    if (Date.now() < this.unavailableUntil)
      throw new GenerationError(
        "unavailable",
        "AI is recovering from an outage. Try later or write a manual draft.",
      );
    const facts = job.facts as unknown as Facts;
    const count = facts.plannedDate ? 1 : 3;
    for (let repair = 0; repair < 2; repair++) {
      const request = responseRequest(config, facts, count, repair === 1);
      const attempt = await this.reserve(job, config, request);
      const started = Date.now();
      const result = await callOpenAI(config, request);
      let error = result.error,
        texts: string[] | undefined;
      if (!error) {
        try {
          texts = parseCopy(result.value, facts, count);
        } catch (e) {
          error =
            e instanceof GenerationError
              ? e
              : new GenerationError(
                  "invalid",
                  "The AI output could not be validated.",
                );
        }
      }
      // Missing usage (including uncertain timeouts) retains the full cost reservation.
      const knownUsage =
        result.inputTokens !== null && result.outputTokens !== null;
      const actual = knownUsage
        ? costMicros(result.inputTokens!, result.outputTokens!, config)
        : null;
      await this.db.$transaction(async (tx) => {
        const settled = await tx.aiAttempt.updateMany({
          where: { id: attempt.id, status: "pending" },
          data: {
            status: knownUsage ? (error?.code ?? "succeeded") : "unknown",
            costMicros: actual,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            providerRequestId: result.requestId,
            providerResponseId: result.responseId,
            actualModel: result.model,
            latencyMs: Date.now() - started,
            settledAt: new Date(),
          },
        });
        if (settled.count && actual !== null)
          await tx.aiBudgetDay.update({
            where: { date: attempt.day },
            data: {
              reservedMicros: { decrement: attempt.reservedMicros },
              spentMicros: { increment: actual },
            },
          });
      });
      if (error?.code === "provider_error" || error?.code === "timeout") {
        if (++this.failures >= 3) {
          this.unavailableUntil = Date.now() + 60000;
          this.logger.warn("AI_PROVIDER_CIRCUIT_OPEN");
        }
      } else this.failures = 0;
      if (!error && texts) return texts;
      if (error?.code !== "invalid" || repair === 1) throw error;
    }
    throw new GenerationError(
      "invalid",
      "The AI output could not be validated.",
    );
  }
}
