const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/admin-report-gross-margin.js');

test('gross margin report normalises nested row payloads before summarising', () => {
  const rows = __test.normaliseRows({
    rows: [
      { currency: 'GBP', candidateId: 'cand-1', candidateName: 'Jamie', weekNo: 1, totals: { pay: 100, charge: 160, gp: 60 } },
      { currency: 'GBP', candidateId: 'cand-2', candidateName: 'Lewis', weekNo: 2, totals: { pay: 120, charge: 195, gp: 75 } },
    ],
  });

  assert.equal(rows.length, 2);

  const summary = __test.summarise({ rows });
  assert.equal(summary.currencies.GBP.pay, 220);
  assert.equal(summary.currencies.GBP.charge, 355);
  assert.equal(summary.currencies.GBP.gp, 135);
  assert.equal(summary.contractors.length, 2);
  assert.equal(summary.weeks[1].gp, 60);
  assert.equal(summary.weeks[2].gp, 75);
});

test('gross margin report summarise safely returns empty buckets for invalid row payloads', () => {
  const summary = __test.summarise(null);
  assert.deepEqual(summary, { currencies: {}, contractors: [], weeks: {} });
});
