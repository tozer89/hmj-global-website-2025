// netlify/functions/admin-candidates-delete.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

const baseHandler = async (event, context) => {
  try {
    const { user, supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
    const { id, ids } = JSON.parse(event.body || '{}');

    if (!supabase || typeof supabase.from !== 'function') {
      const reason = supabaseError?.message || 'Supabase not configured for this deploy';
      return { statusCode: 503, body: JSON.stringify({ error: reason, readOnly: true }) };
    }

    const list = Array.isArray(ids) ? ids : (id ? [id] : []);
    const cleanIds = list
      .map((value) => (Number.isFinite(Number(value)) ? Number(value) : value))
      .filter((value) => value !== null && value !== undefined && value !== '');

    if (!cleanIds.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
    }

    const { error } = await supabase.from('candidates').delete().in('id', cleanIds);
    if (error) throw error;

    await Promise.all(
      cleanIds.map((candidateId) =>
        recordAudit({
          actor: user,
          action: 'candidate.delete',
          targetType: 'candidate',
          targetId: candidateId,
          meta: {},
        })
      )
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true, deleted: cleanIds.length }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
