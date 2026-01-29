(function(){
  function attach() {
    const admin = document.getElementById('nav-admin');
    if (!admin) return;
    admin.href = '/admin/';
    admin.removeAttribute('aria-disabled');
    admin.title = 'Open the admin portal';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
