'use strict';

const { withAdminCors } = require('./_http.js');
const {
  buildTeamTasksUrl,
  exchangeCodeForTokens,
  fetchMicrosoftProfile,
  parseSignedState,
  readCalendarSettings,
  tokenExpiryIso,
  trimString,
  upsertCalendarConnection,
} = require('./_team-task-calendar.js');

function safeReturnTo(event, candidate) {
  const fallback = buildTeamTasksUrl(event);
  const raw = trimString(candidate, 1000);
  if (!raw) return fallback;
  try {
    const url = new URL(raw, fallback);
    const fallbackUrl = new URL(fallback);
    if (url.origin !== fallbackUrl.origin) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

exports.handler = withAdminCors(async (event) => {
  const query = event?.queryStringParameters || {};
  let returnTo = buildTeamTasksUrl(event);

  try {
    const state = parseSignedState(query.state);
    returnTo = safeReturnTo(event, state.returnTo);

    if (trimString(query.error, 120)) {
      const errorDescription = trimString(query.error_description, 400) || 'Microsoft sign-in was cancelled or denied.';
      return {
        statusCode: 302,
        headers: {
          location: safeReturnTo(event, `${returnTo}${returnTo.includes('?') ? '&' : '?'}calendar_status=error&calendar_message=${encodeURIComponent(errorDescription)}`),
          'cache-control': 'no-store',
        },
        body: '',
      };
    }

    const code = trimString(query.code, 4000);
    if (!code) {
      throw new Error('Microsoft did not return an authorization code.');
    }

    const current = await readCalendarSettings(event);
    const settings = current.settings;
    const tokenPayload = await exchangeCodeForTokens(settings, event, code);
    const profile = await fetchMicrosoftProfile(tokenPayload.access_token);

    await upsertCalendarConnection(event, {
      userId: state.userId,
      userEmail: state.email,
      userDisplayName: state.displayName || state.email,
      externalAccountId: trimString(profile.id, 240),
      externalAccountEmail: trimString(profile.mail || profile.userPrincipalName, 320),
      externalDisplayName: trimString(profile.displayName, 240),
      accessToken: trimString(tokenPayload.access_token, 16000),
      refreshToken: trimString(tokenPayload.refresh_token, 16000),
      accessTokenExpiresAt: tokenExpiryIso(tokenPayload),
      scope: trimString(tokenPayload.scope, 2000).split(/\s+/).filter(Boolean),
      syncEnabled: true,
      lastSyncedAt: new Date().toISOString(),
      lastError: '',
    });

    return {
      statusCode: 302,
      headers: {
        location: safeReturnTo(event, `${returnTo}${returnTo.includes('?') ? '&' : '?'}calendar_status=connected`),
        'cache-control': 'no-store',
      },
      body: '',
    };
  } catch (error) {
    return {
      statusCode: 302,
      headers: {
        location: safeReturnTo(event, `${returnTo}${returnTo.includes('?') ? '&' : '?'}calendar_status=error&calendar_message=${encodeURIComponent(error?.message || 'Microsoft calendar connection failed.')}`),
        'cache-control': 'no-store',
      },
      body: '',
    };
  }
}, { requireToken: false });
