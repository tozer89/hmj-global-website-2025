(function(){
  const WIDGET_SRC = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
  const PRODUCTION_IDENTITY = 'https://hmjg.netlify.app/.netlify/identity';
  const candidates = [];
  try {
    const local = `${location.origin.replace(/\/$/, '')}/.netlify/identity`;
    if (!candidates.includes(local)) candidates.push(local);
  } catch (err) {
    // ignore
  }
  if (!candidates.includes(PRODUCTION_IDENTITY)) candidates.push(PRODUCTION_IDENTITY);

  const readyQueue = [];
  function flushReady(instance) {
    while (readyQueue.length) {
      const cb = readyQueue.shift();
      try { cb(instance || null); }
      catch (err) { console.error('[identity] ready callback failed', err); }
    }
  }

  window.hmjIdentityReady = function(cb) {
    if (typeof cb !== 'function') return;
    const id = window.netlifyIdentity;
    if (id && typeof id.on === 'function') {
      cb(id);
    } else {
      readyQueue.push(cb);
    }
  };

  function observeIdentity() {
    const markReady = () => {
      const id = window.netlifyIdentity;
      if (!id || typeof id.on !== 'function') return;
      flushReady(id);
    };
    document.addEventListener('netlifyIdentityLoad', markReady);
    const poll = setInterval(() => {
      const id = window.netlifyIdentity;
      if (id && typeof id.on === 'function') {
        clearInterval(poll);
        markReady();
      }
    }, 120);
    setTimeout(() => clearInterval(poll), 10000);
  }

  observeIdentity();

  async function chooseEndpoint() {
    if (typeof fetch !== 'function') return candidates[0] || null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const url = candidate.replace(/\/$/, '');
      try {
        const res = await fetch(`${url}/config`, { mode: 'cors', cache: 'no-store' });
        if (res.ok) return url;
      } catch (err) {
        // Continue to next candidate
      }
    }
    return null;
  }

  chooseEndpoint().then((apiUrl) => {
    if (!apiUrl) {
      flushReady(null);
      document.dispatchEvent(new CustomEvent('hmjIdentityUnavailable'));
      return;
    }

    const settings = window.netlifyIdentitySettings = window.netlifyIdentitySettings || {};
    settings.APIUrl = apiUrl.replace(/\/$/, '');

    if (document.getElementById('netlify-identity-widget')) return;
    const script = document.createElement('script');
    script.id = 'netlify-identity-widget';
    script.src = WIDGET_SRC;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      flushReady(null);
      document.dispatchEvent(new CustomEvent('hmjIdentityUnavailable'));
    };
    document.head.appendChild(script);
  });
})();
