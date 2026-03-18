'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { buildCashflowForecast } = require('../../lib/finance-cashflow.js');
const {
  getFinanceSchemaStatus,
  readCashflowState,
  readFinanceConnection,
  normalizeConnectionForClient,
  upsertAssumptions,
  upsertCustomer,
  upsertFundingRule,
  upsertInvoicePlan,
  upsertOverhead,
  upsertAdjustment,
  deleteFinanceRecord,
} = require('./_finance-store.js');
const { buildQboDiagnostics } = require('./_finance-qbo.js');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload, null, 2),
  };
}

async function buildPayload(event, scenarioKey = 'base', scenarioPreset = 'base') {
  const schema = await getFinanceSchemaStatus(event);
  const connection = schema.ready ? await readFinanceConnection(event).catch(() => null) : null;
  const qbo = buildQboDiagnostics(event, connection, schema.ready);
  if (!schema.ready) {
    return {
      ok: true,
      schema,
      qbo,
      state: null,
      forecast: null,
    };
  }

  const state = await readCashflowState(event, scenarioKey);
  const forecast = buildCashflowForecast({
    ...state,
    scenarioPreset,
  });
  return {
    ok: true,
    schema,
    qbo,
    connection: connection ? normalizeConnectionForClient(connection) : null,
    state,
    forecast,
  };
}

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const method = String(event.httpMethod || 'GET').toUpperCase();

  if (method === 'GET') {
    const scenarioKey = (event.queryStringParameters && event.queryStringParameters.scenario) || 'base';
    const scenarioPreset = (event.queryStringParameters && event.queryStringParameters.preset) || 'base';
    return json(200, await buildPayload(event, scenarioKey, scenarioPreset));
  }

  const schema = await getFinanceSchemaStatus(event);
  if (!schema.ready) {
    return json(409, {
      ok: false,
      error: 'finance_schema_missing',
      schema,
    });
  }

  const payload = event.body ? JSON.parse(event.body) : {};
  const action = String(payload.action || '').trim();
  const input = payload.payload || {};
  const savedBy = user?.email || 'admin';

  if (action === 'saveAssumptions') {
    await upsertAssumptions(event, input, savedBy);
  } else if (action === 'saveCustomer') {
    await upsertCustomer(event, input, savedBy);
  } else if (action === 'saveFundingRule') {
    await upsertFundingRule(event, input, savedBy);
  } else if (action === 'saveInvoicePlan') {
    await upsertInvoicePlan(event, input, savedBy);
  } else if (action === 'saveOverhead') {
    await upsertOverhead(event, input, savedBy);
  } else if (action === 'saveAdjustment') {
    await upsertAdjustment(event, input, savedBy);
  } else if (action === 'deleteRecord') {
    await deleteFinanceRecord(event, String(input.table || ''), String(input.id || ''));
  } else {
    return json(400, {
      ok: false,
      error: 'unsupported_finance_action',
      action,
    });
  }

  const scenarioKey = input.scenario_key || input.scenarioKey || payload.scenario || 'base';
  const scenarioPreset = payload.preset || 'base';
  return json(200, await buildPayload(event, scenarioKey, scenarioPreset));
});
