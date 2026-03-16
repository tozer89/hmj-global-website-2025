(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.HMJAuthFlow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AUTH_PARAM_KEYS = [
    'invite_token',
    'recovery_token',
    'confirmation_token',
    'email_change_token',
    'access_token',
    'refresh_token',
    'type',
    'error',
    'error_description'
  ];

  function safeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function normalisePathname(pathname) {
    const raw = safeString(pathname).trim();
    if (!raw) return '/';
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  function parseParamString(serialized, prefix) {
    const raw = safeString(serialized).trim();
    if (!raw) return new URLSearchParams();
    let value = raw;
    if (prefix && value.startsWith(prefix)) {
      value = value.slice(prefix.length);
    }
    if (value.startsWith('/')) {
      value = value.replace(/^\/+/, '');
    }
    return new URLSearchParams(value);
  }

  function readParams(params, key) {
    const value = safeString(params.get(key)).trim();
    return value || '';
  }

  function findIntent(hashParams, searchParams) {
    const inviteToken = readParams(hashParams, 'invite_token') || readParams(searchParams, 'invite_token');
    if (inviteToken) return 'invite';

    const recoveryToken = readParams(hashParams, 'recovery_token') || readParams(searchParams, 'recovery_token');
    if (recoveryToken) return 'recovery';

    const confirmationToken = readParams(hashParams, 'confirmation_token') || readParams(searchParams, 'confirmation_token');
    if (confirmationToken) return 'confirmation';

    const emailChangeToken = readParams(hashParams, 'email_change_token') || readParams(searchParams, 'email_change_token');
    if (emailChangeToken) return 'email-change';

    const type = (readParams(hashParams, 'type') || readParams(searchParams, 'type')).toLowerCase();
    if (type === 'invite') return 'invite';
    if (type === 'recovery') return 'recovery';
    if (type === 'email_change') return 'email-change';
    if (type === 'signup' || type === 'confirmation' || type === 'signup_confirmation') {
      return 'confirmation';
    }
    if (type && (readParams(hashParams, 'access_token') || readParams(searchParams, 'access_token'))) {
      return 'session';
    }

    return '';
  }

  function collectAuthParams(hashParams, searchParams) {
    const output = {};
    AUTH_PARAM_KEYS.forEach((key) => {
      const value = readParams(hashParams, key) || readParams(searchParams, key);
      if (value) output[key] = value;
    });
    return output;
  }

  function hasAuthParams(params) {
    return AUTH_PARAM_KEYS.some((key) => !!readParams(params, key));
  }

  function parseAuthState(input) {
    const state = input && typeof input === 'object'
      ? input
      : {};

    const pathname = normalisePathname(state.pathname);
    const search = safeString(state.search);
    const hash = safeString(state.hash);
    const searchParams = parseParamString(search, '?');
    const hashParams = parseParamString(hash, '#');
    const authParams = collectAuthParams(hashParams, searchParams);
    const intent = findIntent(hashParams, searchParams);
    const hasError = !!(authParams.error || authParams.error_description);
    const hasTokenPayload = hasAuthParams(hashParams) || hasAuthParams(searchParams);

    return {
      pathname,
      search,
      hash,
      intent,
      hasError,
      hasTokenPayload,
      isAuthCallback: hasTokenPayload || hasError,
      usesHashPayload: hasAuthParams(hashParams),
      usesSearchPayload: hasAuthParams(searchParams),
      authParams
    };
  }

  function buildAuthHandoffUrl(destination, input) {
    const target = safeString(destination).trim() || '/admin/';
    const parsed = parseAuthState(input);
    if (!parsed.isAuthCallback) return target;

    const parts = target.split('#');
    const baseWithSearch = parts[0] || '/admin/';
    const hash = parsed.hash || '';
    const search = parsed.search || '';

    const base = baseWithSearch.split('?')[0] || '/admin/';
    return `${base}${search}${hash}`;
  }

  function isAdminPath(pathname) {
    const path = normalisePathname(pathname);
    return path === '/admin/' || path === '/admin' || path.indexOf('/admin/') === 0;
  }

  function isCandidatePath(pathname) {
    const path = normalisePathname(pathname).toLowerCase();
    return path === '/candidates'
      || path === '/candidates/'
      || path === '/candidates.html';
  }

  function isCandidateAuthRoute(input) {
    const state = input && typeof input === 'object'
      ? input
      : { pathname: input };

    const pathname = normalisePathname(state.pathname);
    if (isCandidatePath(pathname)) return true;

    const searchParams = parseParamString(safeString(state.search), '?');
    return !!(readParams(searchParams, 'candidate_action') || readParams(searchParams, 'candidate_auth'));
  }

  return {
    AUTH_PARAM_KEYS,
    buildAuthHandoffUrl,
    isAdminPath,
    isCandidateAuthRoute,
    isCandidatePath,
    normalisePathname,
    parseAuthState
  };
});
