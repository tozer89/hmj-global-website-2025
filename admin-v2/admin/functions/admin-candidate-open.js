// admin-candidate-open.js
const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { id } = parseBody(event);
    if (!id) { const e = new Error('id required'); e.status = 400; throw e; }

    const { data, error } = await supa().from('candidates').select('*').eq('id', id).single();
    if (error) throw error;

    return ok(data);
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
