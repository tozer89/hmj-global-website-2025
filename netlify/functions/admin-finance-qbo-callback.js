'use strict';

const { withAdminCors } = require('./_http.js');
const {
  getFinanceSchemaStatus,
  saveQboRuntimeStatus,
} = require('./_finance-store.js');
const {
  parseSignedState,
  exchangeCodeForTokens,
  tokenExpiryIso,
  connectFromCallback,
  resolveQboEnvironment,
  appendQueryParams,
  buildReturnUrl,
  logQbo,
  normalizeReturnTo,
} = require('./_finance-qbo.js');

function safeMessage(value, fallback) {
  const text = String(value || fallback || '').trim();
  return text.slice(0, 500) || fallback || 'QuickBooks connection failed.';
}

function buildUserFacingError(error) {
  const message = safeMessage(error?.message, 'QuickBooks connection failed.');
  const lower = message.toLowerCase();
  if (lower.includes('redirect') && lower.includes('uri')) {
    return 'QuickBooks rejected the HMJ callback URL. The Intuit app redirect URI must exactly match the HMJ finance callback URL shown on the QuickBooks page.';
  }
  if (lower.includes('invalid_grant') || lower.includes('authorization code')) {
    return 'QuickBooks rejected the one-time authorisation code. Start the connection again from HMJ Finance and complete the sign-in in one pass.';
  }
  if (lower.includes('invalid client') || lower.includes('credentials')) {
    return 'QuickBooks rejected the HMJ client credentials. Check the QBO client id and secret configured in Netlify.';
  }
  if (lower.includes('state') && lower.includes('expired')) {
    return 'The QuickBooks connection state expired before the callback completed. Start the connection again from the HMJ finance page.';
  }
  if (lower.includes('state')) {
    return 'The QuickBooks callback could not be verified safely. Start the connection again from the HMJ finance page.';
  }
  if (lower.includes('realm')) {
    return 'QuickBooks did not return a company identifier. Confirm the correct QuickBooks company was selected and try again.';
  }
  return message;
}

function callbackRedirect(event, returnTo, params = {}) {
  return {
    statusCode: 302,
    headers: {
      location: appendQueryParams(normalizeReturnTo(event, returnTo), params),
    },
  };
}

