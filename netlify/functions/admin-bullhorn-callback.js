'use strict';

const { withAdminCors } = require('./_http.js');
const {
  appendQueryParams,
  buildBullhornReturnUrl,
  buildNoStoreHeaders,
  buildOperatorErrorPage,
  exchangeCodeForToken,
  getLoginInfo,
  logBullhorn,
  loginToRest,
  normalizeReturnTo,
  parseSignedState,
  resolveBullhornConfig,
} = require('./_bullhorn.js');
const { createBullhornSettingsStore } = require('./_bullhorn-store.js');
const { saveAuthorizedBullhornConnection } = require('./_bullhorn-service.js');

function safeMessage(value, fallback) {
  const text = String(value || fallback || '').trim();
  return text.slice(0, 500) || fallback || 'Bullhorn connection failed.';
}

function buildUserFacingError(error) {
  const message = safeMessage(error?.message, 'Bullhorn connection failed.');
  const lower = message.toLowerCase();
  if (lower.includes('state')) {
    return 'The Bullhorn callback could not be verified safely. Start the connection again from HMJ Admin.';
  }
  if (lower.includes('authorization code') || lower.includes('token')) {
    return 'Bullhorn rejected the one-time authorisation code. Start the connection again and complete the sign-in in one pass.';
  }
  if (lower.includes('rest login') || lower.includes('session')) {
    return 'Bullhorn authenticated the OAuth step but could not establish a REST session. Check the account data-center configuration and try again.';
  }
  if (lower.includes('client') || lower.includes('secret')) {
    return 'Bullhorn rejected the HMJ client credentials. Check the Bullhorn OAuth credentials configured in Netlify.';
  }
  return message;
}

function callbackRedirect(event, returnTo, params = {}) {
  return {
    statusCode: 302,
    headers: buildNoStoreHeaders({
      location: appendQueryParams(normalizeReturnTo(event, returnTo, '/admin/candidates.html'), params),
    }),
    body: '',
  };
}

