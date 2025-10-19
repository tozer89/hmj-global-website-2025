// admin-candidates-lists.js — quick lists for dropdowns
const { supa, ok, err } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const s = supa();

    const [consultants, clients, candidates] = await Promise.all([
      s.from('consultants').select('name').order('name', { ascending: true }),
      s.from('clients').select('name').order('name', { ascending: true }),
      s.from('candidates').select('full_name').order('full_name', { ascending: true })
    ]);

    if (consultants.error) throw consultants.error;
    if (clients.error) throw clients.error;
    if (candidates.error) throw candidates.error;

    return ok({
      consultants: consultants.data?.map(r => r.name) || [],
      clients: clients.data?.map(r => r.name) || [],
      candidates: candidates.data?.map(r => r.full_name) || []
    });
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
