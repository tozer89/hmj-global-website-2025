// netlify/functions/admin-assignments-save.js
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    const { user, roles } = await getContext(context, { requireAdmin: true });
    const p = JSON.parse(event.body || '{}');

    if (!p.contractor_id || !p.project_id || !p.start_date)
      throw coded(400, 'contractor_id, project_id, start_date required');

    const row = {
      contractor_id: p.contractor_id,
      project_id: p.project_id,
      rate_std: p.rate_std ?? 0,
      rate_ot: p.rate_ot ?? 0,
      start_date: p.start_date,
      end_date: p.end_date || null,
      po_number: p.po_number || null,
      active: p.active ?? true,
      closed_at: p.active === false && !p.closed_at ? new Date().toISOString() : p.closed_at || null
    };

    let res = p.id
      ? await supabase.from('assignments').update(row).eq('id', p.id).select().single()
      : await supabase.from('assignments').insert(row).select().single();

    if (res.error) throw coded(500, res.error.message);

    await supabase.from('audit_log').insert({
      actor_email: user.email, actor_roles: roles,
      action: p.id ? (row.active ? 'update' : 'close') : 'create',
      entity: 'assignment', entity_id: res.data.id, payload: row
    });

    return { statusCode: 200, body: JSON.stringify(res.data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
