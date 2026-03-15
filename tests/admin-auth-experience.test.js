const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_ROUTES,
  PASSWORD_MIN_LENGTH,
  buildAdminEntryUrl,
  buildIntentDestination,
  classifyIdentityError,
  normaliseIdentityError,
  normaliseNextTarget,
  resolveAuthenticatedAdminRedirect,
  readNotice,
  validatePasswordPair,
} = require('../assets/js/admin.auth.experience.js');

test('buildIntentDestination routes invite and recovery callbacks to dedicated admin pages', () => {
  assert.equal(buildIntentDestination('invite'), ADMIN_ROUTES.complete);
  assert.equal(buildIntentDestination('recovery'), ADMIN_ROUTES.reset);
  assert.equal(buildIntentDestination('session'), ADMIN_ROUTES.login);
});

test('validatePasswordPair enforces minimum length and matching confirmation', () => {
  assert.deepEqual(validatePasswordPair('short', 'short'), {
    ok: false,
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters for your HMJ password.`
  });

  assert.deepEqual(validatePasswordPair('long-enough-password', 'mismatch'), {
    ok: false,
    message: 'The passwords do not match yet.'
  });

  assert.deepEqual(validatePasswordPair('long-enough-password', 'long-enough-password'), {
    ok: true,
    message: ''
  });
});

test('normaliseNextTarget only allows safe admin html destinations', () => {
  assert.equal(normaliseNextTarget('jobs.html'), '/admin/jobs.html');
  assert.equal(normaliseNextTarget('/admin/account.html'), '/admin/account.html');
  assert.equal(normaliseNextTarget('https://example.com/admin/jobs.html'), '');
  assert.equal(normaliseNextTarget('../admin/jobs.html'), '');
  assert.equal(normaliseNextTarget('/admin/'), '');
});

test('buildAdminEntryUrl preserves safe next routes and extra notices', () => {
  assert.equal(
    buildAdminEntryUrl('/admin/jobs.html', { auth_notice: 'reset-complete', email: 'admin@hmj-global.com' }),
    '/admin/?next=jobs.html&auth_notice=reset-complete&email=admin%40hmj-global.com'
  );

  assert.equal(buildAdminEntryUrl('https://example.com/admin/jobs.html'), '/admin/');
});

test('readNotice extracts auth notices from the search string', () => {
  assert.deepEqual(
    readNotice('?auth_notice=invite-complete&email=admin%40hmj-global.com&next=jobs.html'),
    {
      notice: 'invite-complete',
      email: 'admin@hmj-global.com',
      next: 'jobs.html'
    }
  );
});

test('normaliseIdentityError maps common token failures to friendly HMJ copy', () => {
  assert.equal(
    normaliseIdentityError('Link expired'),
    'This secure email link has expired or has already been used. Request a new password email or contact HMJ access support.'
  );

  assert.equal(
    normaliseIdentityError('invalid token'),
    'This secure email link is no longer valid. Open the newest email you received, or request a fresh password reset.'
  );
});

test('classifyIdentityError maps invalid login failures to a supportable reason code', () => {
  assert.deepEqual(
    classifyIdentityError('Invalid login'),
    {
      reason: 'invalid_credentials',
      message: 'HMJ could not sign you in with that email and password. Check the details or request a fresh password reset.'
    }
  );
});

test('normaliseIdentityError maps missing-user login responses to the HMJ invalid credentials message', () => {
  assert.equal(
    normaliseIdentityError('No user found with that email, or password invalid.'),
    'HMJ could not sign you in with that email and password. Check the details or request a fresh password reset.'
  );
});

test('classifyIdentityError maps method-not-allowed auth host failures to a host guidance message', () => {
  assert.deepEqual(
    classifyIdentityError({ status: 405, message: 'Method Not Allowed' }),
    {
      reason: 'auth_method_not_allowed',
      message: 'HMJ sign-in is not available on this host right now. Open the secure HMJ admin URL and try again.'
    }
  );
});

test('resolveAuthenticatedAdminRedirect keeps signed-in admins on the dashboard root when no next target is present', () => {
  assert.equal(resolveAuthenticatedAdminRedirect('login', '', false), '');
  assert.equal(resolveAuthenticatedAdminRedirect('login', '/admin/jobs.html', false), '/admin/jobs.html');
  assert.equal(resolveAuthenticatedAdminRedirect('forgot-password', '', false), '/admin/');
  assert.equal(resolveAuthenticatedAdminRedirect('complete-account', '', false), '/admin/');
  assert.equal(resolveAuthenticatedAdminRedirect('reset-password', '', false), '/admin/');
  assert.equal(resolveAuthenticatedAdminRedirect('reset-password', '', true), '');
});
