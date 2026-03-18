'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  getFinanceSchemaStatus,
  readFinanceConnection,
  saveFinanceConnection,
  createSyncRun,
  updateSyncRun,
  replaceCacheRows,
  normalizeConnectionForClient,
  saveQboRuntimeStatus,
} = require('./_finance-store.js');
const { syncQuickBooksData, buildQboDiagnostics, logQbo } = require('./_finance-qbo.js');

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload, null, 2),
  };
}

function mapCustomerRows(connectionId, rows = []) {
  return rows.map((row) => ({
    connection_id: connectionId,
    qbo_customer_id: trimString(row.Id, 240),
    display_name: trimString(row.DisplayName, 240),
    primary_email: trimString(row.PrimaryEmailAddr?.Address, 320).toLowerCase(),
    currency: trimString(row.CurrencyRef?.value || row.CurrencyRef?.name, 16) || 'GBP',
    balance: Number(row.Balance || 0),
    is_active: row.Active !== false,
    raw: row,
    synced_at: new Date().toISOString(),
  }));
}

function mapInvoiceRows(connectionId, rows = []) {
  return rows.map((row) => ({
    connection_id: connectionId,
    qbo_invoice_id: trimString(row.Id, 240),
    customer_id: trimString(row.CustomerRef?.value, 240),
    customer_name: trimString(row.CustomerRef?.name, 240),
    doc_number: trimString(row.DocNumber, 120),
    txn_date: trimString(row.TxnDate, 80) || null,
    due_date: trimString(row.DueDate, 80) || null,
    total_amount: Number(row.TotalAmt || 0),
    balance_amount: Number(row.Balance || 0),
    currency: trimString(row.CurrencyRef?.value || row.CurrencyRef?.name, 16) || 'GBP',
    exchange_rate: Number(row.ExchangeRate || 0) || null,
    status: Number(row.Balance || 0) > 0 ? 'open' : 'paid',
    raw: row,
    synced_at: new Date().toISOString(),
  }));
}

function mapPaymentRows(connectionId, rows = []) {
  return rows.map((row) => ({
    connection_id: connectionId,
    qbo_payment_id: trimString(row.Id, 240),
    customer_id: trimString(row.CustomerRef?.value, 240),
    customer_name: trimString(row.CustomerRef?.name, 240),
    txn_date: trimString(row.TxnDate, 80) || null,
    total_amount: Number(row.TotalAmt || 0),
    unapplied_amount: Number(row.UnappliedAmt || 0),
    currency: trimString(row.CurrencyRef?.value || row.CurrencyRef?.name, 16) || 'GBP',
    payment_ref: trimString(row.PaymentRefNum, 240),
    raw: row,
    synced_at: new Date().toISOString(),
  }));
}

function mapBillRows(connectionId, rows = []) {
  return rows.map((row) => ({
    connection_id: connectionId,
    qbo_bill_id: trimString(row.Id, 240),
    vendor_name: trimString(row.VendorRef?.name, 240),
    txn_date: trimString(row.TxnDate, 80) || null,
    due_date: trimString(row.DueDate, 80) || null,
    total_amount: Number(row.TotalAmt || 0),
    balance_amount: Number(row.Balance || 0),
    currency: trimString(row.CurrencyRef?.value || row.CurrencyRef?.name, 16) || 'GBP',
    raw: row,
    synced_at: new Date().toISOString(),
  }));
}

