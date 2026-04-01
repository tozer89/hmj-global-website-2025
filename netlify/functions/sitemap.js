'use strict';

const { getSupabase, hasSupabase } = require('./_supabase.js');
const { toPublicJob } = require('./_jobs-helpers.js');

const DEFAULT_SITE_URL = 'https://hmjg.netlify.app';

function normaliseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';

  try {
    const url = new URL(value.trim());
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return '';
  }
}

function originFromUrl(value) {
  const url = normaliseUrl(value);
  if (!url) return '';

  try {
    return new URL(url).origin;
  } catch (_error) {
    return '';
  }
}

function resolveSiteUrl(event = {}) {
  const rawUrl = originFromUrl(event?.rawUrl);
  if (rawUrl) return rawUrl;

  const envCandidates = [
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.HMJ_CANONICAL_SITE_URL,
    DEFAULT_SITE_URL,
  ];

  const forwardedProto = String(event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https').trim();
  const forwardedHost = String(event?.headers?.['x-forwarded-host'] || event?.headers?.host || event?.headers?.Host || '').trim();

  if (forwardedHost) {
    return normaliseUrl(`${forwardedProto || 'https'}://${forwardedHost}`) || DEFAULT_SITE_URL;
  }

  const fallback = envCandidates.find((value) => typeof value === 'string' && value.trim());
  return normaliseUrl(String(fallback || DEFAULT_SITE_URL)) || DEFAULT_SITE_URL;
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildUrlEntry(loc, lastmod) {
  return [
    '<url>',
    `<loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : '',
    '</url>',
  ].filter(Boolean).join('');
}

function uniqueByLoc(entries = []) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry?.loc || seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
}

exports.handler = async (event) => {
  const siteUrl = resolveSiteUrl(event);
  const entries = [
    { loc: `${siteUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/about`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/clients`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/rate-book`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/jobs`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/candidates`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/contact`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/client-contact`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/timesheets`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/jobs/gold-card-electrician-slough/`, lastmod: new Date().toISOString() },
  ];

  if (hasSupabase()) {
    try {
      const supabase = getSupabase(event);
      const result = await supabase
        .from('jobs')
        .select('*')
        .eq('published', true)
        .order('updated_at', { ascending: false });
      if (!result.error && Array.isArray(result.data)) {
        result.data
          .map(toPublicJob)
          .filter((job) => job && job.published !== false && job.id)
          .forEach((job) => {
            entries.push({
              loc: `${siteUrl}${job.publicDetailPath || `/jobs/spec.html?id=${encodeURIComponent(job.id)}`}`,
              lastmod: job.updatedAt || job.createdAt || null,
            });
          });
      }
    } catch (_error) {
      // Keep the sitemap available even if live jobs are unavailable.
    }
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...uniqueByLoc(entries).map((entry) => buildUrlEntry(entry.loc, entry.lastmod)),
    '</urlset>',
  ].join('');

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
    body,
  };
};
