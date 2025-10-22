// netlify/functions/admin-candidates-save.js
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    // ✅ IMPORTANT: pass (event, context, { requireAdmin:true })
    const { user, roles, supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });

    if (event.httpMethod !== 'POST') throw coded(405, 'Method Not Allowed');

    if (!supabase || typeof supabase.from !== 'function') {
      const reason = supabaseError?.message || 'Supabase not configured for this deploy';
      throw coded(503, reason);
    }

    const body = JSON.parse(event.body || '{}');

    // Minimal validation to satisfy your schema (first_name & last_name NOT NULL)
    const rec = {
      id:            body.id ?? undefined,
      first_name:    (body.first_name || '').trim(),
      last_name:     (body.last_name  || '').trim(),
      email:         (body.email || null) || null,
      phone:         (body.phone || null) || null,
      job_title:     (body.job_title || null) || null,
      pay_type:      (body.pay_type || null) || null,
      status:        (body.status || null) || null,
      payroll_ref:   (body.payroll_ref || null) || null,
      address:       (body.address || null) || null,
      bank_sort_code:(body.bank_sort_code || null) || null,
      bank_account:  (body.bank_account || null) || null,
      bank_iban:     (body.bank_iban || null) || null,
      bank_swift:    (body.bank_swift || null) || null,
      notes:         (body.notes || null) || null,
      // updated_at: server default can handle this, but we can set explicit timestamp if you like
    };

    if (!rec.first_name || !rec.last_name) throw coded(400, 'First & last name are required');

    const t0 = Date.now();

    let result, error;
    if (rec.id) {
      ({ data: result, error } = await supabase
        .from('candidates')
        .update(rec)
        .eq('id', rec.id)
        .select('id')
        .maybeSingle());
    } else {
      ({ data: result, error } = await supabase
        .from('candidates')
        .insert(rec)
        .select('id')
        .single());
    }

    if (error) throw coded(500, error.message);

    // Optional: audit trail
    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email,
      actor_id: user.sub || user.id || null,
      action: rec.id ? 'candidate.update' : 'candidate.insert',
      target_type: 'candidate',
      target_id: String(result.id),
      meta: rec
    });

    const took_ms = Date.now() - t0;
    return { statusCode: 200, body: JSON.stringify({ id: result.id, ok: true, took_ms }) };
  } catch (e) {
    const status = e.code || 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Error', readOnly: status === 503 }) };
  }
};
