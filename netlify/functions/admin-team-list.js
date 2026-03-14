const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  TEAM_TABLE,
  getTeamSeedMembers,
  sortTeamCollection,
  toTeamMember,
  isMissingTableError,
} = require('./_team-helpers.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function buildReadOnlyPayload(source, error = '', schema = false) {
  const members = sortTeamCollection(getTeamSeedMembers().map(toTeamMember));
  return {
    ok: true,
    members,
    readOnly: true,
    source,
    error,
    schema,
    supabase: supabaseStatus(),
  };
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });

    if (!hasSupabase()) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(
          buildReadOnlyPayload('fallback', 'Team storage is unavailable, so this module is in safe preview mode.')
        ),
      };
    }

    const supabase = getSupabase(event);
    const { data, error } = await supabase
      .from(TEAM_TABLE)
      .select('*')
      .order('archived_at', { ascending: true, nullsFirst: true })
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true });

    if (error) throw error;

    const members = sortTeamCollection((Array.isArray(data) ? data : []).map(toTeamMember));

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        members,
        readOnly: false,
        source: 'supabase',
        schema: false,
        supabase: supabaseStatus(),
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, TEAM_TABLE);
    const status = error?.code === 401 ? 401 : error?.code === 403 ? 403 : 200;
    return {
      statusCode: status,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        status === 200
          ? buildReadOnlyPayload(
            schemaIssue ? 'setup-required' : 'fallback-error',
            schemaIssue
              ? 'Team storage has not been created on this environment yet.'
              : (error?.message || 'Team data unavailable'),
            schemaIssue
          )
          : {
            ok: false,
            members: [],
            readOnly: true,
            source: 'unauthorized',
            error: error?.message || 'Unauthorized',
            schema: schemaIssue,
            supabase: supabaseStatus(),
          }
      ),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
