const DAY_KEYS = ['h_mon', 'h_tue', 'h_wed', 'h_thu', 'h_fri', 'h_sat', 'h_sun'];

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  return /^1|true|yes|on$/i.test(String(value).trim());
}

function sumDayHours(row = {}) {
  return DAY_KEYS.reduce((sum, key) => sum + toNumber(row[key]), 0);
}

function normaliseTimesheet(row = {}) {
  const assignment = row.assignments || row.assignment || {};
  const project = assignment.projects || assignment.project || {};
  const client = project.clients || project.client || {};

  const totalHours = toNumber(row.total_hours || row.totalHours || sumDayHours(row));
  const otHours = toNumber(row.ot_hours || row.otHours);
  const stdHours = Math.max(totalHours - otHours, 0);
  const rateStd = toNumber(row.rate_pay || row.rate_std);
  const rateOt = toNumber(row.rate_ot || row.rate_charge);
  const payAmount = toNumber(row.pay_amount);
  const chargeAmount = toNumber(row.charge_amount);

  const computedPay = payAmount || rateStd * stdHours + rateOt * otHours;
  const computedCharge = chargeAmount || toNumber(row.rate_charge) * (stdHours + otHours);
  const gpAmount = Number.isFinite(toNumber(row.gp_amount)) && toNumber(row.gp_amount) !== 0
    ? toNumber(row.gp_amount)
    : computedCharge - computedPay;

  const clientId = row.client_id || assignment.client_id || project.client_id || client.id || null;
  const clientName = row.client_name || assignment.client_name || client.name || null;
  const projectId = row.project_id || assignment.project_id || project.id || null;
  const projectName = row.project_name || project.name || null;
  const contractorEmail = row.contractor_email || assignment.contractor_email || null;
  const contractorName = row.contractor_name || assignment.contractor_name || row.candidate_name || null;
  const contractorId = assignment.contractor_id || row.contractor_id || row.candidate_id || null;
  const payrollMeta = row.payroll_meta && typeof row.payroll_meta === 'object' ? row.payroll_meta : {};

  return {
    id: row.id,
    assignment_id: row.assignment_id || assignment.id || null,
    assignment_ref: row.assignment_ref || assignment.as_ref || assignment.ref || null,
    ts_ref: row.ts_ref || null,
    contractor_id: contractorId,
    contractor_name: contractorName,
    contractor_email: contractorEmail,
    client_id: clientId,
    client_name: clientName,
    project_id: projectId,
    project_name: projectName,
    week_ending: row.week_ending || row.weekEnding || null,
    status: row.status || null,
    payroll_status: (row.payroll_status || row.pay_status || payrollMeta.status || row.status || 'draft').toLowerCase(),
    payroll_batch: row.payroll_batch || payrollMeta.batch || null,
    paid_at: row.paid_at || payrollMeta.paid_at || null,
    payment_reference: row.payment_reference || payrollMeta.reference || null,
    total_hours: totalHours,
    std_hours: stdHours,
    ot_hours: otHours,
    rate_std: rateStd,
    rate_ot: rateOt,
    pay_amount: computedPay,
    charge_amount: computedCharge,
    gp_amount: gpAmount,
    currency: row.currency || assignment.currency || 'GBP',
  };
}

