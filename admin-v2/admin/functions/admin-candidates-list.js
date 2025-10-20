// admin-candidates-list.js — main grid list with filters
const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

exports.handler = async (event) => {
  try {
    requireAdmin(event);

    const { q = '', status = '', limit = 200, offset = 0 } = parseBody(event) || {};
    const s = supa();

    let qBuilder = s
      .from('candidates')
      .select('id, ref, first_name, last_name, email, phone, status, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.max(1, Math.min(1000, limit)) - 1);

    // status filter
    if (status && String(status).trim()) qBuilder = qBuilder.eq('status', status);

    // text search across several columns
    const term = String(q || '').trim();
    if (term) {
      const like = `%${term}%`;
      qBuilder = qBuilder.or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `email.ilike.${like}`,
          `ref.ilike.${like}`,
        ].join(',')
      );
    }

    const { data, error, count } = await qBuilder;
    if (error) throw error;

    // add full_name for the UI
    const rows = (data || []).map(r => ({
      ...r,
      full_name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
    }));

    return ok({ rows, count });
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
