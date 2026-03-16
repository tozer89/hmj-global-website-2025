'use strict';

const { buildCors } = require('./_http.js');
const { getSupabaseUrl, getSupabaseAnonKey } = require('./_supabase-env.js');

const DEFAULT_CANDIDATE_SITE_URL = 'https://hmjg.netlify.app';

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normaliseUrl(value) {
  const raw = trimString(value, 1000);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    return '';
  }
}

function isLoopbackOrigin(value) {
  const url = normaliseUrl(value);
  if (!url) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '0.0.0.0'
      || hostname === '::1'
      || hostname === '[::1]';
  } catch (error) {
    return false;
  }
}

function requestOrigin(event = {}) {
  const headers = event.headers || {};
  const directOrigin = trimString(headers.origin || headers.Origin, 1000);
  if (directOrigin) return normaliseUrl(directOrigin);

  const host = trimString(
    headers['x-forwarded-host']
    || headers['X-Forwarded-Host']
    || headers.host
    || headers.Host,
    500
  );
  if (!host) return '';

  const proto = trimString(
    headers['x-forwarded-proto']
    || headers['X-Forwarded-Proto']
    || 'https',
    16
  ) || 'https';

  return normaliseUrl(`${proto}://${host}`);
}

function resolveCandidatePortalBaseUrl(event = {}) {
  const candidates = [
    requestOrigin(event),
    process.env.HMJ_CANDIDATE_PORTAL_SITE_URL,
    process.env.HMJ_CANONICAL_SITE_URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.URL,
    process.env.SITE_URL,
    DEFAULT_CANDIDATE_SITE_URL,
  ];

  for (const candidate of candidates) {
    const normalised = normaliseUrl(candidate);
    if (!normalised || isLoopbackOrigin(normalised)) continue;
    return normalised;
  }

  return DEFAULT_CANDIDATE_SITE_URL;
}

function buildRedirectUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

function respond(event, statusCode, body) {
  return {
    statusCode,
    headers: {
      ...buildCors(event),
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

async function handler(event = {}) {
  if ((event.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return respond(event, 200, { ok: true });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    return respond(event, 503, {
      ok: false,
      code: 'candidate_auth_unavailable',
      message: 'Candidate account tools are not configured for this environment.',
    });
  }

  const siteUrl = resolveCandidatePortalBaseUrl(event);
  const emailRedirectUrl = buildRedirectUrl(siteUrl, '/candidates.html?candidate_auth=verified');
  const recoveryRedirectUrl = buildRedirectUrl(siteUrl, '/candidates.html?candidate_action=recovery');

  return respond(event, 200, {
    ok: true,
    supabaseUrl,
    supabaseAnonKey,
    siteUrl,
    emailRedirectUrl,
    recoveryRedirectUrl,
    recoveryRedirectPath: '/candidates.html?candidate_action=recovery',
    emailRedirectPath: '/candidates.html?candidate_auth=verified',
  });
}

module.exports = {
  handler,
  _buildRedirectUrl: buildRedirectUrl,
  _resolveCandidatePortalBaseUrl: resolveCandidatePortalBaseUrl,
};
