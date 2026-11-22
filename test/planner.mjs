import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config({ path: new URL("../.env", import.meta.url), quiet: true });
const db = new PrismaClient();
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:4102";
async function call(
  path,
  cookie,
  status,
  body,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body && JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
try {
  const email = `planner-${randomUUID()}@example.com`;
  const { cookie } = await call("/auth/register", "", 201, {
    email,
    password: "planner-synthetic-password",
  });
  const { data: account } = await call("/auth/me", cookie, 200);
  const businessId = account.business.id;
  await db.user.update({ where: { email }, data: { verifiedAt: new Date() } });
  await db.business.update({
    where: { id: businessId },
    data: { name: "Planner Shop", contact: "+2348012345678" },
  });
  const product = await db.product.create({
    data: {
      businessId,
      name: "Cotton shirt",
      type: "PRODUCT",
      pricingMode: "FIXED",
      priceKobo: 250000n,
    },
  });
  const today = (await call("/planner", cookie, 200)).data.today;
  const start = new Date(Date.parse(today) + 86400000)
    .toISOString()
    .slice(0, 10);
  const brief = {
    key: randomUUID(),
    start,
    goal: "offer",
    productIds: [product.id],
  };
  await call("/planner", cookie, 400, { ...brief, start: "2026-02-30" });
  const { data: plan } = await call("/planner", cookie, 201, brief);
  assert.equal((await call("/planner", cookie, 201, brief)).data.id, plan.id);
  assert.equal(plan.days.length, 7);
  assert.deepEqual(
    plan.days.map((day) => day.date),
    Array.from({ length: 7 }, (_, i) =>
      new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
    ),
  );
  assert.ok(
    plan.days.every(
      (day) =>
        day.job.productId === product.id &&
        day.job.facts.goal === "inquiries" &&
        !day.job.drafts[0].approvedAt,
    ),
  );
  assert.equal((await call("/planner", cookie, 200)).data.usage.used, 3);
  const first = plan.days[0];
  const path = `/planner/${plan.id}/days/${first.id}`;
  const edit = {
    revision: first.revision,
    date: plan.days[1].date,
    productId: product.id,
    channel: "whatsapp",
    task: "Check photo",
    text: "Ask us about the cotton shirt.",
    swap: false,
    regenerate: false,
    confirmDoneEdit: false,
  };
  await call(path, cookie, 409, edit, "PATCH");
  const swapped = (
    await call(path, cookie, 200, { ...edit, swap: true }, "PATCH")
  ).data;
  assert.equal(swapped.days[1].id, first.id);
  assert.equal(swapped.days[0].id, plan.days[1].id);
  assert.equal(swapped.days[2].job.id, plan.days[2].job.id);
  const day = swapped.days[1];
  assert.deepEqual(day.previousJobIds, [first.job.id]);
  await call(
    path + "/completion",
    cookie,
    409,
    { revision: day.revision, done: true },
    "PATCH",
  );
  await call("/studio/" + day.job.id + "/approve", cookie, 201, {
    draftId: day.job.drafts[0].id,
  });
  const done = (
    await call(
      path + "/completion",
      cookie,
      200,
      { revision: day.revision, done: true },
      "PATCH",
    )
  ).data.days[1];
  assert.ok(done.completedAt && done.completedBy);
  await call(
    path,
    cookie,
    409,
    { ...edit, revision: done.revision, regenerate: true },
    "PATCH",
  );
  const regenerated = (
    await call(
      path,
      cookie,
      200,
      {
        ...edit,
        revision: done.revision,
        regenerate: true,
        confirmDoneEdit: true,
      },
      "PATCH",
    )
  ).data;
  assert.equal(regenerated.days[1].completedAt, null);
  assert.equal(regenerated.days[1].job.drafts[0].approvedAt, null);
  assert.equal(regenerated.days[2].job.id, plan.days[2].job.id);
  assert.equal((await call("/planner", cookie, 200)).data.usage.used, 4);
  await call("/planner", cookie, 409, { ...brief, key: randomUUID() });
  const { cookie: other } = await call("/auth/register", "", 201, {
    email: `planner-other-${randomUUID()}@example.com`,
    password: "planner-synthetic-password",
  });
  await call(path, other, 404, edit, "PATCH");
  console.log(
    "Planner HTTP checks passed for dates, offer fallback, quota, swaps, approval, completion, regeneration and tenant isolation.",
  );
} finally {
  await db.$disconnect();
}
