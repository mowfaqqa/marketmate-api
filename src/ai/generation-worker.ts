import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Database } from "../infrastructure/database";
import { Facts, localSamples } from "./content";
import { generationMode } from "./config";
import { OpenAIGeneration } from "./generation.service";
import { GenerationError } from "./openai";

@Injectable()
export class GenerationWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(GenerationWorker.name);
  constructor(
    private readonly db: Database,
    private readonly openai: OpenAIGeneration,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.tick().catch(() =>
          this.logger.error("GENERATION_WORKER_FAILURE"),
        ),
      1000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  private async settlePlans() {
    const plans = await this.db.marketingPlan.findMany({
      where: { status: "pending" },
      take: 100,
      orderBy: { createdAt: "asc" },
      include: { generationJobs: { select: { status: true } } },
    });
    for (const plan of plans) {
      if (
        plan.generationJobs.length !== 7 ||
        plan.generationJobs.some((job) =>
          ["pending", "running"].includes(job.status),
        )
      )
        continue;
      const completed = plan.generationJobs.filter(
        (job) => job.status === "ready",
      ).length;
      await this.db.marketingPlan.updateMany({
        where: { id: plan.id, status: "pending" },
        data: {
          status: completed === 7 ? "ready" : completed ? "partial" : "failed",
        },
      });
    }
  }
  private async claim() {
    // Inspect a bounded queue and skip busy businesses, allowing other owners to proceed.
    const candidates = await this.db.studioJob.findMany({
      where: { status: "pending", archived: false },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true, businessId: true },
    });
    for (const candidate of candidates) {
      const claimed = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${candidate.businessId} FOR UPDATE`;
        if (
          (await tx.studioJob.count({
            where: { businessId: candidate.businessId, status: "running" },
          })) >= 2
        )
          return null;
        const token = randomUUID();
        const result = await tx.studioJob.updateMany({
          where: {
            id: candidate.id,
            status: "pending",
            archived: false,
            createdAt: { gt: new Date(Date.now() - 600000) },
          },
          data: {
            status: "running",
            leaseToken: token,
            leaseUntil: new Date(Date.now() + 120000),
          },
        });
        return result.count
          ? tx.studioJob.findUniqueOrThrow({ where: { id: candidate.id } })
          : null;
      });
      if (claimed) return claimed;
    }
    return null;
  }
  private async processNext() {
    const job = await this.claim();
    if (!job) return;
    try {
      let texts: string[];
      if (job.provider === "local" && generationMode() === "local")
        texts = localSamples(job.facts as unknown as Facts);
      else if (job.provider === "openai")
        texts = await this.openai.generate(job);
      else
        throw new GenerationError(
          "unavailable",
          "The selected generator is unavailable. Start a new request.",
        );
      await this.db.$transaction(async (tx) => {
        const settled = await tx.studioJob.updateMany({
          where: { id: job.id, status: "running", leaseToken: job.leaseToken },
          data: { status: "ready", error: null, leaseUntil: null },
        });
        if (settled.count)
          await tx.studioDraft.createMany({
            data: texts.map((text, index) => ({
              jobId: job.id,
              variant: index + 1,
              revision: 1,
              text,
            })),
          });
      });
    } catch (error) {
      const status =
        error instanceof GenerationError &&
        ["blocked", "needs_input"].includes(error.code)
          ? error.code
          : "failed";
      const message =
        error instanceof GenerationError
          ? error.message
          : "Generation failed. No user unit was charged. Try again or use a manual draft.";
      await this.db.studioJob.updateMany({
        where: { id: job.id, status: "running", leaseToken: job.leaseToken },
        data: { status, error: message, leaseUntil: null },
      });
    }
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.studioJob.updateMany({
        where: {
          OR: [
            { status: "running", leaseUntil: { lt: new Date() } },
            {
              status: { in: ["pending", "running"] },
              createdAt: { lt: new Date(Date.now() - 600000) },
            },
          ],
        },
        data: {
          status: "expired",
          error:
            "Generation expired. Your unit reservation was released. Start a new request.",
          leaseUntil: null,
        },
      });
      // Do not replay an uncertain provider request after a crash. Budget holds remain conservative.
      await this.db.aiAttempt.updateMany({
        where: {
          status: "pending",
          createdAt: { lt: new Date(Date.now() - 120000) },
        },
        data: { status: "unknown", settledAt: new Date() },
      });
      await this.settlePlans();
      await Promise.all([this.processNext(), this.processNext()]);
      await this.settlePlans();
    } finally {
      this.running = false;
    }
  }
}
