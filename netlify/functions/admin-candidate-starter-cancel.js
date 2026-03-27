'use strict';

// netlify/functions/admin-candidate-starter-cancel.js
// Cancels a provisional new-starter profile: sets status to 'Cancelled',
// logs the event to candidate_activity, and records an admin audit entry.

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');
const { trimString } = require('./_mail-delivery.js');

function parseBody(event) {
  try { return JSON.parse(event?.body || '{}'); } catch { return {}; }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const baseHandler = async (event, context) => {
  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    throw coded(405, 'Method Not Allowed');
  }

  const { supabase, user } = await getContext(event, context, { requireAdmin: true });

  const body = parseBody(event);
  const candidateId = trimString(body.candidateId || body.candidate_id, 80);
  const reason = trimString(body.reason, 500) || 'Cancelled by admin.';

  if (!candidateId) {
    throw coded(400, 'candidateId is required.');
  }

  // Fetch the candidate to confirm it exists
  const { data: candidate, error: fetchErr } = await supabase
    .from('candidates')
    .select('id, first_name, last_name, email, status, onboarding_mode')
    .eq('id', candidateId)
    .single();

  if (fetchErr || !candidate) {
    throw coded(404, 'Candidate not found.');
  }

  // Update status to Cancelled
  const { error: updateErr } = await supabase
    .from('candidates')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', candidateId);

  if (updateErr) {
    console.error('[starter-cancel] update failed', updateErr.message);
    throw coded(500, 'Failed to update candidate status.');
  }

  // Log to candidate_activity so it shows in the CRM trail
  try {
    await supabase.from('candidate_activity').insert({
      candidate_id: candidateId,
      activity_type: 'starter_cancelled',
      description: `Starter cancelled by ${user?.email || 'admin'}: ${reason}`,
      actor_role: 'admin',
      created_at: new Date().toISOString(),
    });
  } catch (actErr) {
    console.warn('[starter-cancel] candidate_activity insert failed', actErr?.message);
  }

  // Admin audit trail
  await recordAudit({
    actor: user,
    action: 'cancel_starter',
    targetType: 'candidate',
    targetId: candidateId,
    meta: {
      candidate_email: candidate.email || null,
      candidate_name: [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || null,
      previous_status: candidate.status || null,
      reason,
    },
  });

  return response(200, {
    ok: true,
    candidateId,
    message: 'Starter cancelled successfully.',
  });
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
