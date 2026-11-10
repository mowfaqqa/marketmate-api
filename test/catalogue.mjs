import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
config({ path: new URL('../.env', import.meta.url), quiet: true });
const require = createRequire(import.meta.url);
const { prepareImage } = require('../dist/assets.js');
const db = new PrismaClient();
const base = process.env.TEST_ORIGIN || 'http://localhost:3000';
const origin = 'http://localhost:3000';
const marker = `Catalogue test ${Date.now()}`;
let checks = 0;
function check(value, expected) { assert.deepEqual(value, expected); checks++; }
async function request(path, { method = 'GET', data, cookie, expected = 200, headers = {}, form } = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: form || (data ? JSON.stringify(data) : undefined) });
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`); checks++;
  return { body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function input(overrides = {}) {
  return { clientId: randomUUID(), type: 'PRODUCT', name: marker, category: 'Synthetic fixtures', description: 'Test-only product facts.', pricingMode: 'FIXED', priceKobo: 125050, materialSize: 'Cotton, medium', serviceArea: '', fulfilmentTerms: 'Pickup only', confirmedClaims: '', ...overrides };
}
function imageForm(buffer, mime = 'image/png') { const form = new FormData(); form.append('file', new Blob([buffer], { type: mime }), 'test-image.png'); return form; }
async function uploadTicket(cookie, product) { return (await request(`/products/${product.id}/image-upload`, { method: 'POST', data: { version: product.version, rightsConfirmed: true }, cookie, expected: 201 })).body; }
async function complete(cookie, ticket, buffer, expected = 201, mime = 'image/png') { return request(`/assets/${ticket.id}/complete`, { method: 'POST', cookie, headers: { 'x-upload-token': ticket.uploadToken }, form: imageForm(buffer, mime), expected }); }
try {
  const a = await request('/auth/register', { method: 'POST', data: { email: `catalogue-a-${Date.now()}@example.com`, password: 'catalogue-synthetic-password' }, expected: 201 });
  const b = await request('/auth/register', { method: 'POST', data: { email: `catalogue-b-${Date.now()}@example.com`, password: 'catalogue-synthetic-password' }, expected: 201 });
  await request('/products', { expected: 401 });
  await request('/products?page=0', { cookie: a.cookie, expected: 400 });
  const original = input();
  let product = (await request('/products', { method: 'POST', data: original, cookie: a.cookie, expected: 201 })).body;
  check(product.priceKobo, 125050); check(product.graphicsReady, false);
  check((await request('/products', { method: 'POST', data: original, cookie: a.cookie, expected: 201 })).body.id, product.id);
  await request('/products', { method: 'POST', data: { ...original, name: 'Changed retry' }, cookie: a.cookie, expected: 409 });
  await request(`/products/${product.id}`, { cookie: b.cookie, expected: 404 });
  await request(`/products/${product.id}`, { method: 'PUT', data: { ...original, version: 0 }, cookie: b.cookie, expected: 404 });
  await request(`/products/${product.id}/archive`, { method: 'PATCH', data: { version: 0, archived: true }, cookie: b.cookie, expected: 404 });
  for (const priceKobo of [-1, 0, 1.5, 1_000_000_000_001, null]) await request('/products', { method: 'POST', data: input({ priceKobo }), cookie: a.cookie, expected: 400 });
  for (const change of [{ name: ' ' }, { name: 'x'.repeat(101) }, { description: 'x'.repeat(2001) }, { pricingMode: 'INQUIRY', priceKobo: 100 }, { businessId: 'foreign' }]) await request('/products', { method: 'POST', data: input(change), cookie: a.cookie, expected: 400 });
  const max = (await request('/products', { method: 'POST', data: input({ priceKobo: 1_000_000_000_000 }), cookie: a.cookie, expected: 201 })).body;
  check(max.priceKobo, 1_000_000_000_000);
  const service = (await request('/products', { method: 'POST', data: input({ type: 'SERVICE', pricingMode: 'INQUIRY', priceKobo: null }), cookie: a.cookie, expected: 201 })).body;
  check(service.priceKobo, null); check(service.graphicsReady, true);
  const duplicate = (await request('/products', { method: 'POST', data: input(), cookie: a.cookie, expected: 201 })).body;
  assert.notEqual(duplicate.id, product.id); checks++;
  const edit = { ...original, name: `${marker} edited`, version: 0 };
  const edits = await Promise.all([edit, { ...edit, name: `${marker} concurrent` }].map(async data => {
    const response = await fetch(`${base}/api/products/${product.id}`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: a.cookie }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }));
  check(edits.map(x => x.status).sort(), [200, 409]);
  product = edits.find(x => x.status === 200).body; check(product.version, 1);
  const offer = { version: product.version, promoPriceKobo: 100000, assertedPriorPriceKobo: 125050, startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(), terms: 'Test terms' };
  await request(`/products/${service.id}/offer`, { method: 'PUT', data: { ...offer, version: service.version }, cookie: a.cookie, expected: 400 });
  await request(`/products/${product.id}/offer`, { method: 'PUT', data: { ...offer, promoPriceKobo: product.priceKobo }, cookie: a.cookie, expected: 400 });
  await request(`/products/${product.id}/offer`, { method: 'PUT', data: { ...offer, endsAt: offer.startsAt }, cookie: a.cookie, expected: 400 });
  await request(`/products/${product.id}/offer`, { method: 'PUT', data: { ...offer, startsAt: '2026-01-01T12:00:00' }, cookie: a.cookie, expected: 400 });
  const results = await Promise.all([0, 1].map(async () => {
    const response = await fetch(`${base}/api/products/${product.id}/offer`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: a.cookie }, body: JSON.stringify(offer) });
    return { status: response.status, body: await response.json() };
  }));
  check(results.map(x => x.status).sort(), [200, 409]);
  product = results.find(x => x.status === 200).body;
  check(product.offer.state, 'active'); check(product.offer.discountBasisPoints, 2003);
  check(await db.offer.count({ where: { productId: product.id, status: 'ENABLED' } }), 1);
  await request(`/products/${product.id}`, { method: 'PUT', data: { ...original, pricingMode: 'INQUIRY', priceKobo: null, version: product.version }, cookie: a.cookie, expected: 409 });
  await request(`/products/${product.id}/offer`, { method: 'PUT', data: { ...offer, version: product.version }, cookie: b.cookie, expected: 404 });
  product = (await request(`/products/${product.id}/offer`, { method: 'PUT', data: { ...offer, version: product.version, startsAt: new Date(Date.now() + 3600000).toISOString() }, cookie: a.cookie })).body;
  check(product.offer.state, 'scheduled'); check(await db.offer.count({ where: { productId: product.id } }), 2);
  await db.offer.update({ where: { id: product.offer.id }, data: { startsAt: new Date(Date.now() - 120000), endsAt: new Date(Date.now() - 60000) } });
  product = (await request(`/products/${product.id}`, { cookie: a.cookie })).body;
  check(product.offer.state, 'expired');
  product = (await request(`/products/${product.id}/offer/cancel`, { method: 'POST', data: { version: product.version }, cookie: a.cookie, expected: 201 })).body;
  check(product.offer.state, 'cancelled');
  await request(`/products/${product.id}/image-upload`, { method: 'POST', data: { version: product.version, rightsConfirmed: false }, cookie: a.cookie, expected: 400 });
  await request(`/products/${product.id}/image-upload`, { method: 'POST', data: { version: product.version, rightsConfirmed: true }, cookie: b.cookie, expected: 404 });
  const ticket = await uploadTicket(a.cookie, product);
  check((await db.mediaAsset.findUnique({ where: { id: ticket.id } })).status, 'PENDING');
  const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#166534' } }).png().toBuffer();
  await complete(b.cookie, ticket, image, 404);
  await request(`/assets/${ticket.id}/complete`, { method: 'POST', cookie: a.cookie, headers: { 'x-upload-token': 'wrong' }, form: imageForm(image), expected: 400 });
  await complete(a.cookie, ticket, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 400);
  check((await db.mediaAsset.findUnique({ where: { id: ticket.id } })).status, 'REJECTED');
  const completed = await Promise.all([complete(a.cookie, ticket, image, 201, 'text/html'), complete(a.cookie, ticket, image)]);
  product = completed[0].body;
  check(completed[1].body.version, product.version); check(product.primaryAsset.id, ticket.id); check(product.graphicsReady, true);
  const stored = await db.mediaAsset.findUnique({ where: { id: ticket.id } });
  assert.ok(stored.rightsConfirmedAt); assert.notEqual(stored.uploadTokenHash, ticket.uploadToken); checks++;
  check(stored.storageProvider, 'R2'); check(stored.content, null); check(stored.preview, null);
  assert.match(stored.fullKey, /^businesses\/.+\/photos\/.+\/full\.webp$/); checks++;
  await request(`/assets/${ticket.id}/authorize`, { method: 'POST', cookie: b.cookie, expected: 404 });
  const authorization = (await request(`/assets/${ticket.id}/authorize`, { method: 'POST', cookie: a.cookie, expected: 201 })).body;
  const photo = await fetch(`${base}${authorization.previewUrl}`, { headers: { Cookie: a.cookie } });
  check(photo.status, 200); check(photo.headers.get('content-type'), 'image/webp'); check(photo.headers.get('cache-control'), 'no-store');
  const previewMetadata = await sharp(Buffer.from(await photo.arrayBuffer())).metadata();
  check(previewMetadata.width, 120); check(previewMetadata.exif, undefined);
  check((await fetch(`${base}${authorization.previewUrl}`, { headers: { Cookie: b.cookie } })).status, 404);
  check((await fetch(`${base}${authorization.previewUrl}`)).status, 401);
  const expiredLink = new URL(`${base}${authorization.previewUrl}`); expiredLink.searchParams.set('expires', String(Date.now() - 1000));
  check((await fetch(expiredLink, { headers: { Cookie: a.cookie } })).status, 404);
  await request(`/assets/${ticket.id}`, { method: 'DELETE', cookie: a.cookie, expected: 409 });
  const oversized = await uploadTicket(a.cookie, product);
  await complete(a.cookie, oversized, Buffer.alloc(10 * 1024 * 1024 + 1), 413);
  const large = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: 'white' } }).png().toBuffer();
  await complete(a.cookie, oversized, large, 400);
  const oriented = await sharp({ create: { width: 12, height: 6, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const sanitized = await prepareImage(oriented);
  check([sanitized.width, sanitized.height], [6, 12]); check((await sharp(sanitized.content).metadata()).exif, undefined);
  const expiredTicket = await uploadTicket(a.cookie, product);
  await db.mediaAsset.update({ where: { id: expiredTicket.id }, data: { uploadExpiresAt: new Date(Date.now() - 1000) } });
  await complete(a.cookie, expiredTicket, image, 400);
  const replacement = await uploadTicket(a.cookie, product);
  product = (await complete(a.cookie, replacement, image)).body;
  await request(`/assets/${ticket.id}`, { method: 'DELETE', cookie: b.cookie, expected: 404 });
  await request(`/assets/${ticket.id}`, { method: 'DELETE', cookie: a.cookie });
  check((await db.mediaAsset.findUnique({ where: { id: ticket.id } })).content, null);
  check((await fetch(`${base}${authorization.previewUrl}`, { headers: { Cookie: a.cookie } })).status, 404);
  await assert.rejects(db.product.update({ where: { id: product.id }, data: { pricingMode: 'INQUIRY', priceKobo: 1 } })); checks++;
  await assert.rejects(db.product.update({ where: { id: product.id }, data: { pricingMode: 'FIXED', priceKobo: null } })); checks++;
  await assert.rejects(db.mediaAsset.update({ where: { id: replacement.id }, data: { width: null } })); checks++;
  const businessB = (await request('/auth/me', { cookie: b.cookie })).body.business.id;
  const foreign = await db.product.create({ data: { id: randomUUID(), businessId: businessB, type: 'SERVICE', name: marker, pricingMode: 'INQUIRY' } });
  await assert.rejects(db.product.update({ where: { id: foreign.id }, data: { primaryAssetId: replacement.id } })); checks++;
  product = (await request(`/products/${product.id}/archive`, { method: 'PATCH', data: { version: product.version, archived: true }, cookie: a.cookie })).body;
  check(product.graphicsReady, false);
  await request(`/products/${product.id}`, { method: 'PUT', data: { ...original, version: product.version }, cookie: a.cookie, expected: 409 });
  check((await request(`/products?status=archived&search=${encodeURIComponent(marker)}`, { cookie: a.cookie })).body.total, 1);
  await request(`/products/${product.id}/image-upload`, { method: 'POST', data: { version: product.version, rightsConfirmed: true }, cookie: a.cookie, expected: 409 });
  product = (await request(`/products/${product.id}/archive`, { method: 'PATCH', data: { version: product.version, archived: false }, cookie: a.cookie })).body;
  check(product.archivedAt, null); check(product.primaryAsset.id, replacement.id);
  const current = await db.product.findUnique({ where: { id: product.id } });
  await db.product.createMany({ data: Array.from({ length: 21 }, (_, i) => ({ id: randomUUID(), businessId: current.businessId, type: 'SERVICE', name: `${marker} pagination ${i}`, pricingMode: 'INQUIRY' })) });
  const list = (await request(`/products?search=${encodeURIComponent(marker)}&page=1`, { cookie: a.cookie })).body;
  check(list.pageSize, 20); check(list.items.length, 20); check(list.total, 25);
  check((await request(`/products?search=${encodeURIComponent(marker)}&page=2`, { cookie: a.cookie })).body.items.length, 5);
  check((await request(`/products?search=${encodeURIComponent(marker)}&page=2`, { cookie: b.cookie })).body.items.length, 0);
  let limited = false;
  for (let i = 0; i < 31; i++) {
    const response = await fetch(`${base}/api/products/${product.id}/image-upload`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: a.cookie }, body: JSON.stringify({ version: product.version, rightsConfirmed: false }) });
    if (response.status === 429) { assert.ok(Number(response.headers.get('retry-after')) > 0); limited = true; break; }
    assert.equal(response.status, 400);
  }
  check(limited, true);
  for (const [method, path, count] of [['GET', '/auth/me', 241], ['PUT', '/business', 121]]) {
    let reachedLimit = false;
    for (let i = 0; i < count; i++) {
      const response = await fetch(`${base}/api${path}`, { method, headers: { Origin: origin, Cookie: a.cookie, 'Content-Type': 'application/json' }, body: method === 'PUT' ? '{}' : undefined });
      if (response.status === 429) { assert.ok(Number(response.headers.get('retry-after')) > 0); reachedLimit = true; break; }
      assert.equal(response.status, method === 'GET' ? 200 : 400);
    }
    check(reachedLimit, true);
  }
  await request('/auth/me', { cookie: b.cookie });
  console.log(`${checks} catalogue, offer and private image checks passed with synthetic data.`);
} finally { await db.$disconnect(); }
