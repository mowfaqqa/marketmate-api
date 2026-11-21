import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { calculate } = require('../dist/sales/money.js');
const { renderSalesPdf } = require('../dist/sales/pdf.js');
const output = '/tmp/marketmate-sales-qa'; await mkdir(output, { recursive: true });
const item = { description: 'Cotton shirt — Émilie’s collection', quantity: '2', unitPriceKobo: 1000000, discountKobo: 200000, taxRate: '0.05' };
const base = { type: 'INVOICE', status: 'ISSUED', number: 'INV-000001', issueDate: '2026-11-17', dueDate: '2026-12-17', seller: { name: 'MarketMate test shop', location: 'Abuja', contact: '+2348000000000' }, buyer: { name: 'Émilie Aliyu', address: 'Test address', phone: '', email: 'synthetic@example.com' }, ...calculate([item], 100000), notes: 'Synthetic fixture — no real customer data.', paymentInstructions: 'Example instructions only.', voidReason: null, templateVersion: 1, sourceQuotationId: null, replacesId: null };
for (const [name, row] of [['single', base], ['void', { ...base, status: 'VOID', voidReason: 'Correction test' }], ['long', { ...base, ...calculate(Array.from({ length: 50 }, (_, i) => ({ ...item, description: `${i + 1}: ${'Long description with safe wrapping. '.repeat(12)}` })), 100000), notes: 'Long terms. '.repeat(170) }]]) {
  const buffer = await renderSalesPdf(row); assert.ok(buffer.subarray(0, 4).toString() === '%PDF'); await writeFile(`${output}/${name}.pdf`, buffer);
  execFileSync('pdftotext', [`${output}/${name}.pdf`, `${output}/${name}.txt`]); const text = await readFile(`${output}/${name}.txt`, 'utf8');
  assert.match(text, /INV-000001/); assert.match(text, /Émilie/); assert.match(text, /Payment instructions/);
  if (name === 'single') assert.match(text, /19,900\.00/);
  if (name === 'void') assert.match(text, /VOID/);
  if (name === 'long') { assert.match(text, /50: Long/); assert.match(text, /946,000\.00/); }
}
console.log('Sales PDF checks passed: exact totals, accents, VOID label, 50 long lines and long terms. Fixtures in /tmp/marketmate-sales-qa.');
