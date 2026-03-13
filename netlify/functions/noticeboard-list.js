const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { fetchSettings, DEFAULT_SETTINGS } = require('./_settings-helpers.js');
const {
  NOTICEBOARD_TABLE,
  asBoolean,
  sortNoticeCollection,
  toPublicNotice,
  isMissingTableError,
} = require('./_noticeboard-helpers.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'public, max-age=60, stale-while-revalidate=300',
};

exports.handler = async (event) => {
  const settingsResult = await fetchSettings(event, ['noticeboard_enabled']);
  const enabled = asBoolean(
    settingsResult?.settings?.noticeboard_enabled ?? DEFAULT_SETTINGS.noticeboard_enabled
  );

  if (!enabled) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        enabled: false,
        notices: [],
        source: 'disabled',
        supabase: supabaseStatus(),
      }),
    };
  }

  if (!hasSupabase()) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        enabled: true,
        notices: [],
        source: 'unavailable',
        error: 'Noticeboard data service unavailable',
        supabase: supabaseStatus(),
        schema: false,
      }),
    };
  }

  try {
    const supabase = getSupabase(event);
    const { data, error } = await supabase
      .from(NOTICEBOARD_TABLE)
      .select('*')
      .in('status', ['published', 'scheduled'])
      .order('featured', { ascending: false })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('publish_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const notices = sortNoticeCollection(
      (Array.isArray(data) ? data : [])
        .map(toPublicNotice)
        .filter(Boolean)
    );

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        enabled: true,
        notices,
        source: 'supabase',
        supabase: supabaseStatus(),
        schema: false,
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, NOTICEBOARD_TABLE);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        enabled: true,
        notices: [],
        source: schemaIssue ? 'setup-required' : 'unavailable',
        error: schemaIssue
          ? 'Noticeboard table is not available on this environment yet.'
          : (error?.message || 'Noticeboard data unavailable'),
        supabase: supabaseStatus(),
        schema: schemaIssue,
      }),
    };
  }
};
