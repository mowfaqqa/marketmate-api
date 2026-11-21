import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DashboardController, marketingToday } = require('../dist/dashboard.js');
assert.equal(marketingToday(new Date('2026-11-17T22:59:59Z')), '2026-11-17');
assert.equal(marketingToday(new Date('2026-11-17T23:00:00Z')), '2026-11-18');
const jobs = [], days = [];
const db = {
  studioJob: { findMany: async query => { jobs.push(query); return []; } },
  marketingDay: {
    findMany: async query => { days.push(query); return []; },
    count: async query => { days.push(query); return 8; },
  },
};
const controller = new DashboardController(db, { businessId: async req => { assert.equal(req.user.id, 'owner'); return 'owned-business'; } });
const result = await controller.activity({ user: { id: 'owner' } });
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