exports.handler = withAdminCors(async (event) => {
  const store = createBullhornSettingsStore();
  const params = event.queryStringParameters || {};
  const fallbackReturnTo = buildBullhornReturnUrl(event, '/admin/candidates.html');

  let config;
  try {
    config = resolveBullhornConfig(event);
  } catch (error) {
    return {
      statusCode: 500,
      headers: buildNoStoreHeaders({
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; img-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      }),
      body: buildOperatorErrorPage(error.message),
    };
  }

  let state;
  try {
    state = parseSignedState(params.state);
  } catch (error) {
    logBullhorn('callback_state_invalid', {
      error: error?.message,
    });
    await store.saveRuntimeStatus(event, {
      lastEvent: 'callback_state_invalid',
      lastEventAt: new Date().toISOString(),
      lastError: safeMessage(error?.message, 'Bullhorn callback state could not be verified.'),
      lastErrorAt: new Date().toISOString(),
      pendingAuth: null,
    }).catch(() => null);
    return callbackRedirect(event, fallbackReturnTo, {
      bullhorn_status: 'error',
      bullhorn_error_code: 'bad_state',
      bullhorn_error: buildUserFacingError(error),
    });
  }

  const runtimeStatus = await store.readRuntimeStatus(event).catch(() => ({}));
  const pendingAuth = runtimeStatus?.pendingAuth && typeof runtimeStatus.pendingAuth === 'object'
    ? runtimeStatus.pendingAuth
    : null;

  if (!pendingAuth?.nonce || pendingAuth.nonce !== state.nonce) {
    const error = new Error('Bullhorn callback state could not be matched to the HMJ connect request.');
    logBullhorn('callback_state_nonce_mismatch', {
      apiUsername: config.apiUsername,
      hasPendingAuth: !!pendingAuth,
    });
    await store.saveRuntimeStatus(event, {
      lastEvent: 'callback_state_nonce_mismatch',
      lastEventAt: new Date().toISOString(),
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
      pendingAuth: null,
    }).catch(() => null);
    return callbackRedirect(event, state.returnTo || fallbackReturnTo, {
      bullhorn_status: 'error',
      bullhorn_error_code: 'bad_state',
      bullhorn_error: buildUserFacingError(error),
    });
  }

  const returnTo = normalizeReturnTo(event, state.returnTo || pendingAuth.returnTo, '/admin/candidates.html');

  if (params.error || params.error_description) {
    const providerError = safeMessage(params.error_description || params.error, 'Bullhorn returned an error.');
    logBullhorn('callback_provider_error', {
      apiUsername: config.apiUsername,
      providerError,
    });
    await store.saveRuntimeStatus(event, {
      lastEvent: 'callback_provider_error',
      lastEventAt: new Date().toISOString(),
      lastError: providerError,
      lastErrorAt: new Date().toISOString(),
      pendingAuth: null,
      connectedEmail: state.email || '',
      apiUsername: config.apiUsername,
      returnTo,
    }).catch(() => null);
    return callbackRedirect(event, returnTo, {
      bullhorn_status: 'error',
      bullhorn_error_code: 'provider_error',
      bullhorn_error: buildUserFacingError({ message: providerError }),
    });
  }

  if (!params.code) {
    const error = new Error('Bullhorn did not return an authorization code.');
    await store.saveRuntimeStatus(event, {
      lastEvent: 'callback_missing_code',
      lastEventAt: new Date().toISOString(),
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
      pendingAuth: null,
      connectedEmail: state.email || '',
      apiUsername: config.apiUsername,
      returnTo,
    }).catch(() => null);
    return callbackRedirect(event, returnTo, {
      bullhorn_status: 'error',
      bullhorn_error_code: 'missing_code',
      bullhorn_error: buildUserFacingError(error),
    });
  }

  await store.saveRuntimeStatus(event, {
    lastEvent: 'callback_received',
    lastEventAt: new Date().toISOString(),
    lastError: '',
    pendingAuth: null,
    connectedEmail: state.email || '',
    apiUsername: config.apiUsername,
    returnTo,
  }).catch(() => null);

  try {
    const loginInfo = await getLoginInfo(config.apiUsername);
    const tokenPayload = await exchangeCodeForToken({
      event,
      config,
      loginInfo,
      code: params.code,
    });
    const restPayload = await loginToRest(tokenPayload.accessToken, loginInfo);

    await saveAuthorizedBullhornConnection(event, {
      store,
      config,
      loginInfo,
      tokenPayload,
      restPayload,
      connectedBy: state.userId || '',
      connectedEmail: state.email || '',
    });

    await store.saveRuntimeStatus(event, {
      lastEvent: 'connected',
      lastEventAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: '',
      lastErrorAt: '',
      pendingAuth: null,
      connectedEmail: state.email || '',
      apiUsername: config.apiUsername,
      restUrl: restPayload.restUrl,
      returnTo,
    }).catch(() => null);

    return callbackRedirect(event, returnTo, {
      bullhorn_status: 'connected',
    });
  } catch (error) {
    logBullhorn('callback_failed', {
      apiUsername: config.apiUsername,
      connectedEmail: state.email || '',
      classification: error?.classification || '',
      error: error?.message,
    });
    await store.saveRuntimeStatus(event, {
      lastEvent: 'callback_failed',
      lastEventAt: new Date().toISOString(),
      lastError: safeMessage(error?.message, 'Bullhorn connection failed.'),
      lastErrorAt: new Date().toISOString(),
      pendingAuth: null,
      connectedEmail: state.email || '',
      apiUsername: config.apiUsername,
      returnTo,
    }).catch(() => null);
    return callbackRedirect(event, returnTo, {
      bullhorn_status: 'error',
      bullhorn_error_code: safeMessage(error?.classification || error?.code || 'callback_failed', 'callback_failed'),
      bullhorn_error: buildUserFacingError(error),
    });
  }
}, { requireToken: false });