function buildWarnings(rows = [], { includeUnapproved } = {}) {
  const warnings = [];
  const emailMap = new Map();

  rows.forEach((row) => {
    const status = String(row.status || '').toLowerCase();
    const totalHours = toNumber(row.std_hours) + toNumber(row.ot_hours);

    if (!row.contractor_name || !row.contractor_email) {
      warnings.push({
        type: 'missing_contractor',
        message: 'Missing contractor name or email.',
        row_id: row.id,
        ts_ref: row.ts_ref,
        contractor_email: row.contractor_email || null,
        contractor_id: row.contractor_id || null,
      });
    }

    if (!Number.isFinite(row.rate_std) || row.rate_std <= 0 || totalHours <= 0) {
      warnings.push({
        type: 'missing_rate_or_hours',
        message: 'Missing pay rate or hours.',
        row_id: row.id,
        ts_ref: row.ts_ref,
        contractor_email: row.contractor_email || null,
        contractor_id: row.contractor_id || null,
      });
    }

    if (toNumber(row.std_hours) < 0 || toNumber(row.ot_hours) < 0 || toNumber(row.pay_amount) < 0) {
      warnings.push({
        type: 'negative_values',
        message: 'Negative hours or pay detected.',
        row_id: row.id,
        ts_ref: row.ts_ref,
        contractor_email: row.contractor_email || null,
        contractor_id: row.contractor_id || null,
      });
    }

    if (!includeUnapproved && status && status !== 'approved') {
      warnings.push({
        type: 'unapproved_timesheet',
        message: 'Timesheet is not approved.',
        row_id: row.id,
        ts_ref: row.ts_ref,
        contractor_email: row.contractor_email || null,
        contractor_id: row.contractor_id || null,
        status,
      });
    }

    if (String(row.currency || '').toUpperCase() !== 'GBP') {
      warnings.push({
        type: 'non_gbp_currency',
        message: 'Currency is not GBP.',
        row_id: row.id,
        ts_ref: row.ts_ref,
        currency: row.currency || null,
      });
    }

    if (!row.client_id && !row.client_name) {
      warnings.push({
        type: 'missing_client',
        message: 'Missing client reference.',
        row_id: row.id,
        ts_ref: row.ts_ref,
      });
    }

    if (!row.project_id && !row.project_name) {
      warnings.push({
        type: 'missing_project',
        message: 'Missing project reference.',
        row_id: row.id,
        ts_ref: row.ts_ref,
      });
    }

    if (row.contractor_email) {
      const emailKey = String(row.contractor_email).toLowerCase();
      if (!emailMap.has(emailKey)) {
        emailMap.set(emailKey, new Set());
      }
      if (row.contractor_id) {
        emailMap.get(emailKey).add(String(row.contractor_id));
      }
    }
  });

  emailMap.forEach((ids, email) => {
    if (ids.size > 1) {
      warnings.push({
        type: 'duplicate_contractor_email',
        message: 'Duplicate contractor email with differing IDs.',
        contractor_email: email,
        contractor_ids: Array.from(ids),
      });
    }
  });

  return warnings;
}

function buildTotals(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.std_hours += toNumber(row.std_hours);
      acc.ot_hours += toNumber(row.ot_hours);
      acc.pay_amount += toNumber(row.pay_amount);
      acc.charge_amount += toNumber(row.charge_amount);
      acc.gp_amount += toNumber(row.gp_amount);
      return acc;
    },
    {
      std_hours: 0,
      ot_hours: 0,
      pay_amount: 0,
      charge_amount: 0,
      gp_amount: 0,
    }
  );
}

function groupByContractor(rows = []) {
  const map = new Map();

  rows.forEach((row) => {
    const key = row.contractor_id || row.contractor_email || row.contractor_name || row.id;
    if (!map.has(key)) {
      map.set(key, {
        contractor_id: row.contractor_id || null,
        contractor_name: row.contractor_name || null,
        contractor_email: row.contractor_email || null,
        std_hours: 0,
        ot_hours: 0,
        pay_amount: 0,
        charge_amount: 0,
        gp_amount: 0,
        timesheet_count: 0,
      });
    }
    const entry = map.get(key);
    entry.std_hours += toNumber(row.std_hours);
    entry.ot_hours += toNumber(row.ot_hours);
    entry.pay_amount += toNumber(row.pay_amount);
    entry.charge_amount += toNumber(row.charge_amount);
    entry.gp_amount += toNumber(row.gp_amount);
    entry.timesheet_count += 1;
  });

  return Array.from(map.values()).sort((a, b) => {
    const nameA = a.contractor_name || '';
    const nameB = b.contractor_name || '';
    return nameA.localeCompare(nameB);
  });
}

function sortItems(rows = []) {
  return [...rows].sort((a, b) => {
    const nameA = a.contractor_name || '';
    const nameB = b.contractor_name || '';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    const refA = a.ts_ref || '';
    const refB = b.ts_ref || '';
    return refA.localeCompare(refB);
  });
}

function buildCsv(rows = [], format = 'generic') {
  const header = [
    'contractor_name',
    'contractor_email',
    'week_ending',
    'std_hours',
    'ot_hours',
    'rate_std',
    'rate_ot',
    'pay_amount',
    'client_name',
    'project_name',
    'assignment_ref',
    'ts_ref',
  ];

  const lines = rows.map((row) => {
    const cells = [
      row.contractor_name,
      row.contractor_email,
      row.week_ending,
      toNumber(row.std_hours),
      toNumber(row.ot_hours),
      toNumber(row.rate_std),
      toNumber(row.rate_ot),
      toNumber(row.pay_amount),
      row.client_name,
      row.project_name,
      row.assignment_ref,
      row.ts_ref,
    ];
    return cells
      .map((value) => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(',');
  });

  return {
    header,
    csv: [header.join(','), ...lines].join('\n'),
    format,
  };
}

module.exports = {
  parseBoolean,
  toNumber,
  normaliseTimesheet,
  buildWarnings,
  buildTotals,
  groupByContractor,
  sortItems,
  buildCsv,
};
