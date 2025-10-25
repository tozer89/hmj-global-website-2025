// netlify/functions/admin-assignments-get.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { supabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { loadStaticAssignments } = require('./_assignments-helpers.js');

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    if (!hasSupabase()) {
      const rows = loadStaticAssignments();
      const match = rows.find((row) => String(row.id) === String(id));
      if (!match) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Assignment not found in static dataset', supabase: supabaseStatus() }),
        };
      }
      return { statusCode: 200, body: JSON.stringify({ ...match, readOnly: true, source: 'static' }) };
    }

    const { data, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
