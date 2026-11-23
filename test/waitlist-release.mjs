// Run against the local production builds connected to the same dedicated test database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const web = new URL(process.env.WEB_ORIGIN || "http://localhost:3000").origin;
const api = new URL(process.env.API_ORIGIN || "http://localhost:4100").origin;
const database = new URL(process.env.TEST_DATABASE_URL);
for (const address of [new URL(web), new URL(api), database]) {
  assert.ok(
    ["localhost", "127.0.0.1"].includes(address.hostname),
    "Local test services required",
  );
}
assert.match(database.pathname, /test/i);
const db = new PrismaClient({ datasourceUrl: database.href });
const email = `release-${randomUUID()}@example.com`;
const blankEmail = "blank-" + email;
const details = { name: "  Amina Bello ", businessType: " Handmade bags " };
const submit = (body, origin = web) =>
  fetch(web + "/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ ...details, ...body }),
  });
try {
  for (const path of [
    "/",
    "/dashboard",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password?token=sample",
    "/verify-email?token=sample",
    "/products",
    "/products/new",
    "/products/123",
    "/planner",
    "/studio",
    "/invoices",
    "/invoices/123",
    "/invoices/new",
    "/settings",
    "/more",
    "/unknown/deep/link",
  ]) {
    const res = await fetch(web + path, { redirect: "manual" });
    assert.equal(res.status, 307, path);
    assert.equal(res.headers.get("location"), "/waitlist", path);
  }
  assert.equal((await fetch(web + "/waitlist")).status, 200);
  assert.equal((await fetch(web + "/images/adire-tote.webp")).status, 200);
  for (const origin of [web, api]) {
    for (const path of [
      "/api/health",
      "/api/docs",
      "/api/docs-json",
      "/api/auth/me",
      "/api/products",
      "/api/waitlist",
    ]) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
    const disabled = await fetch(origin + "/api/auth/register", {
      method: "POST",
      headers: { Origin: web },
    });
    assert.equal(disabled.status, 404);
  }
  for (const invalid of [
    { name: undefined },
    { businessType: undefined },
    { challenges: 42 },
    { challenges: "a".repeat(1001) },
    { name: "  " },
    { businessType: "  " },
    { name: "a".repeat(101) },
    { businessType: "a".repeat(251) },
  ]) {
    assert.equal((await submit({ email, ...invalid })).status, 400);
  }
  assert.equal((await submit({ email: "invalid" })).status, 400);
  assert.equal((await submit({ email, unexpected: true })).status, 400);
  assert.equal((await submit({ email }, "https://example.org")).status, 403);
  assert.equal(await db.waitlistEntry.count({ where: { email } }), 0);
  assert.equal(
    (await submit({ email: blankEmail, challenges: "   " })).status,
    204,
  );
  const blank = await db.waitlistEntry.findUniqueOrThrow({
    where: { email: blankEmail },
  });
  assert.equal(blank.challenges, null);
  const responses = await Promise.all(
    [email, email.toUpperCase(), " " + email + " "].map((value) =>
      submit({ email: value, challenges: "  Finding new customers  " }),
    ),
  );
  for (const response of responses) assert.equal(response.status, 204);
  assert.equal(await db.waitlistEntry.count({ where: { email } }), 1);
  assert.equal(
    (
      await submit({
        email,
        name: "Someone else",
        businessType: "Different business",
      })
    ).status,
    204,
  );
  const entry = await db.waitlistEntry.findUniqueOrThrow({ where: { email } });
  assert.equal(entry.name, details.name.trim());
  assert.equal(entry.businessType, details.businessType.trim());
  assert.equal(entry.challenges, "Finding new customers");
  let response;
  for (let attempt = 0; attempt < 21; attempt++) {
    response = await submit({ email });
    if (response.status === 429) break;
    assert.equal(response.status, 204);
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  console.log(
    "Waitlist production route, registration, persistence and rate-limit checks passed.",
  );
} finally {
  await db.waitlistEntry.deleteMany({
    where: { email: { in: [email, blankEmail] } },
  });
  await db.$disconnect();
}
