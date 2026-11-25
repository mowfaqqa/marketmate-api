import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DashboardController } = require('../dist/dashboard/dashboard.controller.js');
const { lagosToday } = require('../dist/infrastructure/lagos-date.js');
assert.equal(lagosToday(new Date('2026-11-17T22:59:59Z')), '2026-11-17');
assert.equal(lagosToday(new Date('2026-11-17T23:00:00Z')), '2026-11-18');
const jobs = [], days = [];
const db = {
  studioJob: { findMany: async query => { jobs.push(query); return []; } },
  marketingDay: {
    findMany: async query => { days.push(query); return []; },
    count: async query => { days.push(query); return 8; },
  },
};
// The session lookup supplies the only business scope accepted by feature handlers.
const { SessionGuard, currentBusinessId } = require('../dist/auth/session.guard.js');
const user = { id: 'owner', email: 'owner@example.test', verifiedAt: null, memberships: [{ businessId: 'owned-business' }] };
const sessionDb = { session: { findUnique: async query => {
  assert.ok(query.include.user.select.memberships.select.businessId);
  return { id: 'session-id', userId: user.id, expiresAt: new Date(Date.now() + 60000), user };
} } };
const request = { headers: { cookie: 'marketmate_session=' + 'a'.repeat(64) }, method: 'GET', businessId: 'untrusted' };
const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) };
const guard = new SessionGuard(sessionDb, { enforce() {} });
await guard.canActivate(context);
assert.equal(currentBusinessId(request), 'owned-business');
user.memberships = [];
await guard.canActivate(context);
assert.throws(() => currentBusinessId(request), /Business not found/);
const controller = new DashboardController(db);
await assert.rejects(controller.activity({ user: { id: 'owner' } }), /Business not found/);
const result = await controller.activity({ user: { id: 'owner' }, businessId: 'owned-business' });
assert.equal(result.overdueCount, 8);
for (const query of jobs) {
  assert.equal(query.where.businessId, 'owned-business');
  assert.equal(query.where.archived, false);
  assert.equal(query.take, 5);
  assert.equal(query.select.facts, undefined);
}
for (const query of days) {
  assert.equal(query.where.plan.businessId, 'owned-business');
  assert.equal(query.where.job.businessId, 'owned-business');
  assert.equal(query.where.completedAt, null);
  assert.equal(query.where.job.product.archivedAt, null);
}
assert.equal(days[0].where.date, result.today);
assert.deepEqual(days[1].where.date, { lt: result.today });
console.log('Dashboard unit checks passed: Lagos date boundary, owner-scoped bounded queries, incomplete-task filters. No database used.');
