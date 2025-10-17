// netlify/functions/supa-health.js
const url = (process.env.SUPABASE_URL || '').trim().replace(/[)\s]+$/g, ''); // strip stray ")" and spaces
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();

exports.handler = async () => {
  try {
    if (!url) throw new Error('SUPABASE_URL is empty');
    if (!key) throw new Error('SUPABASE_SERVICE_KEY is empty');

    // hit a very cheap health endpoint
    const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    const txt = await r.text();

    return {
      statusCode: 200,
      body: JSON.stringify({
        url,
        keyStartsWith: key.slice(0, 8),
        status: r.status,
        body: txt
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message) }) };
  }
};
