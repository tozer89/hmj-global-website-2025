const { withAdminCors } = require('./_http.js');

const ALLOWED_EVENTS = new Set([
  'account_page_opened',
  'admin_access_blocked',
  'auth_handoff_redirect',
  'complete_account_page_opened',
  'forgot_password_page_opened',
  'forgot_password_request_submitted',
  'forgot_password_request_failed',
  'forgot_password_request_accepted',
  'invalid_token_encountered',
  'login_page_opened',
  'login_failure',
  'login_success',
  'login_sync_pending',
  'logout_success',
  'redirect_to_login',
  'reset_password_page_opened',
  'password_create_success',
  'password_create_failed',
  'password_reset_success',
  'password_reset_failed',
  'signed_in_redirect'
]);

function safeString(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function safeCode(value, max = 80) {
  return safeString(value, max).toLowerCase().replace(/[^a-z0-9._/-]+/g, '_').replace(/^_+|_+$/g, '');
}

function safePayload(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const payload = {
    ts: safeString(raw.ts, 64),
    event: safeCode(raw.event, 80),
    status: safeCode(raw.status, 24),
    reason: safeCode(raw.reason, 80),
    page: safeString(raw.page, 120),
    route: safeString(raw.route, 120),
    host: safeString(raw.host, 120),
    env: safeCode(raw.env, 24),
    intent: safeCode(raw.intent, 24),
    source: safeCode(raw.source, 40),
    next: safeString(raw.next, 160),
    maskedEmail: safeString(raw.maskedEmail, 120),
    flowId: safeString(raw.flowId, 80)
  };

  if (!ALLOWED_EVENTS.has(payload.event)) {
    payload.event = 'unknown_event';
  }

  Object.keys(payload).forEach((key) => {
    if (!payload[key]) delete payload[key];
  });

  return payload;
}

async function baseHandler(event) {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: 'method_not_allowed' })
    };
  }

  if (safeString(event.body, 4096).length > 4000) {
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: 'payload_too_large' })
    };
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const payload = safePayload(body);
  const meta = {
    method: event.httpMethod || 'POST',
    path: event.path || event.rawUrl || '',
    origin: safeString(event.headers?.origin || event.headers?.Origin, 160),
    referer: safeString(event.headers?.referer || event.headers?.Referer, 200),
    userAgent: safeString(event.headers?.['user-agent'] || event.headers?.['User-Agent'], 160),
    forwardedHost: safeString(event.headers?.['x-forwarded-host'] || event.headers?.host, 120)
  };

  console.info('[hmj-admin-auth-event]', JSON.stringify({ payload, meta }));

  return {
    statusCode: 204,
    headers: {
      'Cache-Control': 'no-store'
    }
  };
}

exports.handler = withAdminCors(baseHandler, { requireToken: false });
exports.safePayload = safePayload;
