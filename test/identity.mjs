import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const base = process.env.TEST_ORIGIN || 'http://localhost:3000';
const origin = 'http://localhost:3000';
const suffix = Date.now();
let checks = 0;
async function request(path, { method = 'GET', data, cookie, expected = 200, requestOrigin = origin } = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`); checks++;
  return { body, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
async function mail(email, purpose) {
  const dir = new URL('../.local-mail/', import.meta.url);
  const records = await Promise.all((await readdir(dir)).map(async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'))));
  return records.filter(x => x.to === email && x.link.includes(purpose)).at(-1);
}
await request('/auth/me', { expected: 401 });
await request('/auth/register', { method: 'POST', data: { email: 'invalid', password: 'short' }, expected: 400 });
await request('/auth/login', { method: 'POST', data: { email: 'a@example.com', password: '123456789012' }, requestOrigin: 'https://other.example', expected: 403 });
const emailA = `owner-a-${suffix}@example.com`;
const credentials = { email: emailA, password: 'correct-horse-marketmate' };
const a = await request('/auth/register', { method: 'POST', data: credentials, expected: 201 });
assert.ok(a.cookie); assert.match(a.headers.get('set-cookie'), /HttpOnly/i); checks++;
const accountA = (await request('/auth/me', { cookie: a.cookie })).body;
assert.equal(accountA.verified, false); assert.equal(accountA.business.version, 0); checks++;
await request('/auth/register', { method: 'POST', data: credentials, expected: 409 });
const emailB = `owner-b-${suffix}@example.com`;
const b = await request('/auth/register', { method: 'POST', data: { ...credentials, email: emailB }, expected: 201 });
const accountB = (await request('/auth/me', { cookie: b.cookie })).body;
assert.notEqual(accountA.business.id, accountB.business.id); checks++;
const profile = { name: 'A Market', category: 'Retail', description: 'Everyday goods', location: 'Lagos', contact: '+2348012345678', language: 'en-NG', tone: 'friendly', brandColor: '#166534', version: 0 };
await request('/business', { method: 'PUT', data: { ...profile, id: accountB.business.id }, cookie: a.cookie, expected: 400 });
await request('/business', { method: 'PUT', data: { ...profile, contact: 'javascript:alert(1)' }, cookie: a.cookie, expected: 400 });
await request('/business', { method: 'PUT', data: profile, cookie: a.cookie });
await request('/business', { method: 'PUT', data: profile, cookie: a.cookie, expected: 409 });
assert.equal((await request('/auth/me', { cookie: b.cookie })).body.business.name, ''); checks++;
const verification = new URL((await mail(emailA, 'verify-email')).link).hash.slice(7);
await request('/auth/verify', { method: 'POST', data: { token: verification }, expected: 201 });
await request('/auth/verify', { method: 'POST', data: { token: verification }, expected: 400 });
assert.equal((await request('/auth/me', { cookie: a.cookie })).body.verified, true); checks++;
await request('/auth/login', { method: 'POST', data: { ...credentials, password: 'incorrect-long-password' }, expected: 401 });
const second = await request('/auth/login', { method: 'POST', data: credentials, expected: 201 });
const existing = await request('/auth/forgot-password', { method: 'POST', data: { email: emailA }, expected: 201 });
const missing = await request('/auth/forgot-password', { method: 'POST', data: { email: `missing-${suffix}@example.com` }, expected: 201 });
assert.deepEqual(existing.body, missing.body); checks++;
const reset = new URL((await mail(emailA, 'reset-password')).link).hash.slice(7);
const password = 'new-long-marketmate-password';
await request('/auth/reset-password', { method: 'POST', data: { token: reset, password }, expected: 201 });
await request('/auth/me', { cookie: a.cookie, expected: 401 });
await request('/auth/me', { cookie: second.cookie, expected: 401 });
await request('/auth/reset-password', { method: 'POST', data: { token: reset, password }, expected: 400 });
await request('/auth/login', { method: 'POST', data: credentials, expected: 401 });
const fresh = await request('/auth/login', { method: 'POST', data: { email: emailA, password }, expected: 201 });
await request('/auth/logout', { method: 'POST', cookie: fresh.cookie, expected: 201 });
await request('/auth/me', { cookie: fresh.cookie, expected: 401 });
let throttled = false;
for (let i = 0; i < 31; i++) {
  const response = await fetch(`${base}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: `missing-${suffix}@example.com` }) });
  if (response.status === 429) { throttled = true; break; }
  assert.equal(response.status, 201);
}
assert.equal(throttled, true); checks++;
console.log(`${checks} identity and business checks passed with synthetic accounts.`);
