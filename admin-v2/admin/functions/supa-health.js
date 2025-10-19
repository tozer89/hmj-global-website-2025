// supa-health.js — check DB connectivity
const { supa, ok, err } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

exports.handler = async (event) => {
  try {
    requireAdmin(event);                 // protect the endpoint
    const { data, error } = await supa().from('candidates').select('id').limit(1);
    if (error) throw error;
    return ok({ ok: true, sample: data });
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
