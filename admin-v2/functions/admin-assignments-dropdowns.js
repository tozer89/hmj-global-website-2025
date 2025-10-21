// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;



// netlify/functions/admin-assignments-dropdowns.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });

    const [{ data: contractors }, { data: clients }, { data: projects }] = await Promise.all([
      supabase.from('contractors').select('id,name,email').order('name'),
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('projects').select('id,name,client_id').order('name')
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        contractors: contractors || [],
        clients: clients || [],
        projects: projects || []
      })
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
