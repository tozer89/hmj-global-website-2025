(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const adminLink = document.getElementById('nav-admin');
    if (!adminLink) return;
    adminLink.href = '/admin/';
    adminLink.removeAttribute('aria-disabled');
    adminLink.title = 'Open the admin portal';
  });
})();
