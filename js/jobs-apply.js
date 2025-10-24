(function(global){
  const defaultLocation = { origin: 'https://hmj-global.com', hostname: 'hmj-global.com' };

  function applyHref(title, locText){
    const q = encodeURIComponent(`${title}${locText ? ` (${locText})` : ''}`);
    return `/contact.html?role=${q}`;
  }

  function normalizeApplyUrl(job, locText, locationLike){
    const loc = locationLike || (typeof global.location !== 'undefined' ? global.location : defaultLocation);
    const baseOrigin = loc && loc.origin ? loc.origin : defaultLocation.origin;
    const raw = job.applyUrl && job.applyUrl.trim();
    if(!raw) return applyHref(job.title, locText);
    try{
      const parsed = new URL(raw, baseOrigin);
      const hostname = (parsed.hostname || '').replace(/^www\./i, '');
      const currentHost = ((loc && loc.hostname) || '').replace(/^www\./i, '');
      const contactPath = parsed.pathname.replace(/\/+$/,'');
      const isContact = /\/contact(?:\.html)?$/i.test(contactPath);
      const isSameHost = hostname === currentHost;
      const isHmjHost = hostname === 'hmj-global.com';
      if(isContact && (isSameHost || isHmjHost || !parsed.hostname)){
        const params = new URLSearchParams(parsed.search);
        const expectedRole = `${job.title}${locText ? ` (${locText})` : ''}`;
        params.set('role', expectedRole);
        const query = params.toString();
        return `/contact.html${query ? `?${query}` : ''}`;
      }
      if(parsed.origin === baseOrigin || !parsed.hostname){
        const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return path || applyHref(job.title, locText);
      }
      return parsed.href;
    }catch(err){
      if(typeof console !== 'undefined' && console.warn){
        console.warn('Invalid applyUrl for job', job && (job.id || job.title), err);
      }
      return applyHref(job.title, locText);
    }
  }

  const api = { normalizeApplyUrl, applyHref };

  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
  if(global){
    global.HmjJobsApply = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
