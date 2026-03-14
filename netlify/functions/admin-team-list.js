const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  TEAM_BUCKET,
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

async function resolveBucketSetup(supabase) {
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      return {
        ready: false,
        message: error.message || 'Unable to inspect Team image storage.',
      };
    }

    const ready = Array.isArray(data) && data.some((bucket) => bucket?.id === TEAM_BUCKET);
    return {
      ready,
      message: ready
        ? ''
        : `The Team table is live, but the "${TEAM_BUCKET}" storage bucket is still missing. Image upload and replacement will fail until the full SQL setup is applied.`,
    };
  } catch (error) {
    return {
      ready: false,
      message: error?.message || 'Unable to inspect Team image storage.',
    };
  }
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
    const bucketSetup = await resolveBucketSetup(supabase);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        members,
        readOnly: false,
        source: 'supabase',
        schema: !bucketSetup.ready,
        error: bucketSetup.message,
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
              ? `The "${TEAM_TABLE}" table is missing on this environment, so Team is running in seeded preview mode until the SQL setup script is applied.`
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
