'use strict';

const { createHmac } = require('node:crypto');
const {
  trimString,
  readFinanceConnection,
  saveFinanceConnection,
  normalizeConnectionForClient,
} = require('./_finance-store.js');

const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
const QBO_AUTHORIZE_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function lowerText(value, maxLength) {
  return trimString(value, maxLength).toLowerCase();
}

function normaliseUrl(value) {
  const raw = trimString(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function resolveBaseUrl(event = {}) {
  const envValue = trimString(
    process.env.URL
      || process.env.HMJ_CANONICAL_SITE_URL
      || process.env.SITE_URL
      || process.env.DEPLOY_PRIME_URL
      || '',
    1000
  );
  if (envValue) {
    const normalised = normaliseUrl(envValue);
    if (normalised) return normalised;
  }

  const origin = trimString(event?.headers?.origin, 1000);
  if (origin) {
    const normalised = normaliseUrl(origin);
    if (normalised) return normalised;
  }

  const host = trimString(event?.headers?.['x-forwarded-host'] || event?.headers?.host, 1000);
  const proto = trimString(event?.headers?.['x-forwarded-proto'], 16) || 'https';
  if (host) {
    const normalised = normaliseUrl(`${proto}://${host}`);
    if (normalised) return normalised;
  }
  return '';
}

function resolveRedirectUri(event = {}) {
  const configured = normaliseUrl(process.env.QBO_REDIRECT_URI || '');
  if (configured) return configured;
  const baseUrl = resolveBaseUrl(event);
  return baseUrl ? `${baseUrl}/.netlify/functions/admin-finance-qbo-callback` : '';
}

function resolveQboEnvironment() {
  return lowerText(process.env.QBO_ENVIRONMENT, 20) === 'sandbox' ? 'sandbox' : 'production';
}

function resolveStateSecret() {
  return trimString(
    process.env.HMJ_FINANCE_SECRET
      || process.env.SUPABASE_JWT_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || '',
    4000
  );
}

function buildSignedState(data = {}) {
  const secret = resolveStateSecret();
  if (!secret) {
    const error = new Error('Missing HMJ_FINANCE_SECRET or service secret for QBO state signing.');
    error.code = 500;
    throw error;
  }
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function parseSignedState(raw) {
  const secret = resolveStateSecret();
  if (!secret) {
    const error = new Error('Missing HMJ_FINANCE_SECRET or service secret for QBO state signing.');
    error.code = 500;
    throw error;
  }
  const value = trimString(raw, 8000);
  const dot = value.lastIndexOf('.');
  if (dot <= 0) {
    const error = new Error('Invalid QuickBooks callback state.');
    error.code = 400;
    throw error;
  }
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (expected !== signature) {
    const error = new Error('QuickBooks callback state could not be verified.');
    error.code = 400;
    throw error;
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!decoded?.iat || (Date.now() - Number(decoded.iat)) > (20 * 60 * 1000)) {
    const error = new Error('QuickBooks connection state has expired. Start the connection again.');
    error.code = 400;
    throw error;
  }
  return decoded;
}

function buildQboDiagnostics(event = {}, connection = null, schemaReady = true) {
  const clientId = trimString(process.env.QBO_CLIENT_ID, 400);
  const clientSecret = trimString(process.env.QBO_CLIENT_SECRET, 400);
  const redirectUri = resolveRedirectUri(event);
  const baseUrl = resolveBaseUrl(event);
  const warnings = [];

  if (!schemaReady) warnings.push('Finance schema has not been applied to Supabase yet.');
  if (!clientId) warnings.push('QBO_CLIENT_ID is missing in Netlify.');
  if (!clientSecret) warnings.push('QBO_CLIENT_SECRET is missing in Netlify.');
  if (!redirectUri) warnings.push('QuickBooks redirect URI could not be resolved from Netlify/site settings.');

  return {
    configured: !!clientId && !!clientSecret,
    connectReady: !!clientId && !!clientSecret && !!redirectUri && schemaReady,
    environment: resolveQboEnvironment(),
    redirectUri,
    baseUrl,
    scope: QBO_SCOPE,
    warnings,
    connection: connection ? normalizeConnectionForClient(connection) : null,
  };
}

function buildReturnUrl(event = {}, path = '/admin/finance/quickbooks.html', params = {}) {
  const baseUrl = resolveBaseUrl(event);
  if (!baseUrl) return path;
  const url = new URL(path, `${baseUrl}/`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const next = trimString(value, 500);
    if (next) url.searchParams.set(key, next);
  });
  return url.toString();
}

function buildAuthUrl({ event, user, returnTo }) {
  const clientId = trimString(process.env.QBO_CLIENT_ID, 400);
  const redirectUri = resolveRedirectUri(event);
  if (!clientId || !redirectUri) {
    const error = new Error('QuickBooks client configuration is incomplete.');
    error.code = 500;
    throw error;
  }
  const state = buildSignedState({
    provider: 'quickbooks',
    userId: trimString(user?.id, 240),
    email: lowerText(user?.email, 320),
    returnTo: trimString(returnTo, 1000) || buildReturnUrl(event),
    iat: Date.now(),
  });
  const url = new URL(QBO_AUTHORIZE_BASE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', QBO_SCOPE);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return {
    url: url.toString(),
    state,
    redirectUri,
  };
}

async function qboTokenRequest(params = {}) {
  const clientId = trimString(process.env.QBO_CLIENT_ID, 400);
  const clientSecret = trimString(process.env.QBO_CLIENT_SECRET, 400);
  if (!clientId || !clientSecret) {
    const error = new Error('QuickBooks client credentials are missing from Netlify.');
    error.code = 500;
    throw error;
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(trimString(payload.error_description || payload.error || 'QuickBooks token request failed.', 500));
    error.code = response.status || 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

async function exchangeCodeForTokens(event, code) {
  return qboTokenRequest({
    grant_type: 'authorization_code',
    code: trimString(code, 4000),
    redirect_uri: resolveRedirectUri(event),
  });
}

async function refreshTokens(refreshToken) {
  return qboTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: trimString(refreshToken, 16000),
  });
}

function tokenExpiryIso(payload = {}) {
  const expiresIn = Number(payload.expires_in || 0);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return '';
  return new Date(Date.now() + (expiresIn * 1000)).toISOString();
}

function qboApiBase(connection) {
  const environment = lowerText(connection?.environment, 20) === 'sandbox' ? 'sandbox' : 'production';
  const host = environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
  const realmId = trimString(connection?.realm_id ?? connection?.realmId, 240);
  return `${host}/v3/company/${encodeURIComponent(realmId)}`;
}

async function qboFetch(connection, path, options = {}) {
  const accessToken = trimString(connection?.access_token ?? connection?.accessToken, 16000);
  if (!accessToken) {
    const error = new Error('QuickBooks access token is missing.');
    error.code = 401;
    throw error;
  }
  const url = new URL(path, `${qboApiBase(connection)}/`);
  const response = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': options.body ? 'application/json' : 'application/text',
      ...(options.headers || {}),
    },
    body: options.body || undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fault = payload?.Fault?.Error?.[0];
    const message = trimString(
      fault?.Detail || fault?.Message || payload?.error || 'QuickBooks API request failed.',
      500
    );
    const error = new Error(message);
    error.code = response.status || 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

async function qboQuery(connection, query) {
  const encoded = encodeURIComponent(query);
  return qboFetch(connection, `query?query=${encoded}&minorversion=70`);
}

async function pagedQuery(connection, queryTemplate) {
  const items = [];
  let start = 1;
  let done = false;
  while (!done) {
    const query = queryTemplate(start);
    const payload = await qboQuery(connection, query);
    const response = payload.QueryResponse || {};
    const keys = Object.keys(response).filter((key) => key !== 'startPosition' && key !== 'maxResults');
    const batch = keys.length ? response[keys[0]] : [];
    const nextItems = Array.isArray(batch) ? batch : [];
    items.push(...nextItems);
    if (nextItems.length < 1000) done = true;
    start += 1000;
  }
  return items;
}

async function fetchCompanyInfo(connection) {
  const payload = await qboFetch(connection, 'companyinfo/' + encodeURIComponent(connection.realm_id || connection.realmId));
  return payload.CompanyInfo || {};
}

async function ensureFreshConnection(event) {
  const current = await readFinanceConnection(event);
  if (!current) return null;
  const expiresAt = Date.parse(trimString(current.access_token_expires_at, 80) || '');
  if (Number.isFinite(expiresAt) && expiresAt > (Date.now() + (5 * 60 * 1000))) {
    return current;
  }
  const payload = await refreshTokens(current.refresh_token);
  await saveFinanceConnection(event, {
    ...current,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || current.refresh_token,
    accessTokenExpiresAt: tokenExpiryIso(payload),
    status: 'connected',
    lastError: '',
  });
  return readFinanceConnection(event);
}

async function connectFromCallback(event, user, callbackPayload = {}) {
  const company = await fetchCompanyInfo({
    realm_id: trimString(callbackPayload.realmId, 240),
    access_token: trimString(callbackPayload.accessToken, 16000),
    environment: callbackPayload.environment,
  }).catch(() => ({}));

  await saveFinanceConnection(event, {
    environment: callbackPayload.environment,
    realmId: callbackPayload.realmId,
    companyName: company?.CompanyName || company?.LegalName || '',
    accessToken: callbackPayload.accessToken,
    refreshToken: callbackPayload.refreshToken,
    accessTokenExpiresAt: callbackPayload.accessTokenExpiresAt,
    scope: [QBO_SCOPE],
    connectedBy: trimString(user?.email, 240),
    connectedEmail: trimString(user?.email, 320),
    status: 'connected',
    rawCompany: company,
  });
  return readFinanceConnection(event);
}

async function syncQuickBooksData(event, connection) {
  const current = connection || await ensureFreshConnection(event);
  if (!current) {
    const error = new Error('QuickBooks is not connected.');
    error.code = 400;
    throw error;
  }
  const company = current.raw_company && Object.keys(current.raw_company).length
    ? current.raw_company
    : await fetchCompanyInfo(current).catch(() => ({}));

  const [customers, invoices, payments, bills, purchases] = await Promise.all([
    pagedQuery(current, (start) => `select Id, DisplayName, PrimaryEmailAddr, CurrencyRef, Balance, Active, MetaData from Customer startposition ${start} maxresults 1000`),
    pagedQuery(current, (start) => `select Id, DocNumber, CustomerRef, TxnDate, DueDate, TotalAmt, Balance, CurrencyRef, ExchangeRate, PrivateNote, MetaData from Invoice startposition ${start} maxresults 1000`),
    pagedQuery(current, (start) => `select Id, CustomerRef, TxnDate, TotalAmt, CurrencyRef, PaymentRefNum, UnappliedAmt, MetaData from Payment startposition ${start} maxresults 1000`),
    pagedQuery(current, (start) => `select Id, VendorRef, TxnDate, DueDate, TotalAmt, Balance, CurrencyRef, PrivateNote, MetaData from Bill startposition ${start} maxresults 1000`),
    pagedQuery(current, (start) => `select Id, EntityRef, TxnDate, TotalAmt, CurrencyRef, PaymentType, MetaData from Purchase startposition ${start} maxresults 1000`),
  ]);

  return {
    connection: current,
    company,
    counts: {
      customers: customers.length,
      invoices: invoices.length,
      payments: payments.length,
      bills: bills.length,
      purchases: purchases.length,
    },
    customers,
    invoices,
    payments,
    bills,
    purchases,
  };
}

module.exports = {
  QBO_SCOPE,
  resolveBaseUrl,
  resolveRedirectUri,
  resolveQboEnvironment,
  buildQboDiagnostics,
  buildReturnUrl,
  buildSignedState,
  parseSignedState,
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshTokens,
  tokenExpiryIso,
  fetchCompanyInfo,
  ensureFreshConnection,
  connectFromCallback,
  syncQuickBooksData,
};
