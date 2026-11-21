import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reserveStorage, requireProductCapacity, capacityLimits } = require('../dist/capacity.js');
const { R2Storage } = require('../dist/r2.js');
const { prepareImage } = require('../dist/assets.js');
const { LogoController } = require('../dist/logo.js');
const sharp = require('sharp');
process.env.ACTIVE_PRODUCT_LIMIT = '2';
process.env.STORAGE_LIMIT_BYTES = '100';
const records = new Map();
let active = 1, locks = 0;
const tx = {
  $queryRaw: async () => { locks++; },
  product: { count: async () => active },
  storedObject: {
    findUnique: async ({ where }) => records.get(where.key),
    aggregate: async ({ where }) => ({ _sum: { bytes: [...records.values()].filter(row => row.businessId === where.businessId).reduce((sum, row) => sum + row.bytes, 0) } }),
    create: async ({ data }) => { records.set(data.key, data); return data; },
    deleteMany: async ({ where }) => { records.delete(where.key); return { count: 1 }; },
  },
};
await requireProductCapacity(tx, 'owner'); active = 2;
await assert.rejects(requireProductCapacity(tx, 'owner'), /Active product limit/);
await reserveStorage(tx, 'owner', 'businesses/owner/a', 100);
await reserveStorage(tx, 'owner', 'businesses/owner/a', 100);
assert.equal(records.size, 1);
await assert.rejects(reserveStorage(tx, 'owner', 'businesses/owner/b', 1), /Storage limit/);
await assert.rejects(reserveStorage(tx, 'owner', 'businesses/owner/a', 99), /cannot be replaced/);
await reserveStorage(tx, 'other', 'businesses/other/a', 100);
assert.ok(locks >= 5);
process.env.ACTIVE_PRODUCT_LIMIT = '-1'; assert.throws(capacityLimits, /nonnegative/); process.env.ACTIVE_PRODUCT_LIMIT = '2';
Object.assign(process.env, { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'private-test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', NODE_ENV: 'test' });
delete process.env.R2_TEST_ENDPOINT;
const db = { ...tx, $transaction: async callback => callback(tx) };
const storage = new R2Storage(db);
assert.equal((await storage.client.config.endpoint()).hostname, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
let commands = [];
storage.client.send = async command => { commands.push(command.constructor.name); return {}; };
await storage.remove('businesses/owner/a');
await storage.put('businesses/owner/new', Buffer.alloc(100), 'image/webp');
assert.equal(records.get('businesses/owner/new').bytes, 100);
await assert.rejects(storage.put('businesses/owner/overflow', Buffer.alloc(1), 'image/webp'), /Storage limit/);
assert.equal(commands.filter(name => name === 'PutObjectCommand').length, 1);
await storage.remove('businesses/owner/new');
storage.client.send = async () => { throw new Error('transport'); };
await assert.rejects(storage.put('businesses/owner/unknown', Buffer.alloc(50), 'image/webp'), /temporarily unavailable/);
assert.equal(records.get('businesses/owner/unknown').bytes, 50);
await assert.rejects(storage.remove('businesses/owner/unknown'), /removal is pending/);
assert.ok(records.has('businesses/owner/unknown'));
const png = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#ffffff00' } }).png().toBuffer();
const prepared = await prepareImage(png);
assert.equal((await sharp(prepared.preview).metadata()).hasAlpha, true);
await assert.rejects(prepareImage(Buffer.from('<svg/>')), /not a supported/);
const logos = new LogoController({}, { businessId: async () => 'owner' }, { requireConfigured() {} });
await assert.rejects(logos.upload({}, 'bad', 'confirmed', { buffer: png }), /saved business version/);
await assert.rejects(logos.upload({}, '1', '', { buffer: png }), /confirm you may use/);
console.log('Marketing offline checks passed: R2 endpoint, capacity boundaries/idempotency/isolation, reservation before upload, uncertain-write holds, deletion accounting, transparent images and logo input validation. Database concurrency and real R2 are deferred.');
const { renderGraphic } = require('../dist/graphics.js');
const logo = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#ff00ff' } }).png().toBuffer();
const graphic = await renderGraphic({ format: 'square', layout: 'service', brandColor: '#166534', facts: { brand: 'MarketMate Test', product: 'Tailoring', price: null, contact: '+2348012345678', expires: null }, headline: 'Tailoring', offerTerms: '' }, undefined, logo);
const pixel = await sharp(graphic).extract({ left: 100, top: 90, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
assert.deepEqual([...pixel], [255, 0, 255]);
assert.equal((await sharp(graphic).metadata()).width, 1080);
console.log('Graphic logo compositing check passed.');
