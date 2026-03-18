'use strict';

const { getSupabase } = require('./_supabase.js');
const { trimString, encryptValue, decryptValue } = require('./_finance-crypto.js');
const {
  startOfIsoWeek,
  normalizeDate,
  normalizeCurrency,
  normalizeVatTreatment,
  toNumber,
} = require('../../lib/finance-cashflow.js');

const FINANCE_TABLES = [
  'finance_module_settings',
  'finance_cashflow_assumptions',
  'finance_customers',
  'finance_funding_rules',
  'finance_cashflow_invoice_plans',
  'finance_cashflow_overheads',
  'finance_cashflow_adjustments',
  'finance_cashflow_weeks',
  'finance_qbo_connections',
  'finance_qbo_sync_runs',
  'finance_qbo_customers_cache',
  'finance_qbo_invoices_cache',
  'finance_qbo_payments_cache',
  'finance_qbo_bills_cache',
  'finance_qbo_purchases_cache',
];

function lowerText(value, maxLength) {
  return trimString(value, maxLength).toLowerCase();
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = lowerText(value, 24);
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function asJson(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return fallback;
}

async function probeTable(event, table) {
  const supabase = getSupabase(event);
  const { error, count } = await supabase
    .from(table)
    .select('*', { head: true, count: 'exact' })
    .limit(1);
  if (!error) {
    return {
      ready: true,
      count: Number.isFinite(count) ? count : null,
      error: '',
    };
  }
  return {
    ready: false,
    count: null,
    error: trimString(error.message, 400) || 'Unknown table error',
  };
}

async function getFinanceSchemaStatus(event) {
  const checks = await Promise.all(FINANCE_TABLES.map(async (table) => ({
    table,
    ...(await probeTable(event, table)),
  })));
  const missing = checks.filter((row) => row.ready !== true);
  return {
    ready: missing.length === 0,
    checks,
    missingTables: missing.map((row) => row.table),
  };
}

async function listRows(event, table, queryBuilder) {
  const supabase = getSupabase(event);
  let query = supabase.from(table).select('*');
  if (typeof queryBuilder === 'function') query = queryBuilder(query) || query;
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function readFinanceConnection(event) {
  const rows = await listRows(event, 'finance_qbo_connections', (query) => query
    .eq('provider', 'quickbooks')
    .eq('is_active', true)
    .order('connected_at', { ascending: false })
    .limit(1));
  const row = rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    access_token: row.encrypted_access_token ? decryptValue(row.encrypted_access_token) : '',
    refresh_token: row.encrypted_refresh_token ? decryptValue(row.encrypted_refresh_token) : '',
  };
}

async function saveFinanceConnection(event, input = {}) {
  const supabase = getSupabase(event);
  const row = {
    provider: 'quickbooks',
    environment: lowerText(input.environment, 20) === 'sandbox' ? 'sandbox' : 'production',
    realm_id: trimString(input.realmId ?? input.realm_id, 240),
    company_name: trimString(input.companyName ?? input.company_name, 240),
    encrypted_access_token: trimString(input.accessToken ?? input.access_token, 16000)
      ? encryptValue(input.accessToken ?? input.access_token)
      : null,
    encrypted_refresh_token: trimString(input.refreshToken ?? input.refresh_token, 16000)
      ? encryptValue(input.refreshToken ?? input.refresh_token)
      : null,
    access_token_expires_at: trimString(input.accessTokenExpiresAt ?? input.access_token_expires_at, 80) || null,
    scope: Array.isArray(input.scope) ? input.scope : String(input.scope || '').split(/[,\s]+/).filter(Boolean),
    connected_by: trimString(input.connectedBy ?? input.connected_by, 240),
    connected_email: lowerText(input.connectedEmail ?? input.connected_email, 320),
    connected_at: trimString(input.connectedAt ?? input.connected_at, 80) || new Date().toISOString(),
    is_active: input.isActive !== false,
    last_sync_at: trimString(input.lastSyncAt ?? input.last_sync_at, 80) || null,
    last_error: trimString(input.lastError ?? input.last_error, 2000) || null,
    status: trimString(input.status, 40) || 'connected',
    raw_company: asJson(input.rawCompany ?? input.raw_company, {}),
  };

  const { data, error } = await supabase
    .from('finance_qbo_connections')
    .upsert(row, { onConflict: 'provider,realm_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function disconnectFinanceConnection(event, connectionId) {
  const supabase = getSupabase(event);
  const { error } = await supabase
    .from('finance_qbo_connections')
    .update({
      is_active: false,
      status: 'disconnected',
      last_error: '',
    })
    .eq('id', trimString(connectionId, 120));
  if (error) throw error;
}

async function createSyncRun(event, input = {}) {
  const supabase = getSupabase(event);
  const row = {
    connection_id: trimString(input.connectionId, 120) || null,
    sync_type: trimString(input.syncType, 80) || 'manual',
    status: trimString(input.status, 40) || 'running',
    started_at: trimString(input.startedAt, 80) || new Date().toISOString(),
    completed_at: trimString(input.completedAt, 80) || null,
    entity_counts: asJson(input.entityCounts, {}),
    error_message: trimString(input.errorMessage, 2000) || null,
    created_by: trimString(input.createdBy, 240) || '',
  };
  const { data, error } = await supabase
    .from('finance_qbo_sync_runs')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateSyncRun(event, runId, input = {}) {
  const supabase = getSupabase(event);
  const row = {
    status: trimString(input.status, 40) || 'completed',
    completed_at: trimString(input.completedAt, 80) || new Date().toISOString(),
    entity_counts: asJson(input.entityCounts, {}),
    error_message: trimString(input.errorMessage, 2000) || null,
  };
  const { data, error } = await supabase
    .from('finance_qbo_sync_runs')
    .update(row)
    .eq('id', trimString(runId, 120))
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listRecentSyncRuns(event, limit = 10) {
  return listRows(event, 'finance_qbo_sync_runs', (query) => query
    .order('started_at', { ascending: false })
    .limit(limit));
}

async function replaceCacheRows(event, table, rows = [], conflictColumns) {
  const supabase = getSupabase(event);
  if (!Array.isArray(rows) || !rows.length) return [];
  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictColumns })
    .select('*');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function readCashflowState(event, scenarioKey = 'base') {
  const supabase = getSupabase(event);
  const scenario = trimString(scenarioKey, 80) || 'base';
  const [
    assumptionsRows,
    customers,
    fundingRules,
    invoicePlans,
    overheads,
    adjustments,
    weekOverrides,
    qboCustomers,
    qboInvoices,
    qboPayments,
    qboBills,
    qboPurchases,
  ] = await Promise.all([
    listRows(event, 'finance_cashflow_assumptions', (query) => query.eq('scenario_key', scenario).limit(1)),
    listRows(event, 'finance_customers', (query) => query.eq('scenario_key', scenario).eq('is_active', true).order('customer_name', { ascending: true })),
    listRows(event, 'finance_funding_rules', (query) => query.eq('scenario_key', scenario).eq('is_active', true).order('customer_name', { ascending: true })),
    listRows(event, 'finance_cashflow_invoice_plans', (query) => query.eq('scenario_key', scenario).order('invoice_date', { ascending: true })),
    listRows(event, 'finance_cashflow_overheads', (query) => query.eq('scenario_key', scenario).eq('is_active', true).order('first_due_date', { ascending: true })),
    listRows(event, 'finance_cashflow_adjustments', (query) => query.eq('scenario_key', scenario).order('effective_date', { ascending: true })),
    listRows(event, 'finance_cashflow_weeks', (query) => query.eq('scenario_key', scenario).order('week_start', { ascending: true })),
    listRows(event, 'finance_qbo_customers_cache', (query) => query.order('display_name', { ascending: true }).limit(500)),
    listRows(event, 'finance_qbo_invoices_cache', (query) => query.order('due_date', { ascending: true }).limit(1000)),
    listRows(event, 'finance_qbo_payments_cache', (query) => query.order('txn_date', { ascending: false }).limit(1000)),
    listRows(event, 'finance_qbo_bills_cache', (query) => query.order('due_date', { ascending: true }).limit(1000)),
    listRows(event, 'finance_qbo_purchases_cache', (query) => query.order('txn_date', { ascending: false }).limit(1000)),
  ]);

  return {
    assumptions: assumptionsRows[0] || {
      scenario_key: scenario,
      opening_balance: 0,
      reporting_currency: 'GBP',
      anchor_week_start: startOfIsoWeek(new Date().toISOString()),
      eur_to_gbp_rate: 0.86,
      include_qbo_open_invoices: true,
      include_qbo_open_bills: true,
      include_qbo_purchases_actuals: true,
    },
    customers,
    fundingRules,
    invoicePlans,
    overheads,
    adjustments,
    weekOverrides,
    qboCustomers,
    qboInvoices,
    qboPayments,
    qboBills,
    qboPurchases,
  };
}

function normalizeAssumptionInput(input = {}, savedBy = '') {
  return {
    scenario_key: trimString(input.scenario_key ?? input.scenarioKey, 80) || 'base',
    scenario_label: trimString(input.scenario_label ?? input.scenarioLabel, 120) || 'Base',
    anchor_week_start: startOfIsoWeek(input.anchor_week_start ?? input.anchorWeekStart ?? new Date().toISOString()),
    opening_balance: toNumber(input.opening_balance ?? input.openingBalance, 0),
    reporting_currency: normalizeCurrency(input.reporting_currency ?? input.reportingCurrency, 'GBP'),
    eur_to_gbp_rate: toNumber(input.eur_to_gbp_rate ?? input.eurToGbpRate, 0.86),
    include_qbo_open_invoices: toBoolean(input.include_qbo_open_invoices ?? input.includeQboOpenInvoices, true),
    include_qbo_open_bills: toBoolean(input.include_qbo_open_bills ?? input.includeQboOpenBills, true),
    include_qbo_purchases_actuals: toBoolean(input.include_qbo_purchases_actuals ?? input.includeQboPurchasesActuals, true),
    notes: trimString(input.notes, 2000),
    updated_by: trimString(savedBy, 240),
  };
}

async function upsertAssumptions(event, input = {}, savedBy = '') {
  const supabase = getSupabase(event);
  const row = normalizeAssumptionInput(input, savedBy);
  const { data, error } = await supabase
    .from('finance_cashflow_assumptions')
    .upsert(row, { onConflict: 'scenario_key' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function normalizeCustomerInput(input = {}, savedBy = '') {
  return {
    id: trimString(input.id, 120) || undefined,
    scenario_key: trimString(input.scenario_key ?? input.scenarioKey, 80) || 'base',
    customer_name: trimString(input.customer_name ?? input.customerName, 240),
    external_customer_id: trimString(input.external_customer_id ?? input.externalCustomerId, 240),
    default_currency: normalizeCurrency(input.default_currency ?? input.defaultCurrency, 'GBP'),
    vat_treatment: normalizeVatTreatment(input.vat_treatment ?? input.vatTreatment),
    vat_rate: toNumber(input.vat_rate ?? input.vatRate, 20),
    expected_payment_days: Math.max(0, Math.round(toNumber(input.expected_payment_days ?? input.expectedPaymentDays, 30))),
    funding_enabled: toBoolean(input.funding_enabled ?? input.fundingEnabled, false),
    margin_percent: toNumber(input.margin_percent ?? input.marginPercent, 0),
    is_active: toBoolean(input.is_active ?? input.isActive, true),
    notes: trimString(input.notes, 2000),
    created_by: trimString(savedBy, 240),
    updated_by: trimString(savedBy, 240),
  };
}

async function upsertCustomer(event, input = {}, savedBy = '') {
  const supabase = getSupabase(event);
  const row = normalizeCustomerInput(input, savedBy);
  const { data, error } = await supabase
    .from('finance_customers')
    .upsert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function normalizeFundingRuleInput(input = {}, savedBy = '') {
  return {
    id: trimString(input.id, 120) || undefined,
    scenario_key: trimString(input.scenario_key ?? input.scenarioKey, 80) || 'base',
    customer_name: trimString(input.customer_name ?? input.customerName, 240),
    advance_percent: toNumber(input.advance_percent ?? input.advancePercent, 90),
    retention_percent: toNumber(input.retention_percent ?? input.retentionPercent, 10),
    fee_percent: toNumber(input.fee_percent ?? input.feePercent, 1.5),
    interest_percent: toNumber(input.interest_percent ?? input.interestPercent, 0),
    settlement_lag_days: Math.max(0, Math.round(toNumber(input.settlement_lag_days ?? input.settlementLagDays, 14))),
    funded_on_issue: toBoolean(input.funded_on_issue ?? input.fundedOnIssue, true),
    is_active: toBoolean(input.is_active ?? input.isActive, true),
    notes: trimString(input.notes, 2000),
    created_by: trimString(savedBy, 240),
    updated_by: trimString(savedBy, 240),
  };
}

async function upsertFundingRule(event, input = {}, savedBy = '') {
  const supabase = getSupabase(event);
  const row = normalizeFundingRuleInput(input, savedBy);
  const { data, error } = await supabase
    .from('finance_funding_rules')
    .upsert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function normalizeInvoicePlanInput(input = {}, savedBy = '') {
  return {
    id: trimString(input.id, 120) || undefined,
    scenario_key: trimString(input.scenario_key ?? input.scenarioKey, 80) || 'base',
    customer_name: trimString(input.customer_name ?? input.customerName, 240),
    description: trimString(input.description, 240),
    source_system: trimString(input.source_system ?? input.sourceSystem, 80) || 'hmj_admin',
    source_reference: trimString(input.source_reference ?? input.sourceReference, 240),
    invoice_date: normalizeDate(input.invoice_date ?? input.invoiceDate),
    expected_payment_date: normalizeDate(input.expected_payment_date ?? input.expectedPaymentDate),
    currency: normalizeCurrency(input.currency, 'GBP'),
    net_amount: toNumber(input.net_amount ?? input.netAmount, 0),
    vat_amount: toNumber(input.vat_amount ?? input.vatAmount, 0),
    gross_amount: toNumber(input.gross_amount ?? input.grossAmount, 0),
    vat_treatment: normalizeVatTreatment(input.vat_treatment ?? input.vatTreatment),
    vat_rate: toNumber(input.vat_rate ?? input.vatRate, 20),
    funded: toBoolean(input.funded, false),
    status: trimString(input.status, 40) || 'forecast',
    notes: trimString(input.notes, 2000),
    created_by: trimString(savedBy, 240),
    updated_by: trimString(savedBy, 240),
  };
}

async function upsertInvoicePlan(event, input = {}, savedBy = '') {
  const supabase = getSupabase(event);
  const row = normalizeInvoicePlanInput(input, savedBy);
  const { data, error } = await supabase
    .from('finance_cashflow_invoice_plans')
    .upsert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function normalizeOverheadInput(input = {}, savedBy = '') {
  return {
    id: trimString(input.id, 120) || undefined,
    scenario_key: trimString(input.scenario_key ?? input.scenarioKey, 80) || 'base',
    label: trimString(input.label, 240),
    category: trimString(input.category, 80) || 'overheads',
    amount: toNumber(input.amount, 0),
    currency: normalizeCurrency(input.currency, 'GBP'),
    first_due_date: normalizeDate(input.first_due_date ?? input.firstDueDate ?? input.due_date ?? input.dueDate),
    frequency: trimString(input.frequency, 40) || 'monthly',
    interval_count: Math.max(1, Math.round(toNumber(input.interval_count ?? input.intervalCount, 1))),
    is_active: toBoolean(input.is_active ?? input.isActive, true),
    source_system: trimString(input.source_system ?? input.sourceSystem, 80) || 'hmj_admin',
    notes: trimString(input.notes, 2000),
    created_by: trimString(savedBy, 240),
    updated_by: trimString(savedBy, 240),
  };
}

async function upsertOverhead(event, input = {}, savedBy = '') {
  const supabase = getSupabase(event);
  const row = normalizeOverheadInput(input, savedBy);
  const { data, error } = await supabase
    .from('finance_cashflow_overheads')
    .upsert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function normalizeAdjustmentInput(input = {}, savedBy = '') {
  return {
    id: trimString(input.id, 120) || undefined,
    scenario_key: trimString(input.scenario_key ?? input.scenarioKey, 80) || 'base',
    label: trimString(input.label, 240),
    direction: lowerText(input.direction, 20) === 'inflow' ? 'inflow' : 'outflow',
    category: trimString(input.category, 80) || 'adjustments',
    amount: toNumber(input.amount, 0),
    currency: normalizeCurrency(input.currency, 'GBP'),
    effective_date: normalizeDate(input.effective_date ?? input.effectiveDate),
    is_actual: toBoolean(input.is_actual ?? input.isActual, false),
    notes: trimString(input.notes, 2000),
    created_by: trimString(savedBy, 240),
    updated_by: trimString(savedBy, 240),
  };
}

async function upsertAdjustment(event, input = {}, savedBy = '') {
  const supabase = getSupabase(event);
  const row = normalizeAdjustmentInput(input, savedBy);
  const { data, error } = await supabase
    .from('finance_cashflow_adjustments')
    .upsert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteFinanceRecord(event, table, id) {
  const supabase = getSupabase(event);
  const allowed = new Set([
    'finance_customers',
    'finance_funding_rules',
    'finance_cashflow_invoice_plans',
    'finance_cashflow_overheads',
    'finance_cashflow_adjustments',
  ]);
  if (!allowed.has(table)) {
    const error = new Error('Unsupported finance delete target.');
    error.code = 400;
    throw error;
  }
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', trimString(id, 120));
  if (error) throw error;
  return { ok: true };
}

function normalizeConnectionForClient(row = {}) {
  if (!row) return null;
  return {
    id: trimString(row.id, 120),
    provider: 'quickbooks',
    environment: trimString(row.environment, 20) || 'production',
    realmId: trimString(row.realm_id, 240),
    companyName: trimString(row.company_name, 240),
    connectedAt: trimString(row.connected_at, 80),
    connectedBy: trimString(row.connected_by, 240),
    connectedEmail: trimString(row.connected_email, 320),
    accessTokenExpiresAt: trimString(row.access_token_expires_at, 80),
    lastSyncAt: trimString(row.last_sync_at, 80),
    lastError: trimString(row.last_error, 2000),
    status: trimString(row.status, 40) || 'disconnected',
    scope: Array.isArray(row.scope) ? row.scope : [],
    isActive: row.is_active === true,
    rawCompany: asJson(row.raw_company, {}),
  };
}

module.exports = {
  FINANCE_TABLES,
  trimString,
  lowerText,
  toBoolean,
  getFinanceSchemaStatus,
  readFinanceConnection,
  saveFinanceConnection,
  disconnectFinanceConnection,
  createSyncRun,
  updateSyncRun,
  listRecentSyncRuns,
  replaceCacheRows,
  readCashflowState,
  upsertAssumptions,
  upsertCustomer,
  upsertFundingRule,
  upsertInvoicePlan,
  upsertOverhead,
  upsertAdjustment,
  deleteFinanceRecord,
  normalizeConnectionForClient,
};
