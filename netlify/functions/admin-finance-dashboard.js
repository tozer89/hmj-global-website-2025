'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { buildDashboardSnapshot } = require('../../lib/finance-cashflow.js');
const {
  getFinanceSchemaStatus,
  readFinanceConnection,
  normalizeConnectionForClient,
  listRecentSyncRuns,
  readCashflowState,
  readQboRuntimeStatus,
} = require('./_finance-store.js');
const { buildQboDiagnostics } = require('./_finance-qbo.js');

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const schema = await getFinanceSchemaStatus(event);
  const connection = schema.ready ? await readFinanceConnection(event).catch(() => null) : null;
  const runtimeStatus = schema.ready ? await readQboRuntimeStatus(event).catch(() => ({})) : {};
  const qbo = buildQboDiagnostics(event, connection, schema.ready);
  const syncRuns = schema.ready ? await listRecentSyncRuns(event, 8).catch(() => []) : [];

  let cashflowSummary = null;
  if (schema.ready) {
    try {
      const state = await readCashflowState(event, 'base');
      cashflowSummary = buildDashboardSnapshot(state);
    } catch (error) {
      cashflowSummary = {
        error: error?.message || 'Cashflow preview unavailable.',
      };
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      finance: {
        schema,
        qbo,
        qboRuntimeStatus: runtimeStatus,
        connection: connection ? normalizeConnectionForClient(connection) : null,
        cashflowSummary,
        recentSyncRuns: syncRuns,
        modules: [
          {
            key: 'deal_profit_calc',
            title: 'Deal Profit Calc',
            href: '/admin/deal-profit-calc.html',
            status: 'Live',
            detail: 'Model charge rates, finance costs, and net assignment profit across multiple horizons.',
          },
          {
            key: 'cashflow',
            title: '13 Week Cashflow Forecast',
            href: '/admin/finance/cashflow.html',
            status: schema.ready ? 'Live' : 'Setup needed',
            detail: 'Rolling 13-week working-capital forecast with actuals, assumptions, and funding overlays.',
          },
          {
            key: 'credit',
            title: 'Credit Limit Forecaster',
            href: '/admin/credit-limit-forecaster.html',
            status: 'Live',
            detail: 'Insured headroom, contractor capacity, and debtor timing planning.',
          },
          {
            key: 'quickbooks',
            title: 'QuickBooks Connection',
            href: '/admin/finance/quickbooks.html',
            status: qbo.connectReady ? (connection ? 'Connected' : 'Ready to connect') : 'Needs config',
            detail: 'OAuth, sync status, cached accounting data, and refresh control.',
          },
          {
            key: 'ar',
            title: 'AR / Funding Analysis',
            href: '/admin/finance/',
            status: 'Planned',
            detail: 'Accounts receivable ageing, funding drawdown, and retention release analysis.',
          },
          {
            key: 'vat',
            title: 'VAT Planner',
            href: '/admin/finance/',
            status: 'Planned',
            detail: 'Quarterly VAT exposure and reverse-charge forecasting for cash planning.',
          },
        ],
      },
      viewer: {
        email: user?.email || '',
      },
    }, null, 2),
  };
});
