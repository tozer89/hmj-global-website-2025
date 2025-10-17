// netlify/functions/admin-timesheets-bulk-approve.js
const { supabase, getContext } = require('./_timesheet-helpers');

async function auditMany(actor, ids) {
  const rows = ids.map(id => ({
    actor_email: actor?.email || 'unknown',
    actor_id: actor?.id || null,
    action: 'bulk_approve',
    target_type: 'timesheet',
    target_id: String(id),
    meta: null
  }));
  await supabase.from('admin_audit_logs').insert(rows);
}

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const { ids = [] } = JSON.parse(event.body || '{}');
    if (!Array.isArray(ids) || !ids.length) throw new Error('No ids');

    const { error } = await supabase
      .from('timesheets')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw error;

    await auditMany(user, ids);
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: ids.length }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
