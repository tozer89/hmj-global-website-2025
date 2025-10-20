// netlify/functions/whoami.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const idUser = context?.clientContext?.user || null;
  const email = idUser?.email || null;

  let contractor = null, assignmentCount = 0, errMsg = null;
  try {
    if (email) {
      const { data: c } = await sb
        .from('contractors')
        .select('id,name,email')
        .eq('email', email)
        .limit(1)
        .maybeSingle();
      contractor = c || null;

      if (contractor?.id) {
        const { data: a } = await sb
          .from('assignments')
          .select('id', { count: 'exact', head: true })
          .eq('contractor_id', contractor.id);
        assignmentCount = a || 0; // head:true returns count in headers; in some versions a is null
      }
    }
  } catch (e) {
    errMsg = e.message || String(e);
  }

  // also echo the first chunk of URL so you can confirm the project id
  const projectHint = supabaseUrl?.replace('https://','').split('.')[0];

  return {
    statusCode: 200,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body: JSON.stringify({
      supabaseUrl,
      projectHint,      // e.g. "uyedmszlnoctmysmydtn"
      identityEmail: email,
      contractor,
      assignmentCount,
      err: errMsg
    })
  };
};
