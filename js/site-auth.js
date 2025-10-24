(function(){
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var menu = doc.getElementById('hmj-menu');
  if (!menu) return; // no nav on this page

  var loginLink = doc.getElementById('nav-login');
  var logoutLink = doc.getElementById('nav-logout');
  var timesheetsLink = doc.getElementById('nav-timesheets');
  var adminLink = doc.getElementById('nav-admin');
  var INVITE_FLAG = 'hmj_invite_flow';

  function nearestItem(el) {
    if (!el) return null;
    if (typeof el.closest === 'function') {
      var li = el.closest('li');
      return li || el;
    }
    return el;
  }

  function toggle(el, show) {
    var host = nearestItem(el);
    if (!host) return;
    if (show) host.removeAttribute('hidden');
    else host.setAttribute('hidden', '');
  }

  function setTimesheetsRequiresAuth(needsAuth) {
    if (!timesheetsLink) return;
    if (needsAuth) {
      timesheetsLink.setAttribute('data-needs-auth', '1');
    } else {
      timesheetsLink.removeAttribute('data-needs-auth');
    }
    // Always ensure the href points to the local timesheets page
    timesheetsLink.setAttribute('href', 'timesheets.html');
  }

  var currentState = { authed: null, admin: null };
  function applyState(next) {
    next = next || { authed: false, admin: false };
    if (currentState.authed === next.authed && currentState.admin === next.admin) return;
    currentState = next;
    toggle(loginLink, !next.authed);
    toggle(logoutLink, !!next.authed);
    toggle(adminLink, !!next.authed && !!next.admin);
    setTimesheetsRequiresAuth(!next.authed);
  }

  function hasNetlifyCookie() {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].trim().indexOf('nf_jwt=') === 0) return true;
    }
    return false;
  }

  function rolesFromUser(user) {
    var roles = [];
    if (!user) return roles;
    var metaRoles = user.app_metadata && Array.isArray(user.app_metadata.roles) ? user.app_metadata.roles : null;
    var directRoles = Array.isArray(user.roles) ? user.roles : null;
    if (metaRoles && metaRoles.length) roles = metaRoles.slice();
    else if (directRoles && directRoles.length) roles = directRoles.slice();
    return roles.map(function(r){ return String(r); });
  }

  function updateFromUser(user) {
    if (user) {
      var roles = rolesFromUser(user);
      var isAdmin = roles.indexOf('admin') !== -1;
      applyState({ authed: true, admin: isAdmin });
    } else if (hasNetlifyCookie()) {
      applyState({ authed: true, admin: false });
    } else {
      applyState({ authed: false, admin: false });
    }
  }

  function rememberInviteIfPresent() {
    var hash = window.location.hash || '';
    if (hash.indexOf('invite_token') !== -1 || hash.indexOf('confirmation_token') !== -1) {
      try { sessionStorage.setItem(INVITE_FLAG, '1'); } catch (_) {}
    }
  }

  function openLogin() {
    try { sessionStorage.setItem('afterLogin', '/timesheets.html'); } catch (_) {}
    if (window.netlifyIdentity && typeof window.netlifyIdentity.open === 'function') {
      window.netlifyIdentity.open('login');
    } else {
      console.warn('[site-auth] Netlify Identity widget not ready yet.');
    }
  }

  function handleLoginRedirect() {
    var inviteFlow = false;
    try { inviteFlow = sessionStorage.getItem(INVITE_FLAG) === '1'; } catch (_) {}
    if (inviteFlow) {
      try { sessionStorage.removeItem(INVITE_FLAG); } catch (_) {}
      window.location.href = '/admin/';
      return;
    }
    var dest = '/timesheets.html';
    try {
      var stored = sessionStorage.getItem('afterLogin');
      if (stored) dest = stored;
      sessionStorage.removeItem('afterLogin');
    } catch (_) {}
    window.location.href = dest;
  }

  if (loginLink) {
    loginLink.addEventListener('click', function(ev){
      ev.preventDefault();
      openLogin();
    });
  }

  if (logoutLink) {
    logoutLink.addEventListener('click', function(ev){
      ev.preventDefault();
      if (window.netlifyIdentity && typeof window.netlifyIdentity.logout === 'function') {
        window.netlifyIdentity.logout();
      } else {
        document.cookie = 'nf_jwt=; Max-Age=0; path=/';
        applyState({ authed: false, admin: false });
        window.location.href = '/';
      }
    });
  }

  if (timesheetsLink) {
    timesheetsLink.addEventListener('click', function(ev){
      if (timesheetsLink.getAttribute('data-needs-auth') === '1') {
        ev.preventDefault();
        openLogin();
      }
    });
  }

  rememberInviteIfPresent();
  updateFromUser(null);

  function initIdentity() {
    var ni = window.netlifyIdentity;
    if (!ni) return;
    var current = typeof ni.currentUser === 'function' ? ni.currentUser() : null;
    updateFromUser(current);

    if (typeof ni.on === 'function') {
      ni.on('init', function(user){
        updateFromUser(user);
        var inviteActive = false;
        try { inviteActive = sessionStorage.getItem(INVITE_FLAG) === '1'; } catch (_) {}
        if (inviteActive && user) {
          try { sessionStorage.removeItem(INVITE_FLAG); } catch (_) {}
          window.location.replace('/admin/');
        }
      });
      ni.on('login', function(user){
        updateFromUser(user);
        handleLoginRedirect();
      });
      ni.on('logout', function(){
        try {
          sessionStorage.removeItem('afterLogin');
          sessionStorage.removeItem(INVITE_FLAG);
        } catch (_) {}
        applyState({ authed: false, admin: false });
        window.location.href = '/';
      });
    }

    if (typeof ni.init === 'function') {
      try { ni.init(); } catch (err) { console.warn('[site-auth] identity init failed', err); }
    }
  }

  if (window.netlifyIdentity) {
    initIdentity();
  } else {
    var identityHandler = function(){
      document.removeEventListener('netlifyIdentityLoad', identityHandler);
      initIdentity();
    };
    document.addEventListener('netlifyIdentityLoad', identityHandler);
  }
})();
