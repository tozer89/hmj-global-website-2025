'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  persistCalendarSettings,
  readCalendarSettings,
} = require('./_team-task-calendar.js');

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const { user } = await getContext(event, context, { requireAdmin: true });
    const body = parseBody(event);
    const action = String(body.action || 'get').trim().toLowerCase();

    if (action === 'get') {
      const current = await readCalendarSettings(event);
      return response(200, {
        ok: true,
        settings: current.redacted,
        diagnostics: current.diagnostics,
        source: current.source,
      });
    }

    if (action === 'save') {
      const saved = await persistCalendarSettings(event, body.settings || body, {
        savedAt: new Date().toISOString(),
        savedBy: user?.email || 'admin',
      });
      return response(200, {
        ok: true,
        settings: saved.redacted,
        diagnostics: saved.diagnostics,
        source: saved.source,
        message: 'Team Tasks calendar settings saved.',
      });
    }

    throw coded(400, 'Unknown Team Tasks calendar settings action.');
  } catch (error) {
    return response(Number(error?.code) || 500, {
      ok: false,
      error: error?.message || 'Team Tasks calendar settings request failed.',
      details: error?.details || null,
    });
  }
});
