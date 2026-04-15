// Placeholder env shim; replaced during Netlify build via admin-build-info plugin.
(function(){
  window.__HMJ_ADMIN_ENV = window.__HMJ_ADMIN_ENV || {
    ADMIN_IDENTITY_URL: ''
  };
  if (window.__HMJ_ADMIN_ENV.ADMIN_IDENTITY_URL) {
    window.ADMIN_IDENTITY_URL = window.__HMJ_ADMIN_ENV.ADMIN_IDENTITY_URL;
  }
})();
