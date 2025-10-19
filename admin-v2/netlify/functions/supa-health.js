// netlify/functions/supa-health.js
const { lookup } = require('node:dns').promises;
const { URL } = require('node:url');

exports.handler = async () => {
  const rawUrl = (process.env.SUPABASE_URL || '').trim();
  const keyRaw = (process.env.SUPABASE_SERVICE_KEY || '').trim();

  // sanitize + basic validate
  const url = rawUrl.replace(/[)\s]+$/g, ''); // strip any trailing ) or spaces
  const diag = {
    env: {
      has_url: !!url,
      has_service_key: !!keyRaw,
      url_length: url.length,
      key_length: keyRaw.length,
    },
    url,
    parsed: {},
    dns: {},
    http: {},
    error: null,
  };

  try {
    if (!url) throw new Error('SUPABASE_URL is empty');
    if (!keyRaw) throw new Error('SUPABASE_SERVICE_KEY is empty');

    // parse URL details
    const u = new URL(url);
    diag.parsed = { protocol: u.protocol, host: u.host, pathname: u.pathname };

    // DNS lookup (helps spot typos)
    try {
      const a = await lookup(u.hostname);
      diag.dns = { hostname: u.hostname, address: a.address, family: a.family };
    } catch (e) {
      diag.dns = { hostname: u.hostname, error: String(e.message || e) };
    }

    // call Supabase auth health with a tight timeout
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: keyRaw },
      signal: controller.signal,
    }).catch((e) => { throw e; });
    clearTimeout(t);

    const text = await res.text();
    diag.http = {
      status: res.status,
      ok: res.ok,
      text_preview: text.slice(0, 200),
    };

    return {
      statusCode: res.ok ? 200 : 502,
      body: JSON.stringify(diag),
    };
  } catch (e) {
    diag.error = String(e && e.message ? e.message : e);
    return { statusCode: 500, body: JSON.stringify(diag) };
  }
};

// netlify/functions/supa-health.js
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type':'application/json' },
  body: JSON.stringify({
    ok: true,
    supabaseUrl: process.env.SUPABASE_URL,
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY)
  })
});
