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
      'first_name',
      'last_name',
      'email',
      'phone',
      'job_title',
      'pay_type',
      'status',
      'payroll_ref',
      'address',
      // bank fields (comment out any that don’t exist yet)
      'bank_sort_code',
      'bank_account',
      'bank_iban',
      'bank_swift',
      'notes',
      'created_at',
      'updated_at',
    ].join(',');

    const { data, error } = await supabase
      .from('candidates')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle(); // returns null if none, not an error

    if (error) throw error;
    if (!data) throw new Error('Candidate not found');

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : (e.code === 403 ? 403 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
