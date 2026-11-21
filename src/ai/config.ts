export type OpenAIConfig = {
  key: string;
  model: string;
  dailyBudgetMicros: bigint;
  inputRate: number;
  outputRate: number;
  priceVersion: string;
  maxOutputTokens: number;
  timeoutMs: number;
};
/** No model, price or spend approval is guessed. Empty configuration keeps live generation off. */
export function openAIConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIConfig | null {
  if (
    env.AI_PROVIDER !== "openai" ||
    !env.OPENAI_API_KEY ||
    !env.OPENAI_MODEL?.trim() ||
    !env.AI_PRICE_VERSION?.trim()
  )
    return null;
  const daily = Number(env.AI_DAILY_BUDGET_USD),
    inputRate = Number(env.OPENAI_INPUT_USD_PER_MILLION),
    outputRate = Number(env.OPENAI_OUTPUT_USD_PER_MILLION);
  const maxOutputTokens = Number(env.AI_MAX_OUTPUT_TOKENS || 1600),
    timeoutMs = Number(env.AI_TIMEOUT_MS || 30000);
  if (
    ![daily, inputRate, outputRate].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 100000,
    ) ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 256 ||
    maxOutputTokens > 4096 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 30000
  )
    return null;
  return {
    key: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL.trim(),
    dailyBudgetMicros: BigInt(Math.floor(daily * 1e6)),
    inputRate,
    outputRate,
    priceVersion: env.AI_PRICE_VERSION.trim(),
    maxOutputTokens,
    timeoutMs,
  };
}
export function generationMode(
  env: NodeJS.ProcessEnv = process.env,
): "local" | "openai" | "disabled" {
  if (env.STUDIO_LOCAL_GENERATOR === "true" && env.NODE_ENV !== "production")
    return "local";
  return openAIConfig(env) ? "openai" : "disabled";
}
export function costMicros(
  inputTokens: number,
  outputTokens: number,
  config: Pick<OpenAIConfig, "inputRate" | "outputRate">,
): bigint {
  return BigInt(
    Math.ceil(
      inputTokens * config.inputRate + outputTokens * config.outputRate,
    ),
  );
}
