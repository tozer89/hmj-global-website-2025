// netlify/functions/admin-candidates-get.js
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    const { supabase } = await getContext(event, context, { requireAdmin: true });

    const { id } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    // Select explicit columns you expect. Unknown columns in select() cause errors,
    // so if you’re unsure, either add the columns to your table or remove them here.
    const SELECT = [
      'id',
      'ref',
      'first_name',
      'last_name',
      'full_name',
      'email',
      'phone',
      'status',
      'job_title',
      'client_name',
      'pay_type',
      'payroll_ref',
      'internal_ref',
      'address1',
      'address2',
      'town',
      'county',
      'postcode',
      'country',
      'bank_name',
      'bank_sort',
      'bank_sort_code',
      'bank_account',
      'bank_iban',
      'bank_swift',
      'emergency_name',
      'emergency_phone',
      'rtw_url',
      'contract_url',
      'terms_ok',
      'role',
      'start_date',
      'end_date',
      'timesheet_status',
      'tax_id',
      'notes',
      'created_at',
      'updated_at',
    ].join(',');

    const { data, error } = await supabase
      .from('candidates')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Candidate not found');

    const full = data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim();
    const payload = { ...data, full_name: full || data.full_name || null };

    return { statusCode: 200, body: JSON.stringify(payload) };
  } catch (e) {
    const status = e.code === 401 ? 401 : (e.code === 403 ? 403 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
