'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildAuthUrl,
  buildCalendarDiagnostics,
  buildTeamTasksUrl,
  readCalendarSettings,
  trimString,
} = require('./_team-task-calendar.js');

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    const method = (event.httpMethod || '').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
      throw coded(405, 'Method Not Allowed');
    }

    const { user } = await getContext(event, context, { requireAdmin: true });
    const current = await readCalendarSettings(event);
    const settings = current.settings;
    const diagnostics = buildCalendarDiagnostics(settings, event);

    if (!settings.enabled) {
      throw coded(400, 'Microsoft calendar sync is disabled in Admin Settings.');
    }
    if (!diagnostics.setupReady) {
      const error = coded(400, 'Microsoft calendar setup is incomplete in Admin Settings.');
      error.details = { diagnostics };
      throw error;
    }

    let returnTo = trimString(
      event?.queryStringParameters?.returnTo
        || '',
      1000
    );
    if (!returnTo) {
      returnTo = buildTeamTasksUrl(event);
    }

    const auth = buildAuthUrl({
      settings,
      event,
      user: {
        id: user?.id || user?.sub,
        email: user?.email,
        displayName: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email,
      },
      returnTo,
    });

    if (method === 'POST') {
      return response(200, {
        ok: true,
        url: auth.url,
        redirectUri: auth.redirectUri,
      });
    }

    return {
      statusCode: 302,
      headers: {
        location: auth.url,
        'cache-control': 'no-store',
      },
      body: '',
    };
  } catch (error) {
    const fallback = buildTeamTasksUrl(event, {
      calendar_status: 'error',
      calendar_message: error?.message || 'Unable to start Microsoft calendar connection.',
    });
    return {
      statusCode: 302,
      headers: {
        location: fallback,
        'cache-control': 'no-store',
      },
      body: '',
    };
  }
});
