(function(){
  const WIDGET_SRC = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
  const PRODUCTION_IDENTITY = 'https://hmjg.netlify.app/.netlify/identity';
  const candidates = [];
  const seen = new Set();

  function addCandidate(url) {
    if (!url || typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const normalised = trimmed.replace(/\/$/, '');
    if (seen.has(normalised)) return;
    seen.add(normalised);
    candidates.push(normalised);
  }

  addCandidate(window.ADMIN_IDENTITY_URL);
  addCandidate(window.NETLIFY_IDENTITY_URL);

  try {
    const local = `${location.origin.replace(/\/$/, '')}/.netlify/identity`;
    addCandidate(local);
  } catch (err) {
    // ignore
  }

  addCandidate(PRODUCTION_IDENTITY);

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

  chooseEndpoint().catch(() => null).then((apiUrl) => {
    const fallback = candidates.find((item) => !!item) || PRODUCTION_IDENTITY;
    const resolved = (apiUrl || fallback || '').replace(/\/$/, '');

    if (!resolved) {
      flushReady(null);
      document.dispatchEvent(new CustomEvent('hmjIdentityUnavailable'));
      return;
    }

    const settings = window.netlifyIdentitySettings = window.netlifyIdentitySettings || {};
    settings.APIUrl = resolved;

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
