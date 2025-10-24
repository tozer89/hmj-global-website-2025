(function(){
  function rolesOf(user) {
    if (Array.isArray(user?.app_metadata?.roles)) return user.app_metadata.roles;
    if (Array.isArray(user?.roles)) return user.roles;
    return [];
  }

  function attach() {
    const admin = document.getElementById('nav-admin');
    const timesheets = document.getElementById('nav-timesheets');

    if (!admin && !timesheets) return;

    let identity = null;
    let identityBound = false;

    function requireLogin(event, destination) {
      if (event) event.preventDefault();
      if (!identity) {
        if (destination) window.location.href = destination;
        return;
      }
      if (destination) sessionStorage.setItem('afterLogin', destination);
      identity.open('login');
    }

    function setTimesheets(user) {
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
    }

    function setAdmin(user) {
      if (!admin) return;
      const roles = rolesOf(user);
      const isAdmin = roles.includes('admin');
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
    }

    function renderFor(user) {
      setTimesheets(user);
      setAdmin(user);
    }

    renderFor(null);

    timesheets?.addEventListener('click', (event) => {
      const user = identity?.currentUser?.();
      if (user) return;
      requireLogin(event, '/timesheets.html');
    });

    admin?.addEventListener('click', (event) => {
      const user = identity?.currentUser?.();
      if (user) return;
      requireLogin(event, '/admin/');
    });

    function bindIdentity(id) {
      if (!id) {
        identity = null;
        renderFor(null);
        return;
      }

      identity = id;

      const safeRender = () => {
        try {
          renderFor(identity.currentUser?.() || null);
        } catch (err) {
          console.warn('[nav-session] failed to read identity user', err);
          renderFor(null);
        }
      };

      if (!identityBound) {
        identityBound = true;
        identity.on('init', (user) => renderFor(user || null));
        identity.on('login', (user) => renderFor(user || null));
        identity.on('logout', () => renderFor(null));
      }

      safeRender();
    }

    const onIdentity = window.hmjIdentityReady || function(cb){ cb(window.netlifyIdentity || null); };
    onIdentity((id) => bindIdentity(id));
    document.addEventListener('hmjIdentityUnavailable', () => bindIdentity(null), { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
