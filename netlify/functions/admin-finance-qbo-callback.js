'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getFinanceSchemaStatus } = require('./_finance-store.js');
const {
  parseSignedState,
  exchangeCodeForTokens,
  tokenExpiryIso,
  connectFromCallback,
  resolveQboEnvironment,
} = require('./_finance-qbo.js');

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const schema = await getFinanceSchemaStatus(event);
  if (!schema.ready) {
    return {
      statusCode: 302,
      headers: {
        location: '/admin/finance/quickbooks.html?qbo=finance-schema-missing',
      },
    };
  }

  try {
    const params = event.queryStringParameters || {};
    if (params.error || params.error_description) {
      const message = encodeURIComponent(String(params.error_description || params.error || 'QuickBooks connection failed.'));
      return {
        statusCode: 302,
        headers: {
          location: `/admin/finance/quickbooks.html?qbo_error=${message}`,
        },
      };
    }

    const state = parseSignedState(params.state || '');
    const tokens = await exchangeCodeForTokens(event, params.code || '');
    await connectFromCallback(event, user, {
      environment: resolveQboEnvironment(),
      realmId: params.realmId || params.realmid || '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: tokenExpiryIso(tokens),
    });

    return {
      statusCode: 302,
      headers: {
        location: state.returnTo || '/admin/finance/quickbooks.html?qbo=connected',
      },
    };
  } catch (error) {
    const message = encodeURIComponent(error?.message || 'QuickBooks connection failed.');
    return {
      statusCode: 302,
      headers: {
        location: `/admin/finance/quickbooks.html?qbo_error=${message}`,
      },
    };
  }
});
