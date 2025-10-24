// netlify/functions/supa-health.js
// Provides a quick diagnostic summary for Supabase configuration.

const { lookup } = require('node:dns').promises;
const { URL } = require('node:url');
const { resolveSupabaseUrl, resolveSupabaseServiceKey } = require('./_supabase-env.js');

exports.handler = async () => {
  const urlInfo = resolveSupabaseUrl();
  const keyInfo = resolveSupabaseServiceKey();

  const url = urlInfo.value;
  const key = keyInfo.value;

  const diag = {
    ok: false,
    supabaseUrl: url,
    supabaseUrlSource: urlInfo.source,
    hasServiceKey: Boolean(key),
    serviceKeySource: keyInfo.source,
    env: {
      has_url: Boolean(url),
      has_service_key: Boolean(key),
      url_length: url.length,
      key_length: key.length,
    },
    parsed: {},
    dns: {},
    http: {},
    error: null,
  };

  try {
    if (!url) throw new Error('Supabase URL missing');
    if (!key) throw new Error('Supabase service key missing');

    const parsed = new URL(url);
    diag.parsed = { protocol: parsed.protocol, host: parsed.host, pathname: parsed.pathname };

    try {
      const dnsResult = await lookup(parsed.hostname);
      diag.dns = { hostname: parsed.hostname, address: dnsResult.address, family: dnsResult.family };
    } catch (dnsErr) {
      diag.dns = { hostname: parsed.hostname, error: String(dnsErr?.message || dnsErr) };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: key },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await response.text();
    diag.http = {
      status: response.status,
      ok: response.ok,
      text_preview: text.slice(0, 200),
    };
    diag.ok = response.ok;

    return {
      statusCode: response.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(diag),
    };
  } catch (error) {
    diag.error = String(error && error.message ? error.message : error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(diag),
    };
  }
};