module.exports.handler = withAdminCors(async (event) => {
  const params = event.queryStringParameters || {};
  const fallbackReturnTo = buildReturnUrl(event, '/admin/finance/quickbooks.html');
  const schema = await getFinanceSchemaStatus(event);
  if (!schema.ready) {
    await saveQboRuntimeStatus(event, {
      lastEvent: 'callback_schema_missing',
      lastEventAt: new Date().toISOString(),
      lastError: 'Finance schema is missing, so QuickBooks could not be connected.',
      lastErrorAt: new Date().toISOString(),
    }).catch(() => null);
    return callbackRedirect(event, fallbackReturnTo, { qbo: 'finance-schema-missing' });
  }

  let state = null;
  if (params.state) {
    try {
      state = parseSignedState(params.state);
    } catch (error) {
      logQbo('callback_state_invalid', {
        error: error?.message,
      });
      await saveQboRuntimeStatus(event, {
        lastEvent: 'callback_state_invalid',
        lastEventAt: new Date().toISOString(),
        lastError: safeMessage(error?.message, 'QuickBooks callback state could not be verified.'),
        lastErrorAt: new Date().toISOString(),
      }).catch(() => null);
      return callbackRedirect(event, fallbackReturnTo, {
        qbo_error: buildUserFacingError(error),
        qbo_error_code: 'state_invalid',
      });
    }
  }

  const returnTo = state?.returnTo || fallbackReturnTo;

  if (params.error || params.error_description) {
    const providerError = safeMessage(params.error_description || params.error, 'QuickBooks returned an error.');
    logQbo('callback_provider_error', {
      providerError,
      realmId: params.realmId || params.realmid || '',
      email: state?.email || '',
    });
    await saveQboRuntimeStatus(event, {
      lastEvent: 'callback_provider_error',
      lastEventAt: new Date().toISOString(),
      lastError: providerError,
      lastErrorAt: new Date().toISOString(),
      lastProviderError: providerError,
      realmId: params.realmId || params.realmid || '',
      connectedEmail: state?.email || '',
      returnTo,
    }, state?.email || '').catch(() => null);
    return callbackRedirect(event, returnTo, {
      qbo_error: buildUserFacingError({ message: providerError }),
      qbo_error_code: 'provider_error',
    });
  }

  if (!state?.email) {
    const error = new Error('QuickBooks callback state is missing the HMJ admin email.');
    logQbo('callback_state_missing_email', { returnTo });
    await saveQboRuntimeStatus(event, {
      lastEvent: 'callback_state_missing_email',
      lastEventAt: new Date().toISOString(),
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
      returnTo,
    }).catch(() => null);
    return callbackRedirect(event, returnTo, {
      qbo_error: buildUserFacingError(error),
      qbo_error_code: 'state_missing_email',
    });
  }

  if (!params.code) {
    const error = new Error('QuickBooks did not return an authorisation code.');
    logQbo('callback_missing_code', {
      email: state.email,
      realmId: params.realmId || params.realmid || '',
    });
    await saveQboRuntimeStatus(event, {
      lastEvent: 'callback_missing_code',
      lastEventAt: new Date().toISOString(),
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
      connectedEmail: state.email,
      realmId: params.realmId || params.realmid || '',
      returnTo,
    }, state.email).catch(() => null);
    return callbackRedirect(event, returnTo, {
      qbo_error: buildUserFacingError(error),
      qbo_error_code: 'missing_code',
    });
  }

  if (!(params.realmId || params.realmid)) {
    const error = new Error('QuickBooks did not return a realm/company id.');
    logQbo('callback_missing_realm', {
      email: state.email,
    });
    await saveQboRuntimeStatus(event, {
      lastEvent: 'callback_missing_realm',
      lastEventAt: new Date().toISOString(),
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
      connectedEmail: state.email,
      returnTo,
    }, state.email).catch(() => null);
    return callbackRedirect(event, returnTo, {
      qbo_error: buildUserFacingError(error),
      qbo_error_code: 'missing_realm',
    });
  }

  await saveQboRuntimeStatus(event, {
    lastEvent: 'callback_received',
    lastEventAt: new Date().toISOString(),
    lastError: '',
    connectedEmail: state.email,
    realmId: params.realmId || params.realmid || '',
    returnTo,
  }, state.email).catch(() => null);

  try {
    logQbo('callback_token_exchange_attempt', {
      email: state.email,
      realmId: params.realmId || params.realmid || '',
    });

    const tokens = await exchangeCodeForTokens(event, params.code || '');
    await connectFromCallback(event, {
      id: state.userId || '',
      email: state.email,
    }, {
      environment: resolveQboEnvironment(),
      realmId: params.realmId || params.realmid || '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: tokenExpiryIso(tokens),
    });

    await saveQboRuntimeStatus(event, {
      lastEvent: 'connected',
      lastEventAt: new Date().toISOString(),
      lastError: '',
      lastErrorAt: '',
      lastSuccessAt: new Date().toISOString(),
      connectedEmail: state.email,
      realmId: params.realmId || params.realmid || '',
      returnTo,
    }, state.email).catch(() => null);

    return callbackRedirect(event, returnTo, { qbo: 'connected' });
  } catch (error) {
    logQbo('callback_failed', {
      email: state.email,
      realmId: params.realmId || params.realmid || '',
      error: error?.message,
      code: error?.code || error?.status || '',
      providerError: error?.details?.error_description || error?.details?.error || '',
    });
    await saveQboRuntimeStatus(event, {
      lastEvent: 'callback_failed',
      lastEventAt: new Date().toISOString(),
      lastError: safeMessage(error?.message, 'QuickBooks connection failed.'),
      lastErrorAt: new Date().toISOString(),
      lastProviderError: safeMessage(error?.details?.error_description || error?.details?.error, ''),
      connectedEmail: state.email,
      realmId: params.realmId || params.realmid || '',
      returnTo,
    }, state.email).catch(() => null);

    return callbackRedirect(event, returnTo, {
      qbo_error: buildUserFacingError(error),
      qbo_error_code: safeMessage(error?.code || error?.status || 'callback_failed', 'callback_failed'),
    });
  }
}, { requireToken: false });
