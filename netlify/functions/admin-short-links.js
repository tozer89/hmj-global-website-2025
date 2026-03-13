const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const {
  buildShortLinkUrl,
  buildSlugSuggestions,
  chooseAvailableSlug,
  normaliseShortLinkSlug,
  suggestShortLinkSlug,
  validateDestinationUrl,
} = require('../../lib/short-links.js');

const DEFAULT_LIMIT = 6;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function originFromEvent(event) {
  const proto = event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event?.headers?.host || event?.headers?.Host || '';
  return `${proto}://${host}`.replace(/:\/\/\//, '://');
}

function cleanText(value = '', max = 160) {
  const trimmed = String(value || '').trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, max);
}

function isMissingShortLinksTable(error) {
  const message = String(error?.message || '');
  return (
    error?.code === '42P01' ||
    /relation ["']?public\.short_links["']? does not exist/i.test(message) ||
    /could not find the table ["']?public\.short_links["']?/i.test(message)
  );
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key value violates unique constraint/i.test(String(error?.message || ''));
}

function filterSuggestions(existing, baseSlug, limit = 3) {
  return buildSlugSuggestions(baseSlug, limit + 4)
    .filter((slug) => !existing.has(slug))
    .slice(0, limit);
}

function mapRow(row, origin) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title || '',
    destinationUrl: row.destination_url,
    shortUrl: buildShortLinkUrl(origin, row.slug),
    createdAt: row.created_at || null,
    createdBy: row.created_by || '',
    createdByEmail: row.created_by_email || '',
    isActive: row.is_active !== false,
    clickCount: Number.isFinite(Number(row.click_count)) ? Number(row.click_count) : 0,
    lastUsedAt: row.last_used_at || null,
  };
}

async function loadMatchingSlugs(supabase, baseSlug) {
  const { data, error } = await supabase
    .from('short_links')
    .select('slug')
    .like('slug', `${baseSlug}%`)
    .limit(200);

  if (error) throw error;
  return new Set((data || []).map((row) => normaliseShortLinkSlug(row.slug)).filter(Boolean));
}

async function createShortLink({ supabase, user, body, origin }) {
  const destination = validateDestinationUrl(body?.destinationUrl || body?.destination_url || '');
  if (!destination.ok) {
    return json(400, { ok: false, code: 'invalid_destination_url', error: destination.error });
  }

  const title = cleanText(body?.title || body?.label || '', 120);
  const requestedRawSlug = cleanText(body?.slug || '', 80);
  const requestedSlug = normaliseShortLinkSlug(requestedRawSlug);

  if (requestedRawSlug && !requestedSlug) {
    return json(400, {
      ok: false,
      code: 'invalid_slug',
      error: 'Use only letters, numbers, and hyphens for the short code.',
    });
  }

  const baseSlug = requestedSlug || suggestShortLinkSlug({ title, destinationUrl: destination.url });

  let existing;
  try {
    existing = await loadMatchingSlugs(supabase, baseSlug);
  } catch (error) {
    if (isMissingShortLinksTable(error)) {
      return json(503, {
        ok: false,
        code: 'short_links_setup_required',
        error: 'Short-link storage is not set up yet. Run scripts/create-short-links.sql first.',
      });
    }
    throw error;
  }

  if (requestedSlug && existing.has(requestedSlug)) {
    const suggestedSlug = chooseAvailableSlug(existing, requestedSlug);
    return json(409, {
      ok: false,
      code: 'slug_taken',
      error: 'That short code is already in use.',
      suggestedSlug,
      suggestions: filterSuggestions(existing, requestedSlug),
    });
  }

  let candidate = requestedSlug || chooseAvailableSlug(existing, baseSlug);
  const payload = {
    slug: candidate,
    destination_url: destination.url,
    title: title || null,
    created_by: user?.id || user?.sub || null,
    created_by_email: user?.email || user?.user_metadata?.email || null,
    is_active: true,
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase
      .from('short_links')
      .insert({ ...payload, slug: candidate })
      .select('id, slug, title, destination_url, created_at, created_by, created_by_email, is_active, click_count, last_used_at')
      .single();

    if (!error) {
      return json(200, {
        ok: true,
        item: mapRow(data, origin),
      });
    }

    if (isMissingShortLinksTable(error)) {
      return json(503, {
        ok: false,
        code: 'short_links_setup_required',
        error: 'Short-link storage is not set up yet. Run scripts/create-short-links.sql first.',
      });
    }

    if (!isUniqueViolation(error)) {
      throw error;
    }

    existing.add(candidate);

    if (requestedSlug) {
      const suggestedSlug = chooseAvailableSlug(existing, requestedSlug);
      return json(409, {
        ok: false,
        code: 'slug_taken',
        error: 'That short code is already in use.',
        suggestedSlug,
        suggestions: filterSuggestions(existing, requestedSlug),
      });
    }

    candidate = chooseAvailableSlug(existing, baseSlug);
  }

  return json(409, {
    ok: false,
    code: 'slug_generation_failed',
    error: 'Unable to reserve a unique short code right now. Please try again.',
  });
}

async function listShortLinks({ supabase, origin, event }) {
  const url = new URL(event.rawUrl || `${origin}/.netlify/functions/admin-short-links`);
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 12)
    : DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from('short_links')
    .select('id, slug, title, destination_url, created_at, created_by, created_by_email, is_active, click_count, last_used_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingShortLinksTable(error)) {
      return json(200, {
        ok: true,
        storageReady: false,
        items: [],
        message: 'Run scripts/create-short-links.sql to enable short-link storage.',
      });
    }
    throw error;
  }

  return json(200, {
    ok: true,
    storageReady: true,
    items: (data || []).map((row) => mapRow(row, origin)),
  });
}

const baseHandler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const origin = originFromEvent(event);

    if ((event.httpMethod || 'GET').toUpperCase() === 'GET') {
      return listShortLinks({ supabase, origin, event });
    }

    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      return json(405, { ok: false, code: 'method_not_allowed', error: 'Method not allowed.' });
    }

    const body = JSON.parse(event.body || '{}');
    return createShortLink({ supabase, user, body, origin });
  } catch (error) {
    const status = error?.code === 401 ? 401 : error?.code === 403 ? 403 : 500;
    return json(status, {
      ok: false,
      code: error?.code || 'short_links_error',
      error: error?.message || 'Unexpected short-link error.',
    });
  }
};

exports.handler = withAdminCors(baseHandler);
