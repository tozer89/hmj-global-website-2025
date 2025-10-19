import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const payload = parseBody(event);
    const { id, ...fields } = payload;

    // compute convenience totals on server too
    const total = (['h_mon','h_tue','h_wed','h_thu','h_fri','h_sat','h_sun']
      .map(k=>Number(fields[k]||0)).reduce((a,b)=>a+b,0)) + Number(fields.ot_hours||0);
    if (fields.rate_pay != null) fields.pay_amount = Number(fields.rate_pay) * total;
    if (fields.rate_charge != null) fields.charge_amount = Number(fields.rate_charge) * total;
    if (fields.pay_amount != null && fields.charge_amount != null) fields.gp_amount = fields.charge_amount - fields.pay_amount;

    const db = supa();
    const q = id ? db.from('timesheets').update(fields).eq('id', id).select().single()
                 : db.from('timesheets').insert([fields]).select().single();
    const { data, error } = await q;
    if(error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
