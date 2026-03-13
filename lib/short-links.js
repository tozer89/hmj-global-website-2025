const SHORT_LINK_ROUTE_PREFIX = '/go';
const GENERIC_SEGMENTS = new Set(['go', 'home', 'index', 'link', 'links', 'share', 'open']);

function normaliseText(value = '') {
  return String(value || '').trim();
}

function slugifyShortCode(value = '') {
  return normaliseText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function normaliseShortLinkSlug(value = '') {
  return slugifyShortCode(value);
}

function validateDestinationUrl(value = '') {
  const raw = normaliseText(value);
  if (!raw) {
    return { ok: false, error: 'Paste a destination URL to create a short link.' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Enter a full URL including http:// or https://.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only http:// and https:// destinations are supported.' };
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'Enter a full destination URL with a hostname.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Destination URLs cannot include embedded usernames or passwords.' };
  }

  return { ok: true, url: parsed.toString(), parsed };
}

function suggestShortLinkSlug({ title = '', destinationUrl = '' } = {}) {
  const titleSlug = slugifyShortCode(title);
  if (titleSlug) return titleSlug;

  const destination = validateDestinationUrl(destinationUrl);
  if (!destination.ok) return 'link';

  const { parsed } = destination;
  const segments = parsed.pathname
    .split('/')
    .map((segment) => segment.replace(/\.[a-z0-9]+$/i, ''))
    .map(slugifyShortCode)
    .filter(Boolean)
    .filter((segment) => !GENERIC_SEGMENTS.has(segment));

  if (segments.length) {
    return segments[segments.length - 1];
  }

  return slugifyShortCode(parsed.hostname.replace(/^www\./i, '').replace(/\./g, '-')) || 'link';
}

function buildSlugSuggestions(baseSlug, limit = 3) {
  const base = normaliseShortLinkSlug(baseSlug) || 'link';
  const suggestions = [];
  let suffix = 2;
  while (suggestions.length < limit) {
    suggestions.push(`${base}-${suffix}`);
    suffix += 1;
  }
  return suggestions;
}

function chooseAvailableSlug(existingSlugs, baseSlug) {
  const base = normaliseShortLinkSlug(baseSlug) || 'link';
  const taken = existingSlugs instanceof Set
    ? existingSlugs
    : new Set(
      Array.from(existingSlugs || [])
        .map(normaliseShortLinkSlug)
        .filter(Boolean)
    );

  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`) && suffix < 10000) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function buildShortLinkPath(slug = '') {
  const clean = normaliseShortLinkSlug(slug);
  return clean
    ? `${SHORT_LINK_ROUTE_PREFIX}/${encodeURIComponent(clean)}`
    : SHORT_LINK_ROUTE_PREFIX;
}

function buildShortLinkUrl(origin = '', slug = '') {
  return `${String(origin || '').replace(/\/$/, '')}${buildShortLinkPath(slug)}`;
}

function mergeDestinationQuery(destinationUrl, searchParams) {
  const target = new URL(destinationUrl);
  const incoming = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');

  for (const [key, value] of incoming.entries()) {
    if (!key) continue;
    target.searchParams.append(key, value);
  }

  return target.toString();
}

module.exports = {
  SHORT_LINK_ROUTE_PREFIX,
  slugifyShortCode,
  normaliseShortLinkSlug,
  validateDestinationUrl,
  suggestShortLinkSlug,
  buildSlugSuggestions,
  chooseAvailableSlug,
  buildShortLinkPath,
  buildShortLinkUrl,
  mergeDestinationQuery,
};
