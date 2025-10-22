// netlify/functions/admin-candidate-terms-send.js
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const { user, supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
    const body = JSON.parse(event.body || '{}');

    const candidateId = body.candidateId || body.id;
    const candidateName = body.name || null;
    const candidateEmail = body.email || null;
    const termsUrl = body.termsUrl || null;
    const provider = body.provider || 'docusign';

    if (!candidateId && !candidateEmail) {
      throw coded(400, 'candidateId or email required');
    }

    const sentAt = new Date().toISOString();

    if (!supabase || typeof supabase.from !== 'function') {
      console.warn('[terms] supabase unavailable — returning graceful success');
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, sent_at: sentAt, warning: supabaseError?.message || 'supabase_unavailable' }),
      };
    }

    await supabase.from('admin_audit_logs').insert({
      actor_email: user?.email || null,
      actor_id: user?.sub || user?.id || null,
      action: 'candidate.terms_send',
      target_type: 'candidate',
      target_id: String(candidateId || candidateEmail),
      meta: {
        candidate: {
          id: candidateId || null,
          name: candidateName,
          email: candidateEmail,
        },
        termsUrl,
        provider,
        sent_at: sentAt,
      },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, sent_at: sentAt }) };
  } catch (err) {
    const status = err.code && Number.isFinite(Number(err.code)) ? Number(err.code) : err.statusCode || 500;
    return { statusCode: status, body: JSON.stringify({ error: err.message || 'Failed to log terms send' }) };
  }
};
