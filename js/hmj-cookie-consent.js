/* HMJ Global – Cookie Consent Banner
   Stores preference in localStorage under 'hmj_cookie_consent'.
   Values: 'accepted' | 'declined'
   If declined, analytics is flagged as opted-out.
*/
(function () {
  'use strict';

  var STORAGE_KEY = 'hmj_cookie_consent';

  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
  }

  function applyDecline() {
    // Flag analytics as opted-out so it skips tracking
    window.HMJAnalytics = window.HMJAnalytics || {};
    window.HMJAnalytics.__optedOut = true;
    // Dispatch event in case analytics is already initialised
    try { document.dispatchEvent(new CustomEvent('hmj:cookie-declined')); } catch (e) {}
  }

  function removeBanner(banner) {
    if (!banner) return;
    banner.style.transition = 'opacity .2s ease, transform .2s ease';
    banner.style.opacity = '0';
    banner.style.transform = banner.style.transform.replace('translateY(0)', '') + ' translateY(8px)';
    setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 250);
  }

  function buildBanner() {
    var banner = document.createElement('div');
    banner.id = 'hmj-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-label', 'Cookie and privacy settings');
    banner.innerHTML =
      '<p>We use cookies to analyse site performance and improve your experience. ' +
      'See our <a href="/privacy.html">Privacy Policy</a> for details.</p>' +
      '<div class="hmj-cookie-actions">' +
        '<button id="hmj-cookie-accept" type="button">Accept all</button>' +
        '<button id="hmj-cookie-decline" type="button">Decline</button>' +
      '</div>';
    return banner;
  }

  function init() {
    var existing = getConsent();

    // Already decided – apply preference and exit
    if (existing === 'declined') {
      applyDecline();
      return;
    }
    if (existing === 'accepted') {
      return;
    }

    // No decision yet – show the banner
    var banner = buildBanner();

    document.body.appendChild(banner);

    banner.querySelector('#hmj-cookie-accept').addEventListener('click', function () {
      setConsent('accepted');
      removeBanner(banner);
    });

    banner.querySelector('#hmj-cookie-decline').addEventListener('click', function () {
      setConsent('declined');
      applyDecline();
      removeBanner(banner);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
