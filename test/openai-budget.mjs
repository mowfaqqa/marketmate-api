import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { OpenAIGeneration } = require("../dist/ai/generation.service.js");
const env = {
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-key",
  OPENAI_MODEL: "synthetic-model",
  AI_DAILY_BUDGET_USD: "1",
  OPENAI_INPUT_USD_PER_MILLION: "0.25",
  OPENAI_OUTPUT_USD_PER_MILLION: "1",
  AI_PRICE_VERSION: "synthetic-price",
};
const originals = Object.fromEntries(
  Object.keys(env).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, env);
const facts = {
  product: "Cotton shirt",
  description: "A cotton shirt.",
  brand: "Sample Shop",
  contact: "+2348000000000",
  price: 250000,
  expires: null,
  goal: "inquiries",
  channel: "instagram",
  tone: "friendly",
  policy: 2,
  productVersion: 0,
  businessVersion: 0,
};
const job = {
  id: "test-job",
  businessId: "test-business",
  status: "running",
  model: "synthetic-model",
  leaseToken: "test-lease",
  leaseUntil: new Date(Date.now() + 120000),
  facts,
};
const valid = {
  status: "ok",
  variants: [
    "Discover our cotton shirt.",
    "Ask about our cotton shirt.",
    "Explore our cotton shirt.",
  ].map((body) => ({
    hook: "",
    body,
    cta: "",
    hashtags: [],
    used_fact_ids: ["product_name"],
  })),
  warning_codes: [],
  missing_fields: [],
};
function envelope(value) {
  return new Response(
    JSON.stringify({
      id: "resp_synthetic",
      status: "completed",
      model: "synthetic-model",
      usage: { input_tokens: 100, output_tokens: 80 },
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: typeof value === "string" ? value : JSON.stringify(value),
            },
          ],
        },
      ],
    }),
  );
}
function fakeLedger() {
  const budget = {
    date: new Date().toISOString().slice(0, 10),
    reservedMicros: 0n,
    spentMicros: 0n,
    alerted: false,
  };
  const attempts = [];
  const db = {
    $transaction: async (fn) => fn(db),
    $queryRaw: async () => [],
    studioJob: { findFirst: async () => job },
    aiBudgetDay: {
      upsert: async () => budget,
      findUniqueOrThrow: async () => budget,
      update: async ({ data }) => {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "object") {
            if ("increment" in value) budget[key] += value.increment;
            if ("decrement" in value) budget[key] -= value.decrement;
          } else budget[key] = value;
        }
        return budget;
      },
    },
    aiAttempt: {
      create: async ({ data }) => {
        const attempt = {
          ...data,
          id: `attempt-${attempts.length}`,
          status: "pending",
        };
        attempts.push(attempt);
        return attempt;
      },
      updateMany: async ({ where, data }) => {
        const attempt = attempts.find(
          (value) => value.id === where.id && value.status === where.status,
        );
        if (!attempt) return { count: 0 };
        Object.assign(attempt, data);
        return { count: 1 };
      },
    },
  };
  return { db, budget, attempts };
}
const originalFetch = globalThis.fetch;
try {
  let ledger = fakeLedger(),
    calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return envelope(valid);
  };
  assert.equal((await new OpenAIGeneration(ledger.db).generate(job)).length, 3);
  assert.equal(calls, 1);
  assert.equal(ledger.budget.spentMicros, 105n);
  assert.equal(ledger.budget.reservedMicros, 0n);
  assert.equal(ledger.attempts[0].status, "succeeded");
  ledger = fakeLedger();
  calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 2)
      assert.match(
        JSON.parse(options.body).instructions,
        /previous response failed validation/,
      );
    return envelope(calls === 1 ? "malformed" : valid);
  };
  await new OpenAIGeneration(ledger.db).generate(job);
  assert.equal(calls, 2);
  assert.equal(ledger.budget.spentMicros, 210n);
  assert.equal(ledger.attempts[0].status, "invalid");
  ledger = fakeLedger();
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return envelope("malformed");
  };
  await assert.rejects(
    new OpenAIGeneration(ledger.db).generate(job),
    (e) => e.code === "invalid",
  );
  assert.equal(calls, 2);
  assert.equal(ledger.attempts.length, 2);
  ledger = fakeLedger();
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("private error", { status: 429 });
  };
  await assert.rejects(
    new OpenAIGeneration(ledger.db).generate(job),
    (e) => e.code === "provider_error",
  );
  assert.equal(calls, 1);
  assert.equal(ledger.budget.spentMicros, 0n);
  assert.ok(ledger.budget.reservedMicros > 0n);
  assert.equal(ledger.attempts[0].status, "unknown");
  ledger = fakeLedger();
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new DOMException("test timeout", "TimeoutError");
  };
  await assert.rejects(
    new OpenAIGeneration(ledger.db).generate(job),
    (e) => e.code === "timeout",
  );
  assert.equal(calls, 1);
  assert.ok(ledger.budget.reservedMicros > 0n);
  ledger = fakeLedger();
  calls = 0;
  process.env.AI_DAILY_BUDGET_USD = "0.000001";
  globalThis.fetch = async () => {
    calls++;
    return envelope(valid);
  };
  await assert.rejects(
    new OpenAIGeneration(ledger.db).generate(job),
    (e) => e.code === "budget",
  );
  assert.equal(calls, 0);
  assert.equal(ledger.attempts.length, 0);
  assert.equal(ledger.budget.reservedMicros, 0n);
  process.env.AI_DAILY_BUDGET_USD = "1";
  ledger = fakeLedger();
  calls = 0;
  await assert.rejects(
    new OpenAIGeneration(ledger.db).generate({
      ...job,
      model: "different-model",
    }),
    (e) => e.code === "unavailable",
  );
  assert.equal(calls, 0);
  ledger = fakeLedger();
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return envelope({
      status: "needs_input",
      variants: [],
      warning_codes: ["missing_facts"],
      missing_fields: ["product_description"],
    });
  };
  await assert.rejects(
    new OpenAIGeneration(ledger.db).generate(job),
    (e) => e.code === "needs_input",
  );
  assert.equal(calls, 1);
  assert.equal(ledger.budget.spentMicros, 105n);
  console.log(
    "OpenAI orchestration unit checks passed with an in-memory ledger: cost settlement, budget rejection, one repair, no transport retries, unknown-cost holds and pinned model. Database locking is not verified by this test.",
  );
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
