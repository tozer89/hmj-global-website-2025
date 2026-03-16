'use strict';

const { getSupabase, hasSupabase } = require('./_supabase.js');
const { toPublicJob } = require('./_jobs-helpers.js');

const SITE_URL = 'https://www.hmj-global.com';

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
  const entries = [
    { loc: `${SITE_URL}/`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/about`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/clients`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/jobs`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/candidates`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/contact`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/client-contact`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/timesheets`, lastmod: new Date().toISOString() },
    { loc: `${SITE_URL}/jobs/gold-card-electrician-slough/`, lastmod: new Date().toISOString() },
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
              loc: `${SITE_URL}${job.publicDetailPath || `/jobs/spec.html?id=${encodeURIComponent(job.id)}`}`,
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
      'cache-control': 'public, max-age=3600',
    },
    body,
  };
};