function mapPurchaseRows(connectionId, rows = []) {
  return rows.map((row) => ({
    connection_id: connectionId,
    qbo_purchase_id: trimString(row.Id, 240),
    payee_name: trimString(row.EntityRef?.name, 240),
    txn_date: trimString(row.TxnDate, 80) || null,
    total_amount: Number(row.TotalAmt || 0),
    currency: trimString(row.CurrencyRef?.value || row.CurrencyRef?.name, 16) || 'GBP',
    payment_type: trimString(row.PaymentType, 80),
    raw: row,
    synced_at: new Date().toISOString(),
  }));
}

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const schema = await getFinanceSchemaStatus(event);
  if (!schema.ready) {
    return json(409, { ok: false, error: 'finance_schema_missing', schema });
  }

  const connection = await readFinanceConnection(event).catch(() => null);
  const diagnostics = buildQboDiagnostics(event, connection, schema.ready);
  if (!connection) {
    await saveQboRuntimeStatus(event, {
      lastEvent: 'sync_blocked',
      lastEventAt: new Date().toISOString(),
      lastError: 'QuickBooks is not connected.',
      lastErrorAt: new Date().toISOString(),
    }, user?.email || '').catch(() => null);
    return json(409, { ok: false, error: 'qbo_not_connected', diagnostics });
  }

  logQbo('sync_started', {
    email: user?.email,
    realmId: connection.realm_id,
    connectionId: connection.id,
  });
  await saveQboRuntimeStatus(event, {
    lastEvent: 'sync_started',
    lastEventAt: new Date().toISOString(),
    lastError: '',
    connectedEmail: connection.connected_email,
    realmId: connection.realm_id,
  }, user?.email || '').catch(() => null);

  const run = await createSyncRun(event, {
    connectionId: connection.id,
    syncType: 'manual',
    status: 'running',
    createdBy: user?.email || 'admin',
  });

  try {
    const result = await syncQuickBooksData(event, connection);
    await Promise.all([
      replaceCacheRows(event, 'finance_qbo_customers_cache', mapCustomerRows(connection.id, result.customers), 'qbo_customer_id'),
      replaceCacheRows(event, 'finance_qbo_invoices_cache', mapInvoiceRows(connection.id, result.invoices), 'qbo_invoice_id'),
      replaceCacheRows(event, 'finance_qbo_payments_cache', mapPaymentRows(connection.id, result.payments), 'qbo_payment_id'),
      replaceCacheRows(event, 'finance_qbo_bills_cache', mapBillRows(connection.id, result.bills), 'qbo_bill_id'),
      replaceCacheRows(event, 'finance_qbo_purchases_cache', mapPurchaseRows(connection.id, result.purchases), 'qbo_purchase_id'),
    ]);

    await saveFinanceConnection(event, {
      ...connection,
      companyName: result.company?.CompanyName || result.company?.LegalName || connection.company_name,
      accessToken: result.connection.access_token,
      refreshToken: result.connection.refresh_token,
      accessTokenExpiresAt: result.connection.access_token_expires_at,
      connectedBy: connection.connected_by,
      connectedEmail: connection.connected_email,
      lastSyncAt: new Date().toISOString(),
      lastError: '',
      status: 'connected',
      rawCompany: result.company,
    });
    await updateSyncRun(event, run.id, {
      status: 'completed',
      entityCounts: result.counts,
    });
    await saveQboRuntimeStatus(event, {
      lastEvent: 'sync_completed',
      lastEventAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: '',
      lastErrorAt: '',
      connectedEmail: connection.connected_email,
      realmId: connection.realm_id,
      lastSyncCounts: result.counts,
    }, user?.email || '').catch(() => null);
    logQbo('sync_completed', {
      email: user?.email,
      realmId: connection.realm_id,
      counts: result.counts,
    });

    return json(200, {
      ok: true,
      synced: true,
      counts: result.counts,
      connection: normalizeConnectionForClient(await readFinanceConnection(event)),
    });
  } catch (error) {
    await saveFinanceConnection(event, {
      ...connection,
      accessToken: connection.access_token,
      refreshToken: connection.refresh_token,
      accessTokenExpiresAt: connection.access_token_expires_at,
      connectedBy: connection.connected_by,
      connectedEmail: connection.connected_email,
      lastError: error?.message || 'QuickBooks sync failed.',
      status: 'error',
    }).catch(() => null);
    await updateSyncRun(event, run.id, {
      status: 'failed',
      errorMessage: error?.message || 'QuickBooks sync failed.',
    }).catch(() => null);
    await saveQboRuntimeStatus(event, {
      lastEvent: 'sync_failed',
      lastEventAt: new Date().toISOString(),
      lastError: error?.message || 'QuickBooks sync failed.',
      lastErrorAt: new Date().toISOString(),
      connectedEmail: connection.connected_email,
      realmId: connection.realm_id,
    }, user?.email || '').catch(() => null);
    logQbo('sync_failed', {
      email: user?.email,
      realmId: connection.realm_id,
      error: error?.message,
      code: error?.code || error?.status || '',
    });
    return json(Number(error?.code) || 500, {
      ok: false,
      error: error?.message || 'QuickBooks sync failed.',
      diagnostics,
    });
  }
});
