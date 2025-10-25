// Placeholder env shim; replaced during Netlify build via admin-build-info plugin.
(function(){
  window.__HMJ_ADMIN_ENV = window.__HMJ_ADMIN_ENV || {
    ALWAYS_ADMIN_EMAILS: '',
    FORCE_ADMIN_KEY: '',
    ADMIN_IDENTITY_URL: ''
  };
  if (typeof window.ALWAYS_ADMIN_EMAILS !== 'string') {
    window.ALWAYS_ADMIN_EMAILS = window.__HMJ_ADMIN_ENV.ALWAYS_ADMIN_EMAILS || '';
  }
  if (typeof window.FORCE_ADMIN_KEY !== 'string') {
    window.FORCE_ADMIN_KEY = window.__HMJ_ADMIN_ENV.FORCE_ADMIN_KEY || '';
  }
})();
