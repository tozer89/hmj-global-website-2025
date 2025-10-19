// admin-candidate-save.js  — insert / update
const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

exports.handler = async (event) => {
  try {
    const user = requireAdmin(event);
    const body = parseBody(event) || {};

    const payload = {
      full_name: body.full_name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      nin: body.nin ?? null,
      bank_name: body.bank_name ?? null,
      bank_sort: body.bank_sort ?? null,
      bank_acct: body.bank_acct ?? null,
      rtw_ok: !!body.rtw_ok,
      role_applied: body.role_applied ?? null,
      start_date: body.start_date ?? null,
      end_date: body.end_date ?? null,
      client_name: body.client_name ?? null,
      terms_ok: !!body.terms_ok,
      contract_url: body.contract_url ?? null,
      status: body.status ?? 'active',
      emergency_name: body.emergency_name ?? null,
      emergency_phone: body.emergency_phone ?? null,
      notes: body.notes ?? null,
      updated_by: user.email
    };

    // INSERT or UPDATE
    if (body.id) {
      const { data, error } = await supa().from('candidates').update(payload).eq('id', body.id).select().single();
      if (error) throw error;
      return ok(data);
    } else {
      const { data, error } = await supa().from('candidates').insert(payload).select().single();
      if (error) throw error;
      return ok(data, 201);
    }
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
