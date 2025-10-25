// netlify/functions/admin-payroll-list.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { supabaseStatus } = require('./_supabase.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');
const { loadStaticAssignments } = require('./_assignments-helpers.js');
const { fetchSettings, DEFAULT_SETTINGS, fiscalWeekNumber } = require('./_settings-helpers.js');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function ensureObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normaliseBank(source = {}) {
  const bank = ensureObject(source.bank || source);
  return {
    name: source.bank_name || bank.name || bank.bank_name || null,
    sortCode: source.bank_sort_code || source.bank_sort || bank.sort_code || null,
    account: source.bank_account || bank.account_number || null,
    iban: source.bank_iban || bank.iban || null,
    swift: source.bank_swift || bank.swift || bank.bic || null,
  };
}

function normalisePerson(row = {}) {
  if (!row) return null;
  const first = row.first_name || row.firstName || '';
  const last = row.last_name || row.lastName || '';
  const name = (row.name || `${first} ${last}`.trim()) || null;
  return {
    id: row.id ?? null,
    name,
    firstName: first || null,
    lastName: last || null,
    email: row.email || null,
    phone: row.phone || null,
    payrollRef: row.payroll_ref || row.payrollRef || null,
    payType: row.pay_type || row.payType || null,
    taxId: row.tax_id || row.taxId || null,
    bank: normaliseBank(row),
    raw: row,
  };
}

function derivePayrollStatus(timesheet = {}, auditLog = null) {
  const meta = ensureObject(auditLog?.meta);
  const fromMeta = meta.status || auditLog?.action || null;
  if (fromMeta) {
    const v = String(fromMeta).toLowerCase();
    if (['paid', 'hold', 'processing', 'ready', 'pending'].includes(v)) {
      return v;
    }
  }
  const tsStatus = String(timesheet.status || '').toLowerCase();
  if (tsStatus === 'approved') return 'ready';
  if (tsStatus === 'submitted') return 'pending';
  if (tsStatus === 'rejected') return 'blocked';
  return 'draft';
}

function summarise(rows = []) {
  const byStatus = new Map();
  let totalPay = 0;
  let totalCharge = 0;
  let totalHours = 0;
  const byCurrency = new Map();

  rows.forEach((row) => {
    const status = row.payrollStatus || 'ready';
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    totalPay += toNumber(row.totals?.pay);
    totalCharge += toNumber(row.totals?.charge);
    totalHours += toNumber(row.totals?.hours);
    const cur = row.currency || row.assignment?.currency || 'GBP';
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + toNumber(row.totals?.pay));
  });

  return {
    total: rows.length,
    totalPay,
    totalCharge,
    totalHours,
    byStatus: Object.fromEntries(byStatus.entries()),
    byCurrency: Object.fromEntries(byCurrency.entries()),
  };
}

