'use strict';

const { createHash } = require('node:crypto');
const { getSupabase, hasSupabase } = require('./_supabase.js');

const LOCAL_RATE_LIMITS = new Map();
const RPC_NAME = 'consume_function_rate_limit';

function trimString(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return Number.isInteger(maxLength) && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function header(event, name) {
  if (!event || !event.headers) return '';
  const wanted = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (String(key || '').toLowerCase() === wanted) return String(value || '');
  }
  return '';
}

function getClientIp(event) {
  const forwarded = trimString(
    header(event, 'x-nf-client-connection-ip')
      || header(event, 'client-ip')
      || header(event, 'x-forwarded-for'),
    200
  );
  if (!forwarded) return '';
  return forwarded.split(',')[0].trim().slice(0, 120);
}

function getHashSalt() {
  return trimString(
    process.env.HMJ_RATE_LIMIT_SALT
      || process.env.RATE_LIMIT_SALT
      || process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_ROLE,
    500
  );
}

function hashSubject(subject, bucket) {
  const safeSubject = trimString(subject, 240);
  if (!safeSubject) return '';
  const salt = getHashSalt();
  return createHash('sha256')
    .update(`${salt}|${trimString(bucket, 120)}|${safeSubject}`)
    .digest('hex');
}

function cleanupLocalStore(now = Date.now()) {
  if (LOCAL_RATE_LIMITS.size < 500) return;
  for (const [key, entry] of LOCAL_RATE_LIMITS.entries()) {
    if (!entry || entry.resetAt <= now) {
      LOCAL_RATE_LIMITS.delete(key);
    }
  }
}

function applyLocalRateLimit(key, max, windowSeconds) {
  const now = Date.now();
  cleanupLocalStore(now);

  const current = LOCAL_RATE_LIMITS.get(key);
  if (!current || current.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + (windowSeconds * 1000),
    };
    LOCAL_RATE_LIMITS.set(key, next);
    return {
      allowed: true,
      limit: max,
      remaining: Math.max(max - 1, 0),
      retryAfterMs: 0,
      resetAt: next.resetAt,
      storage: 'memory',
    };
  }

  current.count += 1;
  return {
    allowed: current.count <= max,
    limit: max,
    remaining: Math.max(max - current.count, 0),
    retryAfterMs: current.count > max ? Math.max(current.resetAt - now, 0) : 0,
    resetAt: current.resetAt,
    storage: 'memory',
  };
}

function normaliseSupabaseResult(row, max, windowSeconds) {
  const resetAtMs = Date.parse(row?.reset_at || '');
  return {
    allowed: !!row?.allowed,
    limit: max,
    remaining: Math.max(Number(row?.remaining) || 0, 0),
    retryAfterMs: Math.max((Number(row?.retry_after_seconds) || 0) * 1000, 0),
    resetAt: Number.isFinite(resetAtMs) ? resetAtMs : (Date.now() + (windowSeconds * 1000)),
    storage: trimString(row?.storage, 40) || 'supabase',
  };
}

function isMissingRateLimitBackend(error) {
  const message = trimString(error?.message || error, 500).toLowerCase();
  return (
    message.includes(RPC_NAME.toLowerCase())
    || message.includes('function_rate_limits')
    || message.includes('could not find the function')
    || message.includes('relation "function_rate_limits" does not exist')
  );
}

async function consumeSupabaseRateLimit(options) {
  const { supabase, bucket, subjectHash, windowSeconds, max, metadata } = options;
  const { data, error } = await supabase.rpc(RPC_NAME, {
    p_bucket: trimString(bucket, 120),
    p_subject_hash: trimString(subjectHash, 120),
    p_window_seconds: Math.max(Number(windowSeconds) || 0, 1),
    p_limit: Math.max(Number(max) || 0, 1),
    p_metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new Error('rate_limit_backend_invalid_response');
  }

  return normaliseSupabaseResult(row, max, windowSeconds);
}

async function enforceRateLimit(options = {}) {
  const bucket = trimString(options.bucket, 120);
  const max = Math.max(Number(options.max) || 0, 1);
  const windowSeconds = Math.max(Number(options.windowSeconds) || 0, 1);
  const rawSubject = trimString(options.subject, 240) || getClientIp(options.event);

  if (!bucket || !rawSubject) {
    return {
      allowed: true,
      limit: max,
      remaining: max,
      retryAfterMs: 0,
      resetAt: Date.now() + (windowSeconds * 1000),
      storage: 'disabled',
    };
  }

  const subjectHash = hashSubject(rawSubject, bucket) || rawSubject;

  if (options.supabase || hasSupabase()) {
    try {
      const supabase = options.supabase || getSupabase(options.event);
      const result = await consumeSupabaseRateLimit({
        supabase,
        bucket,
        subjectHash,
        windowSeconds,
        max,
        metadata: options.metadata,
      });
      return { ...result, subjectHash };
    } catch (error) {
      if (!isMissingRateLimitBackend(error)) {
        console.warn('[rate-limit] falling back to local store for %s: %s', bucket, error?.message || error);
      }
    }
  }

  return {
    ...applyLocalRateLimit(`${bucket}:${subjectHash}`, max, windowSeconds),
    subjectHash,
  };
}

function buildRateLimitHeaders(result) {
  const resetAt = Number(result?.resetAt) || 0;
  const headers = {
    'x-rate-limit-limit': String(Math.max(Number(result?.limit) || 0, 0)),
    'x-rate-limit-remaining': String(Math.max(Number(result?.remaining) || 0, 0)),
    'x-rate-limit-reset': resetAt ? new Date(resetAt).toISOString() : new Date().toISOString(),
    'x-rate-limit-storage': trimString(result?.storage, 40) || 'memory',
  };
  if (!result?.allowed && result?.retryAfterMs) {
    headers['retry-after'] = String(Math.max(Math.ceil(Number(result.retryAfterMs) / 1000), 1));
  }
  return headers;
}

function __resetLocalRateLimitStore() {
  LOCAL_RATE_LIMITS.clear();
}

module.exports = {
  buildRateLimitHeaders,
  enforceRateLimit,
  getClientIp,
  hashSubject,
  __resetLocalRateLimitStore,
};
