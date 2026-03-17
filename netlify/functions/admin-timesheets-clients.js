// /.netlify/functions/admin-timesheets-clients
const { withSupabase, jsonError } = require('./_supabase.js');
const { loadStaticClients } = require('./_clients-helpers.js');

function isMissingClientsSchemaError(error) {
  const message = String(error?.message || error || '');
  return /Could not find the table 'public\.clients' in the schema cache/i.test(message)
    || /relation "?clients"? does not exist/i.test(message);
}

module.exports.handler = withSupabase(async ({ supabase, trace }) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id,name')
    .order('name', { ascending: true });

  if (error) {
    if (isMissingClientsSchemaError(error)) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'x-hmj-fallback': 'static-clients' },
        body: JSON.stringify(loadStaticClients().map((row) => ({ id: row.id, name: row.name })), null, 2),
      };
    }
    return jsonError(500, 'query_failed', error.message, { trace });
  }

  // Return raw array because the UI expects an array (not {items:[]})
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data || [], null, 2)
  };
});
