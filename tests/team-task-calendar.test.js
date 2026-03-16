const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAuthUrl,
  buildCalendarDiagnostics,
  buildCallbackUrl,
  normalizeCalendarSettings,
  parseSignedState,
  redactCalendarSettings,
} = require('../netlify/functions/_team-task-calendar.js');

test('normalizeCalendarSettings keeps an existing client secret until explicitly cleared', () => {
  const existing = normalizeCalendarSettings({
    enabled: true,
    tenantId: 'common',
    clientId: 'client-1',
    clientSecret: 'secret-1',
  });

  const kept = normalizeCalendarSettings({
    enabled: true,
    tenantId: 'tenant-2',
    clientId: 'client-2',
    clientSecret: '',
  }, { existing });

  assert.equal(kept.clientSecret, 'secret-1');

  const cleared = normalizeCalendarSettings({
    clearClientSecret: true,
  }, { existing: kept });

  assert.equal(cleared.clientSecret, '');
});

test('buildCalendarDiagnostics derives callback and readiness from event headers', () => {
  const settings = normalizeCalendarSettings({
    enabled: true,
    tenantId: 'common',
    clientId: 'client-123',
    clientSecret: 'secret-456',
  });

  const event = {
    headers: {
      'x-forwarded-host': 'hmj-global.com',
      'x-forwarded-proto': 'https',
    },
  };

  const diagnostics = buildCalendarDiagnostics(settings, event);
  assert.equal(diagnostics.setupReady, true);
  assert.equal(
    diagnostics.callbackUrl,
    'https://hmj-global.com/.netlify/functions/admin-team-tasks-calendar-callback'
  );
  assert.match(diagnostics.scopes.join(' '), /Calendars\.Read/);
  assert.equal(
    buildCallbackUrl(event),
    'https://hmj-global.com/.netlify/functions/admin-team-tasks-calendar-callback'
  );
});

test('buildAuthUrl signs and round-trips callback state safely', () => {
  process.env.TEAM_TASKS_CALENDAR_STATE_SECRET = 'hmj-test-secret';

  const settings = normalizeCalendarSettings({
    enabled: true,
    tenantId: 'common',
    clientId: 'client-abc',
    clientSecret: 'secret-def',
  });
  const event = {
    headers: {
      'x-forwarded-host': 'hmj-global.com',
      'x-forwarded-proto': 'https',
    },
  };

  const auth = buildAuthUrl({
    settings,
    event,
    user: {
      id: 'admin-1',
      email: 'admin@hmj-global.com',
      displayName: 'Admin User',
    },
    returnTo: 'https://hmj-global.com/admin/team-tasks.html',
  });

  const url = new URL(auth.url);
  assert.equal(url.hostname, 'login.microsoftonline.com');
  assert.equal(url.searchParams.get('client_id'), 'client-abc');
  assert.match(url.searchParams.get('scope') || '', /Calendars\.Read/);

  const state = parseSignedState(url.searchParams.get('state'));
  assert.equal(state.userId, 'admin-1');
  assert.equal(state.email, 'admin@hmj-global.com');
  assert.equal(state.returnTo, 'https://hmj-global.com/admin/team-tasks.html');
});

test('redactCalendarSettings hides the stored secret while exposing its presence', () => {
  const redacted = redactCalendarSettings({
    enabled: true,
    clientSecret: 'secret-value',
  });

  assert.equal(redacted.clientSecret, '');
  assert.equal(redacted.clientSecretStored, true);
});
