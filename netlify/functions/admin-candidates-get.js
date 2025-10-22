// netlify/functions/admin-candidates-get.js
const { getContext } = require('./_auth.js');
const { loadStaticCandidates, toCandidate } = require('./_candidates-helpers.js');

exports.handler = async (event, context) => {
  try {
    const { supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });

    const { id } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const shouldFallback = (err) => {
      if (!err) return false;
      const msg = String(err.message || err);
      if (/column .+ does not exist/i.test(msg)) return true;
      if (/relation .+ does not exist/i.test(msg)) return true;
      if (/permission denied/i.test(msg)) return true;
      if (/violates row-level security/i.test(msg)) return true;
      return false;
    };

    if (!supabase || typeof supabase.from !== 'function') {
      const fallback = loadStaticCandidates().map(toCandidate);
      const match = fallback.find((row) => String(row.id) === String(id));
      if (!match) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Candidate not found', readOnly: true }) };
      }
      const payload = { ...match, full_name: match.full_name || `${match.first_name || ''} ${match.last_name || ''}`.trim() };
      return {
        statusCode: 200,
        body: JSON.stringify({ ...payload, readOnly: true, source: 'static', warning: supabaseError?.message || null }),
      };
    }

    const { data, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (!shouldFallback(error)) {
        console.warn('[candidates] get unexpected error — forcing static fallback', error.message || error);
      }
      const fallback = loadStaticCandidates().map(toCandidate);
      const match = fallback.find((row) => String(row.id) === String(id));
      if (!match) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Candidate not found', readOnly: true }) };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ ...match, readOnly: true, source: 'static', warning: error.message }),
      };
    }
    if (!data) throw new Error('Candidate not found');

    const full = data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim();
    const payload = { ...toCandidate(data), full_name: full || data.full_name || null, source: 'supabase' };

    return { statusCode: 200, body: JSON.stringify(payload) };
  } catch (e) {
    const status = e.code === 401 ? 401 : (e.code === 403 ? 403 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
