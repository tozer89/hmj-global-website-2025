const { getSupabase } = require('./_supabase.js');
const {
  mergeDestinationQuery,
  normaliseShortLinkSlug,
} = require('../../lib/short-links.js');

function html(statusCode, title, message) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-robots-tag': 'noindex, nofollow',
    },
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>${title}</title>
  <style>
    :root{color-scheme:light;background:#f4f6ff;color:#0f1b3f}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;background:radial-gradient(circle at top left,rgba(63,102,199,.14),transparent 38%),#f4f6ff}
    main{width:min(92vw,520px);padding:28px;border-radius:24px;background:rgba(255,255,255,.96);border:1px solid rgba(47,78,162,.14);box-shadow:0 24px 48px rgba(15,27,63,.14)}
    p{margin:0 0 16px;color:#4f638f}
    h1{margin:0 0 10px;font-size:28px;line-height:1.1}
    a{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:#2f4ea2;color:#fff;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <main>
    <p>HMJ Global</p>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Return to HMJ Global</a>
  </main>
</body>
</html>`,
  };
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: {
      location,
      'cache-control': 'no-store, max-age=0',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-robots-tag': 'noindex, nofollow',
    },
    body: '',
  };
}

function isMissingShortLinksTable(error) {
  const message = String(error?.message || '');
  return (
    error?.code === '42P01' ||
    /relation ["']?public\.short_links["']? does not exist/i.test(message) ||
    /could not find the table ["']?public\.short_links["']?/i.test(message)
  );
}

function requestedSlug(event) {
  const querySlug = event?.queryStringParameters?.slug || '';
  if (querySlug) return normaliseShortLinkSlug(querySlug);

  const path = event?.path || event?.rawUrl || '';
  const match = String(path).match(/\/go\/([^/?#]+)/i);
  return normaliseShortLinkSlug(match ? decodeURIComponent(match[1]) : '');
}

async function updateUsage(supabase, row) {
  try {
    await supabase
      .from('short_links')
      .update({
        click_count: Math.max(0, Number(row?.click_count || 0)) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('slug', row.slug);
  } catch (error) {
    console.warn('[short-link-go] usage update failed', error?.message || error);
  }
}

exports.handler = async (event) => {
  const slug = requestedSlug(event);
  if (!slug) {
    return html(404, 'Link unavailable', 'This HMJ short link is not available.');
  }

  let supabase;
  try {
    supabase = getSupabase(event);
  } catch (error) {
    return html(503, 'Link temporarily unavailable', 'This HMJ short link is temporarily unavailable. Please try again shortly.');
  }

  let data;
  try {
    const result = await supabase
      .from('short_links')
      .select('slug, destination_url, is_active, click_count')
      .eq('slug', slug)
      .limit(1)
      .maybeSingle();

    if (result.error) {
      if (isMissingShortLinksTable(result.error)) {
        return html(503, 'Link temporarily unavailable', 'This HMJ short link is temporarily unavailable. Please try again shortly.');
      }
      throw result.error;
    }

    data = result.data;
  } catch (error) {
    console.error('[short-link-go] lookup failed', error?.message || error);
    return html(503, 'Link temporarily unavailable', 'This HMJ short link is temporarily unavailable. Please try again shortly.');
  }

  if (!data || data.is_active === false) {
    return html(404, 'Link unavailable', 'This HMJ short link is not available.');
  }

  const passthrough = new URLSearchParams(event?.queryStringParameters || {});
  passthrough.delete('slug');

  const location = mergeDestinationQuery(data.destination_url, passthrough);
  await updateUsage(supabase, data);
  return redirect(location);
};
