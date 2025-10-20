// admin-candidate-delete.js
const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { ids } = parseBody(event) || {};
    const list = Array.isArray(ids) ? ids : (ids ? [ids] : []);
    if (!list.length) { const e = new Error('ids[] required'); e.status = 400; throw e; }

    const { error } = await supa().from('candidates').delete().in('id', list);
    if (error) throw error;

    return ok({ ok: true, deleted: list.length });
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
