// netlify/functions/supa-health.js
// Provides a quick diagnostic summary for Supabase configuration.

const { lookup } = require('node:dns').promises;
const { URL } = require('node:url');
const { createClient } = require('@supabase/supabase-js');
const { resolveSupabaseUrl, resolveSupabaseServiceKey } = require('./_supabase-env.js');

const DB_PROBES = [
  { table: 'admin_settings', column: 'key' },
  { table: 'timesheets', column: 'id' },
];

function isMissingRelationError(error) {
  const message = String(error?.message || error || '');
  return (
    /relation\s.+does not exist/i.test(message)
    || /Could not find the table/i.test(message)
    || /schema cache/i.test(message)
  );
}

async function probeDatabase(client) {
  const warnings = [];

  for (const probe of DB_PROBES) {
    try {
      const { error } = await client.from(probe.table).select(probe.column).limit(1);
      if (!error) {
        return {
          ok: true,
          probe: {
            table: probe.table,
            column: probe.column,
            schemaReady: true,
          },
          warnings,
        };
      }

      if (isMissingRelationError(error)) {
        warnings.push(`Health probe table "${probe.table}" is missing.`);
        continue;
      }

      return {
        ok: false,
        probe: {
          table: probe.table,
          column: probe.column,
          schemaReady: false,
          error: error.message || String(error),
        },
        warnings,
      };
    } catch (error) {
      return {
        ok: false,
        probe: {
          table: probe.table,
          column: probe.column,
          schemaReady: false,
          error: error?.message || String(error),
        },
        warnings,
      };
    }
  }

  return {
    ok: true,
    probe: {
      table: null,
      column: null,
      schemaReady: false,
      note: 'No health probe tables were found. Connectivity looks OK, but schema bootstrap appears incomplete.',
    },
    warnings,
  };
}

async function probeStorage(client) {
  try {
    const { data, error } = await client.storage.listBuckets();
    if (error) {
      return {
        ok: false,
        details: {
          error: error.message || String(error),
        },
      };
    }

    return {
      ok: true,
      details: {
        bucketCount: Array.isArray(data) ? data.length : 0,
      },
    };
  } catch (error) {
    return {
      ok: false,
      details: {
        error: error?.message || String(error),
      },
    };
  }
}

function createHandler(deps = {}) {
  const lookupImpl = deps.lookup || lookup;
  const fetchImpl = deps.fetch || fetch;
  const createClientImpl = deps.createClient || createClient;
  const resolveSupabaseUrlImpl = deps.resolveSupabaseUrl || resolveSupabaseUrl;
  const resolveSupabaseServiceKeyImpl = deps.resolveSupabaseServiceKey || resolveSupabaseServiceKey;

  return async () => {
    const urlInfo = resolveSupabaseUrlImpl();
    const keyInfo = resolveSupabaseServiceKeyImpl();

    const url = urlInfo.value;
    const key = keyInfo.value;

    const diag = {
      ok: false,
      api: false,
      db: false,
      storage: false,
      supabaseUrl: url,
      supabaseUrlSource: urlInfo.source,
      hasServiceKey: Boolean(key),
      serviceKeySource: keyInfo.source,
      usingAnonFallback: /ANON_KEY$/i.test(String(keyInfo.source || '')),
      env: {
        has_url: Boolean(url),
        has_service_key: Boolean(key),
        url_length: url.length,
        key_length: key.length,
      },
      parsed: {},
      dns: {},
      http: {},
      dbProbe: {},
      storageProbe: {},
      warnings: [],
      error: null,
    };

    try {
      if (!url) throw new Error('Supabase URL missing');
      if (!key) throw new Error('Supabase service key missing');

      const parsed = new URL(url);
      diag.parsed = { protocol: parsed.protocol, host: parsed.host, pathname: parsed.pathname };

      try {
        const dnsResult = await lookupImpl(parsed.hostname);
        diag.dns = { hostname: parsed.hostname, address: dnsResult.address, family: dnsResult.family };
      } catch (dnsErr) {
        diag.dns = { hostname: parsed.hostname, error: String(dnsErr?.message || dnsErr) };
      }

      const client = createClientImpl(url, key, { auth: { persistSession: false } });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const response = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/health`, {
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
      diag.api = response.ok;

      const dbResult = await probeDatabase(client);
      diag.db = dbResult.ok;
      diag.dbProbe = dbResult.probe;
      diag.warnings.push(...dbResult.warnings);

      const storageResult = await probeStorage(client);
      diag.storage = storageResult.ok;
      diag.storageProbe = storageResult.details;

      diag.ok = diag.api && diag.db && diag.storage;

      return {
        statusCode: diag.ok ? 200 : 502,
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
}

const handler = createHandler();

module.exports = {
  handler,
  createHandler,
  isMissingRelationError,
};
