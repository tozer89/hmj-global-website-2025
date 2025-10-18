// netlify/functions/admin-candidates-save.js
const { getContext, coded } = require('./_auth.js');

function resp(status, json) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(json),
  };
}

exports.handler = async (event, context) => {
  try {
    // IMPORTANT: pass BOTH (event, context)
    const debugFlag = (() => {
      try { return JSON.parse(event.body || '{}').debug === true; } catch { return false; }
    })();

    const { user, roles, supabase } = await getContext(event, context, {
      requireAdmin: true,
    });

    if (debugFlag) {
      console.log('[save] who:', { email: user?.email, roles });
    }

    if (event.httpMethod !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const payload = JSON.parse(event.body || '{}');

    // Normalize/trim inputs (mirror fields you show in candidates.html)
    const row = {
      id: payload.id ?? undefined,
      first_name: (payload.first_name || '').trim() || null,
      last_name: (payload.last_name || '').trim() || null,
      email: (payload.email || '').trim() || null,
      phone: (payload.phone || '').trim() || null,
      job_title: (payload.job_title || '').trim() || null,
      pay_type: (payload.pay_type || '').trim() || null,
      status: (payload.status || '').trim() || null,
      payroll_ref: (payload.payroll_ref || '').trim() || null,
      address: (payload.address || '').trim() || null,
      bank_sort_code: (payload.bank_sort_code || '').trim() || null,
      bank_account: (payload.bank_account || '').trim() || null,
      bank_iban: (payload.bank_iban || '').trim() || null,
      bank_swift: (payload.bank_swift || '').trim() || null,
      notes: payload.notes || null,
      updated_at: new Date().toISOString(),
    };

    // Basic validation like before
    if (!row.first_name || !row.last_name) {
      throw coded(400, 'First/Last name required');
    }

    // Upsert (admin service client bypasses RLS via service_role)
    const { data, error } = await supabase
      .from('candidates')
      .upsert(row, { onConflict: 'id', ignoreDuplicates: false })
      .select('*')
      .limit(1);

    if (error) {
      console.error('[save] supabase error:', error);
      throw coded(500, error.message || 'Database error');
    }

    const saved = Array.isArray(data) ? data[0] : data;

    // Audit (best-effort)
    try {
      await supabase.from('candidate_audit').insert({
        candidate_id: saved.id,
        actor_email: user?.email || null,
        action: row.id ? 'update' : 'create',
        before_data: null,
        after_data: row,
      });
    } catch (e) {
      console.warn('[save] audit insert failed (non-fatal):', e?.message || e);
    }

    if (debugFlag) {
      console.log('[save] ok ->', { id: saved.id });
    }

    return resp(200, { ok: true, id: saved.id });
  } catch (e) {
    const status = e.code && Number.isInteger(e.code) ? e.code : 401;
    if (status >= 500) console.error('[save] fatal:', e);
    return resp(status, { error: e.message || 'Unauthorized' });
  }
};
