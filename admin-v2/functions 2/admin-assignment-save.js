// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;



// admin-assignment-save.js
import { sb, ok, bad, pre, bodyOf } from './_lib.js';

export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const payload = bodyOf(event);

  // basic normalization
  ['days_per_week','hours_per_day','rate_pay','rate_charge'].forEach(k=>{
    if (payload[k] === '' || payload[k] == null) payload[k] = null;
    else payload[k] = Number(payload[k]);
  });

  try {
    const supa = sb();
    const { data, error } = await supa
      .from('assignments')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    // optional: write to audit trail
    await supa.from('audit').insert({
      entity: 'assignment',
      entity_id: data.id,
      action: payload.id ? 'update' : 'create'
    });

    return ok(data);
  } catch (e) { return bad(e.message); }
}
