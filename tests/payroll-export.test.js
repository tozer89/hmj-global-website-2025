const {
  buildWarnings,
  buildTotals,
  groupByContractor,
  sortItems,
} = require('../netlify/functions/_payroll-export.js');

describe('payroll export helpers', () => {
  test('buildWarnings flags missing contractor, rates, and unapproved rows', () => {
    const rows = [
      {
        id: 1,
        contractor_name: '',
        contractor_email: null,
        rate_std: 0,
        std_hours: 0,
        ot_hours: 0,
        pay_amount: 100,
        status: 'submitted',
        currency: 'GBP',
      },
    ];

    const warnings = buildWarnings(rows, { includeUnapproved: false });
    const types = warnings.map((w) => w.type);

    expect(types).toContain('missing_contractor');
    expect(types).toContain('missing_rate_or_hours');
    expect(types).toContain('unapproved_timesheet');
  });

  test('buildWarnings flags duplicate contractor emails with different IDs', () => {
    const rows = [
      { id: 1, contractor_email: 'test@example.com', contractor_id: '1', status: 'approved', currency: 'GBP' },
      { id: 2, contractor_email: 'test@example.com', contractor_id: '2', status: 'approved', currency: 'GBP' },
    ];

    const warnings = buildWarnings(rows, { includeUnapproved: true });
    const dup = warnings.find((w) => w.type === 'duplicate_contractor_email');

    expect(dup).toBeTruthy();
    expect(dup.contractor_ids).toEqual(expect.arrayContaining(['1', '2']));
  });

  test('buildTotals and groupByContractor aggregate values', () => {
    const rows = [
      {
        contractor_id: 'c1',
        contractor_name: 'Alpha',
        std_hours: 5,
        ot_hours: 1,
        pay_amount: 200,
        charge_amount: 300,
        gp_amount: 100,
      },
      {
        contractor_id: 'c1',
        contractor_name: 'Alpha',
        std_hours: 3,
        ot_hours: 0,
        pay_amount: 120,
        charge_amount: 180,
        gp_amount: 60,
      },
    ];

    const totals = buildTotals(rows);
    const grouped = groupByContractor(rows);

    expect(totals.std_hours).toBe(8);
    expect(totals.pay_amount).toBe(320);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].timesheet_count).toBe(2);
  });

  test('sortItems orders by contractor name then ts_ref', () => {
    const rows = [
      { contractor_name: 'Bravo', ts_ref: 'T2' },
      { contractor_name: 'Alpha', ts_ref: 'T3' },
      { contractor_name: 'Alpha', ts_ref: 'T1' },
    ];

    const sorted = sortItems(rows);
    expect(sorted[0].ts_ref).toBe('T1');
    expect(sorted[1].ts_ref).toBe('T3');
    expect(sorted[2].contractor_name).toBe('Bravo');
  });
});
