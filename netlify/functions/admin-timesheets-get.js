// netlify/functions/admin-timesheets-get.js
const { getContext } = require('./_auth.js');

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

exports.handler = async (event, context) => {
  try {
    const { supabase } = await getContext(event, context, { requireAdmin: true });

    let id = null;
    try { id = JSON.parse(event.body || '{}').id; } catch {}
    id = Number(id);
    if (!id) throw new Error('Missing id');

    const { data: meta, error: errMeta } = await supabase
      .from('v_timesheets_admin')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (errMeta) throw errMeta;
    if (!meta) return { statusCode: 404, body: JSON.stringify({ error: 'Timesheet not found' }) };

    const { data: entries, error: errEntries } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', id);
    if (errEntries) throw errEntries;

    const ordered = {};
    for (const d of DAYS) {
      const match = (entries || []).find(r => r.day === d) || {};
      ordered[d] = {
        std: Number(match.hours_std || 0),
        ot: Number(match.hours_ot || 0),
        note: match.note || ''
      };
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: meta.id,
        status: meta.status,
        week_ending: meta.week_ending,
        contractor_email: meta.contractor_email,
        assignment: {
          client_name: meta.client_name,
          project_name: meta.project_name,
          site_name: meta.site_name,
          rate_std: Number(meta.rate_std ?? 0),
          rate_ot: Number(meta.rate_ot ?? 0)
        },
        rate_std: Number(meta.rate_std ?? 0),
        rate_ot: Number(meta.rate_ot ?? 0),
        entries: ordered
      }, null, 2)
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Failed to load timesheet' }) };
  }
};
