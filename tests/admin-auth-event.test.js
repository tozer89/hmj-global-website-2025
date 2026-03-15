const test = require('node:test');
const assert = require('node:assert/strict');

const { safePayload } = require('../netlify/functions/admin-auth-event.js');

test('safePayload keeps only approved auth diagnostic fields', () => {
  assert.deepEqual(
    safePayload({
      event: 'login_success',
      status: 'ok',
      reason: 'role mismatch??',
      page: '/admin/',
      route: '/admin/',
      host: 'hmj-global.com',
      env: 'production',
      intent: 'invite',
      source: 'login_form',
      next: '/admin/jobs.html',
      maskedEmail: 'a***n@hmj-global.com',
      flowId: 'auth-1234',
      token: 'secret-should-not-pass-through'
    }),
    {
      event: 'login_success',
      status: 'ok',
      reason: 'role_mismatch',
      page: '/admin/',
      route: '/admin/',
      host: 'hmj-global.com',
      env: 'production',
      intent: 'invite',
      source: 'login_form',
      next: '/admin/jobs.html',
      maskedEmail: 'a***n@hmj-global.com',
      flowId: 'auth-1234'
    }
  );
});

test('safePayload downgrades unexpected event names', () => {
  assert.equal(safePayload({ event: 'totally_custom_event' }).event, 'unknown_event');
});
