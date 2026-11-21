import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
config({ path: new URL('../.env', import.meta.url), quiet: true });
const db = new PrismaClient();
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:4102';
async function call(path, cookie, status, body) {
  const response = await fetch(origin + '/api' + path, { method: body ? 'POST' : 'GET',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body && JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
try {
  const email = `studio-${randomUUID()}@example.com`;
  const { cookie } = await call('/auth/register', '', 201, { email, password: 'studio-synthetic-password' });
  const { data: account } = await call('/auth/me', cookie, 200);
  const businessId = account.business.id;
  await db.user.update({ where: { email }, data: { verifiedAt: new Date() } });
  await db.business.update({ where: { id: businessId }, data: { name: 'Sample Shop', contact: '+2348012345678' } });
  const product = await db.product.create({ data: { businessId, name: 'Cotton shirt', type: 'PRODUCT', pricingMode: 'FIXED', priceKobo: 250000n } });
  const brief = { key: randomUUID(), productId: product.id, goal: 'inquiries', channel: 'instagram', tone: 'friendly', manual: false };
  const { data: facts } = await call('/studio/preview', cookie, 201, brief);
  Object.assign(brief, { productVersion: facts.productVersion, businessVersion: facts.businessVersion });
  const { data: job } = await call('/studio', cookie, 202, brief);
  assert.equal((await call('/studio', cookie, 202, brief)).data.id, job.id);
  const extraUnits = Number(process.env.STUDIO_MONTHLY_UNITS || 1) - 1;
  if (extraUnits > 0) await db.studioJob.create({ data: { businessId, productId: product.id, key: randomUUID(), fingerprint: 'test', status: 'ready', period: new Date(job.period), units: extraUnits, facts } });
  const competing = await fetch(origin + '/api/studio', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...brief, key: randomUUID() }) });
  assert.equal(competing.status, 409);
  let result;
  for (let attempt = 0; attempt < 30; attempt++) {
    result = (await call('/studio/' + job.id, cookie, 200)).data;
    if (!['pending', 'running'].includes(result.status)) break;
    await setTimeout(100);
  }
  assert.equal(result.status, 'ready');
  assert.equal(result.drafts.length, 3);
  assert.equal((await call('/studio', cookie, 200)).data.usage.used, extraUnits + 1);
  const path = '/studio/' + job.id;
  const draftId = result.drafts[0].id;
  await call(path + '/copy', cookie, 409, { draftId });
  await call(path + '/approve', cookie, 201, { draftId });
  assert.match((await call(path + '/copy', cookie, 201, { draftId })).data.text, /2,500\.00/);
  await call(path + '/edit', cookie, 400, { draftId, text: 'Now ₦10' });
  const { data: edit } = await call(path + '/edit', cookie, 201, { draftId, text: 'Ask about our cotton shirt.' });
  assert.equal(edit.revision, 2);
  await call(path + '/copy', cookie, 409, { draftId });
  await db.product.update({ where: { id: product.id }, data: { version: { increment: 1 } } });
  await call(path + '/approve', cookie, 409, { draftId: edit.id });
  const { cookie: other } = await call('/auth/register', '', 201, { email: `other-${randomUUID()}@example.com`, password: 'studio-synthetic-password' });
  await call(path, other, 404);
  const { data: manual } = await call('/studio', cookie, 202, { ...brief, manual: true, productVersion: product.version + 1, key: randomUUID() });
  assert.equal(manual.units, 0);
  assert.equal(manual.status, 'ready');
  const { data: duplicate } = await call('/studio', cookie, 202, { ...brief, manual: true, productVersion: product.version + 1, key: randomUUID(), sourceDraftId: edit.id });
  const { data: duplicateDetails } = await call('/studio/' + duplicate.id, cookie, 200);
  assert.equal(duplicateDetails.drafts[0].text, edit.text);
  assert.equal(duplicateDetails.drafts[0].approvedAt, null);
  await call('/studio', cookie, 429, { ...brief, manual: true, key: randomUUID() });
  console.log('Studio HTTP checks passed for generation, quota, isolation, approval, revisions, stale facts and manual drafts.');
} finally { await db.$disconnect(); }
