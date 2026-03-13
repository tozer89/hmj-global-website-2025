const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { fetchSettings, DEFAULT_SETTINGS } = require('./_settings-helpers.js');
const {
  NOTICEBOARD_TABLE,
  asBoolean,
  sortNoticeCollection,
  toNotice,
  isMissingTableError,
} = require('./_noticeboard-helpers.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const settingsResult = await fetchSettings(event, ['noticeboard_enabled']);
    const enabled = asBoolean(
      settingsResult?.settings?.noticeboard_enabled ?? DEFAULT_SETTINGS.noticeboard_enabled
    );

    if (!hasSupabase()) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ok: true,
          enabled,
          notices: [],
          readOnly: true,
          source: 'unavailable',
          error: 'Noticeboard data service unavailable',
          supabase: supabaseStatus(),
          schema: false,
        }),
      };
    }

    const supabase = getSupabase(event);
    const { data, error } = await supabase
      .from(NOTICEBOARD_TABLE)
      .select('*')
      .order('featured', { ascending: false })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('publish_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('title', { ascending: true });

    if (error) throw error;

    const notices = sortNoticeCollection((Array.isArray(data) ? data : []).map(toNotice));

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        enabled,
        notices,
        readOnly: false,
        source: 'supabase',
        supabase: supabaseStatus(),
        schema: false,
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, NOTICEBOARD_TABLE);
    const status = error?.code === 401 ? 401 : error?.code === 403 ? 403 : 200;
    return {
      statusCode: status,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: status === 200,
        enabled: DEFAULT_SETTINGS.noticeboard_enabled,
        notices: [],
        readOnly: true,
        source: schemaIssue ? 'setup-required' : 'unavailable',
        error: schemaIssue
          ? 'Noticeboard storage has not been created on this environment yet.'
          : (error?.message || 'Noticeboard data unavailable'),
        supabase: supabaseStatus(),
        schema: schemaIssue,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
