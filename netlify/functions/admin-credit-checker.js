'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { fetchSettings, saveSettings } = require('./_settings-helpers.js');
const { recordAudit } = require('./_audit.js');
const {
  TURNOVER_BANDS,
  YEARS_TRADING_BANDS,
  SECTOR_OPTIONS,
  LEAD_STATUSES,
  normaliseSettings,
  trimString,
} = require('../../lib/credit-limit-checker.js');

const TABLE = 'credit_limit_checker_leads';

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function jsonResponse(statusCode, body, headers) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  };
}

function toCsv(rows) {
  const columns = [
    'lead_reference',
    'created_at',
    'status',
    'full_name',
    'company_name',
    'email',
    'phone',
    'turnover_band',
    'years_trading_band',
    'sector',
    'indicative_low',
    'indicative_mid',
    'indicative_high',
    'indicative_range_label',
    'assigned_to',
    'follow_up_date',
    'admin_notes',
  ];

  return [columns.join(',')].concat(
    rows.map(function (row) {
      return columns.map(function (column) {
        const value = row && row[column] != null ? String(row[column]) : '';
        return '"' + value.replace(/"/g, '""') + '"';
      }).join(',');
    })
  ).join('\r\n');
}

function buildStats(rows) {
  const stats = {
    total: rows.length,
    new: 0,
    contacted: 0,
    qualified: 0,
    closed: 0,
  };

  rows.forEach(function (row) {
    const key = trimString(row?.status, 40).toLowerCase();
    if (key && Object.prototype.hasOwnProperty.call(stats, key)) {
      stats[key] += 1;
    }
  });

  return stats;
}

async function listLeads(supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function exportLeads(supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadSettings(event) {
  const result = await fetchSettings(event, ['credit_checker_settings']);
  return normaliseSettings(result?.settings?.credit_checker_settings);
}

function normaliseLeadPatch(body) {
  const input = body && typeof body === 'object' ? body : {};
  const status = trimString(input.status, 40).toLowerCase();
  const followUpDate = trimString(input.follow_up_date != null ? input.follow_up_date : input.followUpDate, 20);
  return {
    id: trimString(input.id, 80),
    status: LEAD_STATUSES.some(function (item) { return item.value === status; }) ? status : '',
    assigned_to: trimString(input.assigned_to != null ? input.assigned_to : input.assignedTo, 160),
    admin_notes: trimString(input.admin_notes != null ? input.admin_notes : input.adminNotes, 4000),
    follow_up_date: /^\d{4}-\d{2}-\d{2}$/.test(followUpDate) ? followUpDate : null,
  };
}

async function updateLead(supabase, patch, actor) {
  if (!patch.id) throw coded(400, 'Lead id is required.');

  const { data: existing, error: existingError } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', patch.id)
    .single();

  if (existingError) throw existingError;
  if (!existing) throw coded(404, 'Lead not found.');

  const next = {
    updated_at: new Date().toISOString(),
    assigned_to: patch.assigned_to || null,
    admin_notes: patch.admin_notes || '',
    follow_up_date: patch.follow_up_date,
  };

  if (patch.status) {
    next.status = patch.status;
    if (patch.status === 'contacted' && !existing.contacted_at) {
      next.contacted_at = new Date().toISOString();
    }
    if (patch.status === 'qualified' && !existing.qualified_at) {
      next.qualified_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(next)
    .eq('id', patch.id)
    .select('*')
    .single();

  if (error) throw error;

  await recordAudit({
    actor,
    action: 'credit_checker_lead_updated',
    targetType: 'credit_checker_lead',
    targetId: patch.id,
    meta: {
      leadReference: existing.lead_reference,
      status: patch.status || existing.status,
      assignedTo: patch.assigned_to || '',
    },
  });

  return data;
}

async function saveCreditCheckerSettings(event, actor, nextInput) {
  const settings = normaliseSettings(nextInput);
  await saveSettings(event, {
    credit_checker_settings: settings,
  });

  await recordAudit({
    actor,
    action: 'credit_checker_settings_saved',
    targetType: 'credit_checker_settings',
    targetId: 'credit_checker_settings',
    meta: {
      enabled: settings.enabled,
      widgetEnabled: settings.widgetEnabled,
      recipients: settings.notificationRecipients,
    },
  });

  return settings;
}

module.exports.handler = withAdminCors(async function handler(event, context) {
  const method = String(event?.httpMethod || '').toUpperCase();
  const body = parseBody(event);
  const action = trimString(
    method === 'GET'
      ? event?.queryStringParameters?.action
      : body.action,
    80
  ).toLowerCase() || 'bootstrap';

  const { user, supabase } = await getContext(event, context, { requireAdmin: true });
  if (!supabase) throw coded(503, 'Supabase is unavailable for the credit checker module.');

  if (method === 'GET' && action === 'export') {
    const rows = await exportLeads(supabase);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/csv',
        'content-disposition': `attachment; filename="hmj-credit-checker-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
      body: toCsv(rows),
    };
  }

  if (method === 'POST' && action === 'update_lead') {
    const patch = normaliseLeadPatch(body);
    const lead = await updateLead(supabase, patch, user);
    return jsonResponse(200, { ok: true, lead });
  }

  if (method === 'POST' && action === 'save_settings') {
    const settings = await saveCreditCheckerSettings(event, user, body.settings);
    return jsonResponse(200, { ok: true, settings });
  }

  if (method !== 'GET') {
    throw coded(405, 'Method not allowed.');
  }

  const [settings, leads] = await Promise.all([
    loadSettings(event),
    listLeads(supabase),
  ]);

  return jsonResponse(200, {
    ok: true,
    viewer: {
      email: user?.email || '',
    },
    stats: buildStats(leads),
    settings,
    leads,
    options: {
      statuses: LEAD_STATUSES,
      turnoverBands: TURNOVER_BANDS,
      yearsTradingBands: YEARS_TRADING_BANDS,
      sectors: SECTOR_OPTIONS,
    },
  });
});
