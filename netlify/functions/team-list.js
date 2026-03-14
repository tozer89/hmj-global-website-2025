const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  TEAM_TABLE,
  getTeamSeedMembers,
  sortTeamCollection,
  toPublicTeamMember,
  isMissingTableError,
} = require('./_team-helpers.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function buildFallbackPayload(source, error = '', schema = false) {
  const members = sortTeamCollection(
    getTeamSeedMembers()
      .map(toPublicTeamMember)
      .filter(Boolean)
  );

  return {
    ok: true,
    members,
    source,
    error,
    schema,
    supabase: supabaseStatus(),
  };
}

exports.handler = async (event) => {
  if (!hasSupabase()) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        buildFallbackPayload('fallback', 'Team data service unavailable in this environment.', false)
      ),
    };
  }

  try {
    const supabase = getSupabase(event);
    const { data, error } = await supabase
      .from(TEAM_TABLE)
      .select('*')
      .is('archived_at', null)
      .eq('is_published', true)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true });

    if (error) throw error;

    const members = sortTeamCollection(
      (Array.isArray(data) ? data : [])
        .map(toPublicTeamMember)
        .filter(Boolean)
    );

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        members,
        source: 'supabase',
        schema: false,
        supabase: supabaseStatus(),
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, TEAM_TABLE);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        buildFallbackPayload(
          schemaIssue ? 'setup-required' : 'fallback-error',
          schemaIssue
            ? 'Team table is not available on this environment yet.'
            : (error?.message || 'Team data unavailable'),
          schemaIssue
        )
      ),
    };
  }
};
