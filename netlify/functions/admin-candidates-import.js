// netlify/functions/admin-candidates-import.js
// Placeholder endpoint so the admin UI receives a helpful response when
// previews attempt to import CSV data. Full Supabase upsert logic can be
// added later once the production schema is finalised.

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');

const baseHandler = async (event, context) => {
  let ctx;
  try {
    ctx = await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    return { statusCode: err.code || 403, body: JSON.stringify({ error: err.message || 'Unauthorized' }) };
  }

  const hasSupabase = ctx.supabase && typeof ctx.supabase.from === 'function';
  if (!hasSupabase) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Supabase unavailable — import disabled in this environment.',
        readOnly: true,
      }),
    };
  }

  return {
    statusCode: 501,
    body: JSON.stringify({
      error: 'CSV import has not been enabled yet. Please add candidates directly in Supabase or use the admin UI.',
    }),
  };
};

exports.handler = withAdminCors(baseHandler);
