// netlify/functions/admin-clients-list.js
const { withAdminCors } = require('./_http.js');
const { supabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { loadStaticClients } = require('./_clients-helpers.js');

function isMissingClientsSchemaError(error) {
  const message = String(error?.message || error || '');
  return /Could not find the table 'public\.clients' in the schema cache/i.test(message)
    || /relation "?clients"? does not exist/i.test(message);
}

function filterRows(rows = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.name,
      row.billing_email,
      row.phone,
      row.client_code,
      row.contact_name,
      row.contact_email,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

function staticResponse(query) {
  const rows = filterRows(loadStaticClients().map((row) => ({
    ...row,
    terms_text: row.notes || null,
    source: 'static',
    readOnly: true,
  })), query);
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'x-hmj-fallback': 'static-clients' },
    body: JSON.stringify({
      rows,
      total: rows.length,
      source: 'static',
      readOnly: true,
      tableAvailable: false,
      message: 'Clients table is not available. Showing fallback data until Timesheet Portal sync runs.',
    }),
  };
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const { q } = JSON.parse(event.body || '{}');

    if (!hasSupabase()) {
      const response = staticResponse(q);
      response.headers['x-supabase-status'] = String(supabaseStatus());
      return response;
    }

    let query = supabase
      .from('clients')
      .select('id,name,billing_email,phone,contact_name,contact_email,contact_phone,terms_days,status,address,billing', { count: 'exact' })
      .order('name', { ascending: true });

    if (q) {
      const like = `%${String(q).trim()}%`;
      query = query.or([
        `name.ilike.${like}`,
        `billing_email.ilike.${like}`,
        `contact_email.ilike.${like}`,
        `phone.ilike.${like}`,
      ].join(','));
    }

    const { data, error, count } = await query;
    if (error) {
      if (isMissingClientsSchemaError(error)) return staticResponse(q);
      throw error;
    }

    const rows = (Array.isArray(data) ? data : []).map((row) => ({
      ...row,
      terms_text: row?.billing?.notes || null,
      source: 'supabase',
      readOnly: false,
    }));
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rows,
        total: count ?? rows.length,
        source: 'supabase',
        readOnly: false,
        tableAvailable: true,
      }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
