(function adminIdentityBootstrap() {
  'use strict';

  if (typeof window === 'undefined') return;
  window.ADMIN_IDENTITY_URL = window.ADMIN_IDENTITY_URL || '/.netlify/identity';
})();
