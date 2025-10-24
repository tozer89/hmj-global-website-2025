(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    try {
      window.hmjConfigureIdentity?.();
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[HMJ] nav identity init failed', err);
      }
    }
  });
})();
