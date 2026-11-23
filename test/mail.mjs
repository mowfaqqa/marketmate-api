import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { Mail } = require('../dist/auth/mail.js');
const { Logger } = require('@nestjs/common');
const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
const savedError = Logger.prototype.error;
const logs = [];
const dir = await mkdtemp(join(tmpdir(), 'marketmate-mail-'));
const configured = {
  NODE_ENV: 'development', MAIL_MODE: 'brevo',
  WEB_ORIGIN: 'http://localhost:3000',
  BREVO_API_KEY: 'synthetic-private-key', MAIL_FROM: 'sender@example.test',
  MAIL_FROM_NAME: 'MarketMate Test',
};
const mail = new Mail();
const token = 'ab'.repeat(32);
let calls = 0;
function configure(overrides = {}) {
  for (const key of ['NODE_ENV', 'MAIL_MODE', 'MAIL_DIRECTORY', 'WEB_ORIGIN', 'BREVO_API_KEY', 'MAIL_FROM', 'MAIL_FROM_NAME']) delete process.env[key];
  Object.assign(process.env, configured, overrides);
}
async function unavailable(overrides, response) {
  configure(overrides);
  globalThis.fetch = response || (async () => { throw new Error('Unexpected network request'); });
  await assert.rejects(mail.send('recipient@example.test', 'verify', token), error => {
    assert.equal(error.getStatus(), 503);
    assert.equal(error.message, 'Email delivery is unavailable. Please try again later.');
    return true;
  });
}

try {
  Logger.prototype.error = function (message) { logs.push(message); };
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['api-key'], configured.BREVO_API_KEY);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.sender, { email: configured.MAIL_FROM, name: process.env.MAIL_FROM_NAME?.trim() || 'MarketMate' });
    assert.deepEqual(body.to, [{ email: 'recipient@example.test' }]);
    const verify = body.subject.includes('Verify');
    assert.ok(body.textContent.includes(`${process.env.WEB_ORIGIN.replace(/\/$/, '')}/${verify ? 'verify-email' : 'reset-password'}#token=${token}`));
    assert.ok(body.textContent.includes(verify ? '24 hours' : '30 minutes'));
    assert.ok(!body.textContent.includes(configured.BREVO_API_KEY));
    return new Response(JSON.stringify({ messageId: 'synthetic-id' }), { status: 201 });
  };
  configure();
  await mail.send('recipient@example.test', 'verify', token);
  configure({ WEB_ORIGIN: 'http://localhost:3000/', MAIL_FROM_NAME: '' });
  await mail.send('recipient@example.test', 'reset', token);
  configure({ NODE_ENV: 'production', WEB_ORIGIN: 'https://app.example.test', MAIL_MODE: '' });
  await mail.send('recipient@example.test', 'verify', token);
  assert.equal(calls, 3);

  configure({ MAIL_MODE: 'file', MAIL_DIRECTORY: join(dir, 'messages'), BREVO_API_KEY: '', MAIL_FROM: '' });
  globalThis.fetch = async () => { assert.fail('File mode must not call Brevo'); };
  await mail.send('local@example.test', 'verify', token);
  const messagePath = join(dir, 'messages', (await readdir(join(dir, 'messages')))[0]);
  const message = JSON.parse(await readFile(messagePath, 'utf8'));
  assert.equal(message.to, 'local@example.test');
  assert.equal(message.link, `http://localhost:3000/verify-email#token=${token}`);
  assert.equal((await stat(messagePath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'messages'))).mode & 0o777, 0o700);

  // Invalid configuration must fail before any provider request.
  globalThis.fetch = async () => { assert.fail('Invalid configuration must not call Brevo'); };
  for (const overrides of [
    { BREVO_API_KEY: '' }, { BREVO_API_KEY: '  ' }, { MAIL_FROM: '' },
    { MAIL_FROM: 'MarketMate <sender@example.test>' }, { MAIL_MODE: 'smtp' },
    { NODE_ENV: 'production', MAIL_MODE: 'file' },
    { NODE_ENV: 'production', WEB_ORIGIN: 'http://app.example.test' },
    { NODE_ENV: 'production', WEB_ORIGIN: '' },
    ...['not-a-url', 'https://app.example.test/path', 'https://app.example.test?query=1',
      'https://app.example.test#fragment', 'https://user:password@app.example.test', 'ftp://app.example.test']
      .map(WEB_ORIGIN => ({ WEB_ORIGIN })),
  ]) {
    let attempted = false;
    await unavailable(overrides, async () => { attempted = true; throw new Error('Unexpected request'); });
    assert.equal(attempted, false);
  }
  for (const status of [400, 401, 403, 429, 500]) {
    await unavailable({}, async () => new Response('PRIVATE PROVIDER DETAILS', { status }));
    assert.ok(logs.at(-1).includes(`HTTP ${status}`));
  }
  await unavailable({}, async () => { throw new DOMException('PRIVATE NETWORK DETAILS', 'TimeoutError'); });
  assert.match(logs.at(-1), /failed or timed out/);
  const diagnostics = JSON.stringify(logs);
  for (const secret of [configured.BREVO_API_KEY, token, 'recipient@example.test', 'PRIVATE PROVIDER DETAILS', 'PRIVATE NETWORK DETAILS']) assert.ok(!diagnostics.includes(secret));
  console.log('Mail offline checks passed: Brevo requests, verification/reset links, local delivery, configuration failures, provider failures and private diagnostics. No emails sent.');
} finally {
  globalThis.fetch = savedFetch;
  Logger.prototype.error = savedError;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await rm(dir, { recursive: true, force: true });
}
