// /.netlify/functions/admin-timesheets-clients
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');

module.exports.handler = withSupabase(async ({ supabase, trace }) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id,name')
    .order('name', { ascending: true });

  if (error) return jsonError(500, 'query_failed', error.message, { trace });

  // Return raw array because the UI expects an array (not {items:[]})
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data || [], null, 2)
  };
});
