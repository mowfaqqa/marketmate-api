import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { calculate, validDate } = require("../dist/sales/money.js");
const line = {
  description: "Cotton shirt",
  quantity: "2.000",
  unitPriceKobo: 1000000,
  discountKobo: 200000,
  taxRate: "0.0500",
};
const result = calculate([line], 100000);
assert.equal(result.totals.subtotalKobo, 2000000);
assert.equal(result.totals.taxKobo, 90000);
assert.equal(result.totals.totalKobo, 1990000);
assert.equal(result.totals.totalKobo - 990000, 1000000);
assert.equal(
  calculate(
    [
      {
        ...line,
        quantity: "0.500",
        unitPriceKobo: 1,
        discountKobo: 0,
        taxRate: "0",
      },
    ],
    0,
  ).totals.totalKobo,
  1,
  "half kobo rounds up",
);
assert.equal(
  calculate(
    [
      {
        ...line,
        quantity: "1",
        unitPriceKobo: 10,
        discountKobo: 0,
        taxRate: "0.05",
      },
    ],
    0,
  ).totals.taxKobo,
  1,
  "half kobo line tax rounds up",
);
for (const quantity of ["0", "-1", "1.0001", "1000000.001", "1e2", "NaN"])
  assert.throws(() => calculate([{ ...line, quantity }], 0));
for (const unitPriceKobo of [-1, 1.5, Number.MAX_SAFE_INTEGER, NaN])
  assert.throws(() => calculate([{ ...line, unitPriceKobo }], 0));
assert.throws(() => calculate([{ ...line, discountKobo: 2000001 }], 0));
assert.throws(() => calculate([{ ...line, taxRate: "1.0001" }], 0));
assert.throws(() =>
  calculate(
    [{ ...line, quantity: "1000000", unitPriceKobo: 1000000000000 }],
    0,
  ),
);
assert.throws(() => calculate([], 0));
assert.throws(() => calculate(Array(51).fill(line), 0));
assert.equal(validDate("2026-02-30"), false);
assert.equal(validDate("2028-02-29"), true);
console.log(
  "Sales money checks passed: exact PRD fixture, rounding, bounds, invalid decimals and dates.",
);