function toCsv(rows = []) {
  const header = [
    'Timesheet ID',
    'Week ending',
    'Week #',
    'Payroll status',
    'Candidate',
    'Payroll ref',
    'Pay type',
    'Email',
    'Phone',
    'Bank name',
    'Sort code',
    'Account',
    'IBAN',
    'SWIFT/BIC',
    'Job title',
    'Client',
    'Project',
    'Site',
    'Assignment ref',
    'Hours',
    'OT hours',
    'Pay amount',
    'Charge amount',
    'Currency',
    'Notes',
  ];

  const lines = rows.map((row) => {
    const c = row.candidate || {};
    const bank = c.bank || {};
    const assignment = row.assignment || {};
    const cells = [
      row.id,
      row.weekEnding || '',
      row.weekNo || '',
      row.payrollStatus || '',
      c.name || row.candidateName || '',
      c.payrollRef || '',
      c.payType || '',
      c.email || '',
      c.phone || '',
      bank.name || '',
      bank.sortCode || '',
      bank.account || '',
      bank.iban || '',
      bank.swift || '',
      assignment.jobTitle || '',
      assignment.clientName || '',
      row.projectName || '',
      row.siteName || '',
      assignment.ref || '',
      toNumber(row.totals?.hours),
      toNumber(row.totals?.ot),
      toNumber(row.totals?.pay),
      toNumber(row.totals?.charge),
      row.currency || assignment.currency || 'GBP',
      row.notes || '',
    ];
    return cells
      .map((value) => {
        const text = value === null || value === undefined ? '' : String(value);
        if (/[",\n]/.test(text)) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      })
      .join(',');
  });

  return [header.join(','), ...lines].join('\n');
}

const baseHandler = async (event, context) => {
  try {
    const { supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
    const body = JSON.parse(event.body || '{}');
    const { status = 'all', q = '', weekFrom, weekTo, ids, limit, format } = body;
    const settingsResult = await fetchSettings(event, ['fiscal_week1_ending']);
    const baseWeekEnding = settingsResult.settings?.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;
    const wantsCsv = String(format || '').toLowerCase() === 'csv';
    const searchNeedle = String(q || '').trim().toLowerCase();

    if (!supabase || typeof supabase.from !== 'function') {
      const staticTimesheets = loadStaticTimesheets(baseWeekEnding);
      if (!staticTimesheets.length) {
        const reason = supabaseError?.message || 'Supabase not configured';
        return { statusCode: 503, body: JSON.stringify({ error: reason, code: 'supabase_unavailable' }) };
      }

      const assignments = loadStaticAssignments();
      const assignmentMap = new Map(assignments.map((a) => [Number(a.id), a]));

      const filteredRows = staticTimesheets
        .filter((ts) => {
          if (Array.isArray(ids) && ids.length && !ids.map(String).includes(String(ts.id))) return false;
          if (weekFrom && ts.week_ending < weekFrom) return false;
          if (weekTo && ts.week_ending > weekTo) return false;
          if (status && status !== 'all') {
            const wanted = new Set(String(status).split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
            if (wanted.size && !wanted.has(String(ts.payroll_status || ts.status || '').toLowerCase())) {
              return false;
            }
          }
          if (searchNeedle) {
            const haystack = [
              ts.id,
              ts.candidate_name,
              ts.assignment_ref,
              ts.client_name,
              ts.project_name,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(searchNeedle)) return false;
          }
          return true;
        })
        .map((ts) => {
          const assignment = assignmentMap.get(Number(ts.assignment_id)) || ts.assignment || null;
          const candidate = ts.candidate || null;
          const payrollStatus = String(ts.payroll_status || ts.status || '').toLowerCase() || 'pending';
          const bank = {
            name: candidate?.bank?.name || candidate?.bank_name || null,
            sortCode: candidate?.bank?.sort_code || candidate?.sort_code || candidate?.bank_sort_code || null,
            account: candidate?.bank?.account_number || candidate?.bank_account || null,
            iban: candidate?.bank?.iban || candidate?.bank_iban || null,
            swift: candidate?.bank?.swift || candidate?.bank_swift || null,
          };

          const weekNo = ts.week_no ?? fiscalWeekNumber(ts.week_ending, baseWeekEnding);
          return {
            id: ts.id,
            weekEnding: ts.week_ending,
            weekStart: ts.week_start,
            status: ts.status,
            payrollStatus,
            candidateId: ts.candidate_id,
            candidateName: ts.candidate_name || candidate?.full_name || null,
            candidate: candidate
              ? {
                  name: candidate.name || candidate.full_name || candidate.fullName || ts.candidate_name || null,
                  payrollRef: candidate.payrollRef || candidate.payroll_ref || null,
                  payType: candidate.payType || candidate.pay_type || null,
                  email: candidate.email || null,
                  phone: candidate.phone || null,
                  bank,
                }
              : null,
            assignmentId: ts.assignment_id,
            assignment: assignment
              ? {
                  id: assignment.id,
                  jobTitle: assignment.job_title || assignment.jobTitle || null,
                  clientName: assignment.client_name || assignment.clientName || ts.client_name || null,
                  ref: assignment.as_ref || assignment.ref || ts.assignment_ref || null,
                  payFreq: assignment.pay_freq || null,
                  currency: assignment.currency || ts.currency || 'GBP',
                  poNumber: assignment.po_number || null,
                }
              : ts.assignment || null,
            projectName: ts.project_name || assignment?.project_name || assignment?.projectName || null,
            siteName: assignment?.site_name || assignment?.siteName || null,
            totals: {
              hours: Number(ts.total_hours || 0),
              ot: Number(ts.ot_hours || 0),
              pay: Number(ts.pay_amount || 0),
              charge: Number(ts.charge_amount || 0),
            },
            rate: {
              pay: Number(ts.rate_pay || (assignment && assignment.rate_pay) || 0),
              charge: Number(ts.rate_charge || (assignment && assignment.charge_std) || 0),
            },
            currency: ts.currency || assignment?.currency || 'GBP',
            approvedAt: ts.approved_at || null,
            submittedAt: ts.submitted_at || null,
            updatedAt: ts.approved_at || ts.submitted_at || ts.week_ending || null,
            audit: null,
            notes: ts.notes || '',
            weekNo,
          };
        });

      const stats = summarise(filteredRows);
      const payload = {
        rows: filteredRows,
        stats,
        readOnly: true,
        source: 'static',
        supabase: supabaseStatus(),
        config: { week1Ending: baseWeekEnding, source: settingsResult.source },
      };

      if (wantsCsv) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="payroll.csv"',
          },
          body: toCsv(filteredRows),
        };
      }

      console.warn('[payroll] using static fallback dataset (%d rows)', filteredRows.length);
      return { statusCode: 200, body: JSON.stringify(payload) };
    }

    let query = supabase
      .from('timesheets')
      .select(
        `id,week_start,week_ending,status,submitted_at,approved_at,assignment_id,assignment_ref,candidate_id,candidate_name,client_name,total_hours,ot_hours,pay_amount,charge_amount,rate_pay,rate_charge,currency,approver_email,notes`
      )
      .order('week_ending', { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 250, 50), 500));

    if (Array.isArray(ids) && ids.length) {
      query = query.in('id', ids);
    }
    if (weekFrom) {
      query = query.gte('week_ending', weekFrom);
    }
    if (weekTo) {
      query = query.lte('week_ending', weekTo);
    }

    const { data: timesheetRows, error: timesheetError } = await query;
    if (timesheetError) throw timesheetError;

    const timesheets = Array.isArray(timesheetRows) ? timesheetRows : [];
    if (!timesheets.length) {
      const payload = { rows: [], stats: summarise([]) };
      if (wantsCsv) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="payroll.csv"',
          },
          body: toCsv([]),
        };
      }
      return { statusCode: 200, body: JSON.stringify(payload) };
    }

    const assignmentIds = Array.from(new Set(timesheets.map((ts) => ts.assignment_id).filter(Boolean)));
    const candidateIds = Array.from(new Set(timesheets.map((ts) => ts.candidate_id).filter(Boolean)));
    const timesheetIds = timesheets.map((ts) => ts.id).filter((id) => id !== null && id !== undefined);

    let assignments = [];
    if (assignmentIds.length) {
      const { data, error } = await supabase
        .from('assignments')
        .select('id,job_title,client_name,po_number,pay_freq,currency,rate_pay,rate_std,contractor_id,as_ref,project_id,site_id')
        .in('id', assignmentIds);
      if (error) throw error;
      assignments = Array.isArray(data) ? data : [];
    }

    const projectIds = Array.from(new Set(assignments.map((a) => a.project_id).filter(Boolean)));
    const siteIds = Array.from(new Set(assignments.map((a) => a.site_id).filter(Boolean)));

    let projects = [];
    if (projectIds.length) {
      const { data, error } = await supabase.from('projects').select('id,name').in('id', projectIds);
      if (error) throw error;
      projects = Array.isArray(data) ? data : [];
    }

    let sites = [];
    if (siteIds.length) {
      const { data, error } = await supabase.from('sites').select('id,name').in('id', siteIds);
      if (error) throw error;
      sites = Array.isArray(data) ? data : [];
    }

    let candidates = [];
    if (candidateIds.length) {
      const { data, error } = await supabase
        .from('candidates')
        .select(
          'id,first_name,last_name,email,phone,payroll_ref,pay_type,bank_sort_code,bank_sort,bank_account,bank_name,bank_iban,bank_swift,tax_id'
        )
        .in('id', candidateIds);
      if (error) throw error;
      candidates = Array.isArray(data) ? data : [];
    }

    let contractors = [];
    if (candidateIds.length) {
      const { data, error } = await supabase
        .from('contractors')
        .select('id,name,email,phone,payroll_ref,pay_type,bank,address_json,emergency_contact')
        .in('id', candidateIds);
      if (error) throw error;
      contractors = Array.isArray(data) ? data : [];
    }

    let auditLogs = [];
    if (timesheetIds.length) {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select('id,at,action,target_id,meta,actor_email')
        .eq('target_type', 'payroll')
        .in('target_id', timesheetIds.map((id) => String(id)))
        .order('at', { ascending: false });
      if (error) throw error;
      auditLogs = Array.isArray(data) ? data : [];
    }

    const assignmentMap = new Map(assignments.map((a) => [a.id, a]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const candidateMap = new Map(candidates.map((c) => [c.id, normalisePerson(c)]));
    const contractorMap = new Map(contractors.map((c) => [c.id, normalisePerson(c)]));
    const auditMap = new Map();
    auditLogs.forEach((log) => {
      const key = log?.target_id;
      if (!auditMap.has(key)) {
        auditMap.set(key, log);
      }
    });

    const filteredRows = timesheets
      .map((ts) => {
        const assignment = assignmentMap.get(ts.assignment_id) || null;
        const candidate = candidateMap.get(ts.candidate_id) || contractorMap.get(ts.candidate_id) || null;
        const audit = auditMap.get(String(ts.id)) || null;
        const payrollStatus = derivePayrollStatus(ts, audit);
        const project = assignment?.project_id ? projectMap.get(assignment.project_id) : null;
        const site = assignment?.site_id ? siteMap.get(assignment.site_id) : null;
        const totals = {
          hours: toNumber(ts.total_hours),
          ot: toNumber(ts.ot_hours),
          pay: toNumber(ts.pay_amount || ts.rate_pay * ts.total_hours),
          charge: toNumber(ts.charge_amount || ts.rate_charge * ts.total_hours),
        };
        const meta = ensureObject(audit?.meta);
        const breakdown = {
          mon: toNumber(ts.h_mon || meta?.hours?.mon),
          tue: toNumber(ts.h_tue || meta?.hours?.tue),
          wed: toNumber(ts.h_wed || meta?.hours?.wed),
          thu: toNumber(ts.h_thu || meta?.hours?.thu),
          fri: toNumber(ts.h_fri || meta?.hours?.fri),
          sat: toNumber(ts.h_sat || meta?.hours?.sat),
          sun: toNumber(ts.h_sun || meta?.hours?.sun),
        };
        const hasBreakdown = Object.values(breakdown).some((v) => Number.isFinite(v) && v > 0);
        const attachments = Array.isArray(meta?.attachments)
          ? meta.attachments
          : Array.isArray(ts.attachments)
          ? ts.attachments
          : [];
        const statusHistory = Array.isArray(meta?.history) ? meta.history : [];
        return {
          id: ts.id,
          weekEnding: ts.week_ending,
          weekStart: ts.week_start,
          status: ts.status,
          payrollStatus,
          weekNo: fiscalWeekNumber(ts.week_ending, baseWeekEnding),
          candidateId: ts.candidate_id,
          candidateName: ts.candidate_name || candidate?.name || null,
          candidate,
          assignmentId: ts.assignment_id,
          assignment: assignment
            ? {
                id: assignment.id,
                jobTitle: assignment.job_title,
                clientName: assignment.client_name,
                ref: assignment.as_ref || ts.assignment_ref || null,
                payFreq: assignment.pay_freq || null,
                currency: assignment.currency || ts.currency || 'GBP',
                poNumber: assignment.po_number || ts.po_number || meta?.po_number || null,
              }
            : null,
          projectName: project?.name || null,
          siteName: site?.name || null,
          totals,
          rate: {
            pay: toNumber(ts.rate_pay || assignment?.rate_pay),
            charge: toNumber(ts.rate_charge || assignment?.rate_charge),
          },
          currency: ts.currency || assignment?.currency || 'GBP',
          approvedAt: ts.approved_at || null,
          submittedAt: ts.submitted_at || null,
          updatedAt: ts.approved_at || ts.submitted_at || ts.week_ending || null,
          invoiceRef: ts.invoice_ref || meta?.invoice_ref || null,
          costCentre: ts.cost_centre || meta?.cost_centre || assignment?.cost_centre || null,
          poNumber: ts.po_number || assignment?.po_number || meta?.po_number || null,
          breakdown: hasBreakdown ? breakdown : null,
          attachments,
          statusHistory,
          audit: audit
            ? {
                id: audit.id,
                at: audit.at,
                action: audit.action,
                actor: audit.actor_email || null,
                meta,
              }
            : null,
          notes: ts.notes || meta.note || '',
        };
      })
      .filter((row) => {
        if (status && status !== 'all') {
          const wanted = new Set(String(status).split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
          if (wanted.size && !wanted.has(String(row.payrollStatus || '').toLowerCase())) {
            return false;
          }
        }
        if (searchNeedle) {
          const haystack = [
            row.id,
            row.candidateName,
            row.candidate?.payrollRef,
            row.candidate?.email,
            row.assignment?.jobTitle,
            row.assignment?.clientName,
            row.assignment?.ref,
            row.projectName,
            row.siteName,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(searchNeedle)) {
            return false;
          }
        }
        return true;
      });

    const stats = summarise(filteredRows);
    const payload = { rows: filteredRows, stats, config: { week1Ending: baseWeekEnding, source: settingsResult.source } };

    if (wantsCsv) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="payroll.csv"',
        },
        body: toCsv(filteredRows),
      };
    }

    return { statusCode: 200, body: JSON.stringify(payload) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Failed to load payroll' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
