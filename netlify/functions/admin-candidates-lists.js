const { supabase } = require('./_supabase.js');
const { getContext, honest } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });
    const { q } = JSON.parse(event.body||'{}');
    let query = supabase.from('contractors')
      .select('id,name,email,phone,payroll_ref, pay_type, address, bank_json, emergency_json, row_updated_at:updated_at')
      .order('name',{ascending:true});
    if (q && q.trim()) {
      query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return { statusCode: 200, body: JSON.stringify(data || []) };
  } catch(e){ return honest(e); }
};
