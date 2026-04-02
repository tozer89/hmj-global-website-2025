const test = require('node:test');
const assert = require('node:assert/strict');

function withEnv(overrides, run) {
  const previous = {};
  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  try {
    return run();
  } finally {
    Object.keys(overrides).forEach((key) => {
      if (previous[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

function loadHelpers() {
  const modulePath = require.resolve('../netlify/functions/candidate-auth-config.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('candidate auth config prefers configured site urls over localhost request origins', () => {
  withEnv({
    HMJ_CANDIDATE_PORTAL_SITE_URL: '',
    HMJ_CANONICAL_SITE_URL: 'https://www.hmj-global.com',
    URL: '',
    DEPLOY_PRIME_URL: '',
    SITE_URL: '',
  }, () => {
    const { _resolveCandidatePortalBaseUrl } = loadHelpers();
    const resolved = _resolveCandidatePortalBaseUrl({
      headers: {
        origin: 'http://localhost:3000',
      },
    });

    assert.equal(resolved, 'https://www.hmj-global.com');
  });
});

test('candidate auth config uses the public request host when available', () => {
  withEnv({
    HMJ_CANDIDATE_PORTAL_SITE_URL: '',
    HMJ_CANONICAL_SITE_URL: '',
    URL: 'https://hmjg.netlify.app',
    DEPLOY_PRIME_URL: 'https://deploy-preview-106--hmjg.netlify.app',
    SITE_URL: '',
  }, () => {
    const { _resolveCandidatePortalBaseUrl } = loadHelpers();
    const resolved = _resolveCandidatePortalBaseUrl({
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'preview-hmj.netlify.app',
      },
    });

    assert.equal(resolved, 'https://preview-hmj.netlify.app');
  });
});

test('candidate auth config falls back to the production site when only localhost is available', () => {
  withEnv({
    HMJ_CANDIDATE_PORTAL_SITE_URL: '',
    HMJ_CANONICAL_SITE_URL: '',
    URL: '',
    DEPLOY_PRIME_URL: '',
    SITE_URL: '',
  }, () => {
    const { _resolveCandidatePortalBaseUrl, _buildRedirectUrl } = loadHelpers();
    const baseUrl = _resolveCandidatePortalBaseUrl({
      headers: {
        origin: 'http://localhost:3000',
      },
    });

    assert.equal(baseUrl, 'https://www.hmj-global.com');
    assert.equal(
      _buildRedirectUrl(baseUrl, '/candidates?candidate_auth=verified'),
      'https://www.hmj-global.com/candidates?candidate_auth=verified'
    );
  });
});
