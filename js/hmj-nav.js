(function () {
  'use strict';

  const DEFAULT_AFTER_LOGIN = '/timesheets.html';

  const rolesOf = (user) => {
    if (Array.isArray(user?.app_metadata?.roles)) return user.app_metadata.roles;
    if (Array.isArray(user?.roles)) return user.roles;
    return [];
  };

  const getIdentity = () => (window.hmjConfigureIdentity?.() || window.netlifyIdentity || null);

  document.addEventListener('DOMContentLoaded', () => {
    const admin = document.getElementById('nav-admin');
    const timesheets = document.getElementById('nav-timesheets');

    if (!admin && !timesheets) {
      return;
    }

    const updateTimesheets = (user) => {
      if (!timesheets) return;
      if (user) {
        timesheets.href = '/timesheets.html';
        timesheets.removeAttribute('aria-disabled');
        timesheets.title = 'Open timesheets';
      } else {
        timesheets.href = '#';
        timesheets.setAttribute('aria-disabled', 'true');
        timesheets.title = 'Sign in to access timesheets';
      }
    };

    const updateAdmin = (user) => {
      if (!admin) return;
      const isAdmin = rolesOf(user).includes('admin');
      if (isAdmin) {
        admin.style.display = 'inline-block';
        admin.href = '/admin/';
        admin.removeAttribute('aria-disabled');
        admin.classList.remove('requires-admin');
        admin.textContent = 'Admin Dashboard';
        admin.title = 'Open the admin dashboard';
      } else {
        admin.style.display = 'none';
        admin.href = '/admin/';
        admin.setAttribute('aria-disabled', 'true');
        admin.classList.add('requires-admin');
        admin.textContent = 'Admin Dashboard';
        admin.title = 'Admin access only';
      }
    };

    const renderFor = (user) => {
      updateTimesheets(user);
      updateAdmin(user);
    };

    const attachIdentity = (maybeIdentity) => {
      const identity = maybeIdentity || getIdentity();
      if (!identity || typeof identity.on !== 'function') {
        renderFor(null);
        return null;
      }

      if (!identity.__hmjNavBound) {
        identity.__hmjNavBound = true;
        identity.on('init', (user) => renderFor(user || null));
        identity.on('login', (user) => {
          renderFor(user || null);
          const dest = sessionStorage.getItem('afterLogin') || DEFAULT_AFTER_LOGIN;
          sessionStorage.removeItem('afterLogin');
          if (dest) {
            window.location.href = dest;
          }
        });
        identity.on('logout', () => {
          renderFor(null);
          sessionStorage.removeItem('afterLogin');
          window.location.href = '/';
        });
      }

      try {
        renderFor(identity.currentUser?.() || null);
      } catch (err) {
        console.warn('[HMJ] identity state unavailable', err);
        renderFor(null);
      }

      return identity;
    };

    const requireLogin = (event, destination) => {
      if (event) event.preventDefault();
      const identity = attachIdentity();
      if (!identity || typeof identity.open !== 'function') {
        if (destination) {
          window.location.href = destination;
        }
        return;
      }

      if (destination) {
        sessionStorage.setItem('afterLogin', destination);
      }

      try {
        identity.open('login');
      } catch (err) {
        console.warn('[HMJ] identity.open failed', err);
        identity?.open?.();
      }
    };

    timesheets?.addEventListener('click', (event) => {
      const identity = getIdentity();
      const user = identity?.currentUser?.();
      if (user) return;
      requireLogin(event, '/timesheets.html');
    });

    admin?.addEventListener('click', (event) => {
      const identity = getIdentity();
      const user = identity?.currentUser?.();
      if (user) return;
      requireLogin(event, '/admin/');
    });

    document.addEventListener('hmj:identity-change', (event) => {
      attachIdentity(event?.detail?.identity || null);
    });

    attachIdentity();
  });
})();
