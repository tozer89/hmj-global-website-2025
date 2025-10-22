// netlify/functions/admin-candidates-get.js
const { getContext } = require('./_auth.js');
const { loadStaticCandidates, toCandidate } = require('./_candidates-helpers.js');

exports.handler = async (event, context) => {
  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }
  const id = payload.id || event.queryStringParameters?.id || null;

  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
  }

  const serveStatic = (reason, auth = null) => {
    const fallback = loadStaticCandidates().map(toCandidate);
    const match = fallback.find((row) => String(row.id) === String(id));
    if (!match) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Candidate not found', readOnly: true, source: 'static', auth }) };
    }
    const payload = { ...match, full_name: match.full_name || `${match.first_name || ''} ${match.last_name || ''}`.trim() };
    return {
      statusCode: 200,
      body: JSON.stringify({ ...payload, readOnly: true, source: 'static', warning: reason || null, auth })
    };
  };

  let ctx;
  try {
    ctx = await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    console.warn('[candidates] get auth failed — serving static dataset', err?.message || err);
    return serveStatic(err?.message || 'auth_failed', { ok: false, status: err?.code || 403, error: err?.message || 'Unauthorized' });
  }

  const { supabase, supabaseError } = ctx;

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
      return serveStatic(supabaseError?.message || 'supabase_unavailable', { ok: false, error: supabaseError?.message || 'supabase_unavailable' });
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
      return serveStatic(error.message, { ok: false, error: error.message, status: 503 });
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
