// netlify/functions/admin-payroll-process.js
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

const ALLOWED = new Set(['paid', 'processing', 'hold', 'ready', 'clear']);

exports.handler = async (event, context) => {
  try {
    const { supabase, user } = await getContext(event, context, { requireAdmin: true });
    const { id, status, note } = JSON.parse(event.body || '{}');

    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'timesheet id required' }) };
    }
    if (!status || !ALLOWED.has(String(status).toLowerCase())) {
      return { statusCode: 400, body: JSON.stringify({ error: 'invalid payroll status' }) };
    }

    const targetId = String(id);
    const action = String(status).toLowerCase() === 'clear' ? 'ready' : String(status).toLowerCase();
    const meta = { status: action };
    if (note) meta.note = String(note);

    await recordAudit({
      actor: user,
      action,
      targetType: 'payroll',
      targetId,
      meta,
    });

    // Touch the timesheet updated_at so downstream automations can detect the change
    await supabase.from('timesheets').update({ updated_at: new Date().toISOString() }).eq('id', id);

    return { statusCode: 200, body: JSON.stringify({ ok: true, status: action }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Failed to update payroll status' }) };
  }
};
