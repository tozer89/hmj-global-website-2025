'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');
const {
  candidateDisplayName,
  isMissingColumnError,
  normaliseAssignmentSummary,
} = require('./_candidate-assignments.js');

function isMissingAssignmentsSchemaError(error) {
  const message = String(error?.message || '');
  return /Could not find the table 'public\.assignments' in the schema cache/i.test(message)
    || /relation "?assignments"? does not exist/i.test(message);
}

async function loadCandidate(supabase, candidateId) {
  const { data, error } = await supabase
    .from('candidates')
    .select('id,first_name,last_name,full_name,email,status,payroll_ref')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadAssignment(supabase, assignmentId) {
  const { data, error } = await supabase
    .from('assignments')
    .select('id,candidate_id,contractor_id,candidate_name,client_name,client_site,job_title,status,as_ref,start_date,end_date,currency,rate_pay,rate_std,active')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

const baseHandler = async (event, context) => {
  const { supabase, user } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');
  if (!supabase || typeof supabase.from !== 'function') throw coded(503, 'Supabase unavailable.');

  const body = JSON.parse(event.body || '{}');
  const action = String(body.action || 'link').trim().toLowerCase();
  const candidateId = String(body.candidateId || '').trim();
  const assignmentId = String(body.assignmentId || '').trim();

  if (!candidateId) throw coded(400, 'candidateId is required.');
  if (!assignmentId) throw coded(400, 'assignmentId is required.');

  let candidate;
  let assignment;
  try {
    [candidate, assignment] = await Promise.all([
      loadCandidate(supabase, candidateId),
      loadAssignment(supabase, assignmentId),
    ]);
  } catch (error) {
    if (isMissingAssignmentsSchemaError(error)) {
      throw coded(409, 'Assignment pairing requires the latest Supabase assignments table patch. Apply the candidate/assignment schema repair first.');
    }
    throw error;
  }

  if (!candidate) throw coded(404, 'Candidate not found.');
  if (!assignment) throw coded(404, 'Assignment not found.');
  if (!['link', 'unlink'].includes(action)) throw coded(400, 'Unsupported action.');

  const update = action === 'unlink'
    ? {
        candidate_id: null,
        candidate_name: assignment.candidate_id && String(assignment.candidate_id) === String(candidateId)
          ? null
          : assignment.candidate_name || null,
      }
    : {
        candidate_id: String(candidate.id),
        candidate_name: candidateDisplayName(candidate),
      };

  let updated;
  try {
    const { data, error } = await supabase
      .from('assignments')
      .update(update)
      .eq('id', assignmentId)
      .select('id,candidate_id,contractor_id,candidate_name,client_name,client_site,job_title,status,as_ref,start_date,end_date,currency,rate_pay,rate_std,active')
      .single();
    if (error) throw error;
    updated = data;
  } catch (error) {
    if (isMissingAssignmentsSchemaError(error)) {
      throw coded(409, 'Assignment pairing requires the latest Supabase assignments table patch. Apply the candidate/assignment schema repair first.');
    }
    if (isMissingColumnError(error, 'candidate_id')) {
      throw coded(409, 'Assignment pairing requires the latest Supabase assignments patch. Apply the candidate/assignment linking SQL first.');
    }
    throw error;
  }

  await recordAudit({
    actor: user,
    action: action === 'unlink' ? 'unlink_candidate' : 'link_candidate',
    targetType: 'assignment',
    targetId: assignmentId,
    meta: {
      candidate_id: action === 'unlink' ? null : String(candidate.id),
      candidate_name: action === 'unlink' ? null : candidateDisplayName(candidate),
    },
  });

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({
      ok: true,
      action,
      assignment: normaliseAssignmentSummary(updated),
      message: action === 'unlink'
        ? 'Candidate unlinked from assignment.'
        : 'Candidate linked to assignment.',
    }),
  };
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
