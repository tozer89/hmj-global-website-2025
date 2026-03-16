'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildCalendarDiagnostics,
  ensureFreshConnection,
  fetchCalendarView,
  listCalendarConnections,
  normalizeConnectionForClient,
  normalizeGraphEvent,
  readCalendarSettings,
  trimString,
  updateConnectionHealth,
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
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseIsoRange(value, fallback) {
  const raw = trimString(value, 80);
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const { user } = await getContext(event, context, { requireAdmin: true });
    const body = parseBody(event);
    const defaultStart = new Date();
    defaultStart.setHours(0, 0, 0, 0);
    defaultStart.setDate(defaultStart.getDate() - defaultStart.getDay() + 1);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultEnd.getDate() + 7);

    const startAt = parseIsoRange(body.startAt, defaultStart.toISOString());
    const endAt = parseIsoRange(body.endAt, defaultEnd.toISOString());
    const includeEvents = body.includeEvents !== false;

    const current = await readCalendarSettings(event);
    const settings = current.settings;
    const diagnostics = buildCalendarDiagnostics(settings, event);
    const connections = await listCalendarConnections(event);

    const clientConnections = connections.map((connection) => normalizeConnectionForClient(connection, {
      userId: user?.id || user?.sub,
      email: user?.email,
    }));

    if (!includeEvents || !settings.enabled || !settings.showExternalEvents || !diagnostics.setupReady) {
      return response(200, {
        ok: true,
        settings: current.redacted,
        diagnostics,
        connections: clientConnections,
        events: [],
      });
    }

    const events = [];
    await Promise.all(connections
      .filter((connection) => connection.sync_enabled !== false && trimString(connection.refresh_token, 16000))
      .map(async (connection) => {
        try {
          const freshConnection = await ensureFreshConnection(event, settings, connection);
          const payload = await fetchCalendarView(freshConnection.access_token, startAt, endAt);
          const values = Array.isArray(payload?.value) ? payload.value : [];
          values.forEach((entry) => {
            events.push(normalizeGraphEvent(entry, {
              userId: freshConnection.user_id,
              userEmail: freshConnection.user_email,
              userDisplayName: freshConnection.user_display_name,
            }));
          });
          await updateConnectionHealth(event, freshConnection.id, {
            lastSyncedAt: new Date().toISOString(),
            lastError: '',
          });
        } catch (error) {
          try {
            await updateConnectionHealth(event, connection.id, {
              lastError: error?.message || 'Calendar sync failed.',
            });
          } catch {}
        }
      }));

    return response(200, {
      ok: true,
      settings: current.redacted,
      diagnostics,
      connections: clientConnections,
      events: events.sort((left, right) => new Date(left.startAt || 0).getTime() - new Date(right.startAt || 0).getTime()),
    });
  } catch (error) {
    return response(Number(error?.code) || 500, {
      ok: false,
      error: error?.message || 'Unable to load Team Tasks calendar status.',
    });
  }
});
