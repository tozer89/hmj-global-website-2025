'use strict';

const DEFAULT_SITE_URL = 'https://hmjg.netlify.app';

function resolveSiteUrl(event = {}) {
  const forwardedProto = String(event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https').trim();
  const forwardedHost = String(event?.headers?.['x-forwarded-host'] || event?.headers?.host || event?.headers?.Host || '').trim();

  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`.replace(/\/$/, '');
  }

  const fallback = [
    process.env.HMJ_CANONICAL_SITE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    DEFAULT_SITE_URL,
  ].find((value) => typeof value === 'string' && value.trim());

  return String(fallback || DEFAULT_SITE_URL).replace(/\/$/, '');
}

exports.handler = async (event) => {
  const siteUrl = resolveSiteUrl(event);
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
    body: [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin/',
      'Disallow: /admin-v2/',
      'Disallow: /.netlify/',
      '',
      `Sitemap: ${siteUrl}/sitemap.xml`,
      '',
    ].join('\n'),
  };
};
