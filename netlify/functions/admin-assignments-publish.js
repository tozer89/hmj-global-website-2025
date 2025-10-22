// netlify/functions/admin-assignments-publish.js
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

function listMissing(source, fields) {
  const missing = [];
  for (const [key, label] of fields) {
    const value = source?.[key];
    if (value === undefined || value === null || value === '') {
      missing.push(label);
    }
  }
  return missing;
}

function normaliseCandidateName(candidate) {
  if (!candidate) return null;
  if (candidate.name) return candidate.name;
  const first = candidate.first_name || '';
  const last = candidate.last_name || '';
  const combo = `${first} ${last}`.trim();
  return combo || null;
}

exports.handler = async (event, context) => {
  try {
    const { supabase, user } = await getContext(event, context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing assignment id' }) };
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (assignmentError) throw assignmentError;
    if (!assignment) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Assignment not found' }) };
    }

    const requiredAssignment = [
      ['job_title', 'job title'],
      ['project_id', 'project'],
      ['start_date', 'start date'],
      ['contractor_id', 'candidate'],
    ];

    const assignmentMissing = listMissing(assignment, requiredAssignment);
    if (!assignment.rate_std && !assignment.rate_pay) {
      assignmentMissing.push('pay rate');
    }

    let candidateProfile = null;
    if (assignment.contractor_id) {
      const { data: contractor, error: contractorError } = await supabase
        .from('contractors')
        .select('id,name,email,phone,payroll_ref')
        .eq('id', assignment.contractor_id)
        .maybeSingle();
      if (contractorError) throw contractorError;
      candidateProfile = contractor || null;

      if (!candidateProfile) {
        const { data: candidateRow, error: candidateError } = await supabase
          .from('candidates')
          .select('id,first_name,last_name,email,phone,status')
          .eq('id', assignment.contractor_id)
          .maybeSingle();
        if (candidateError) throw candidateError;
        candidateProfile = candidateRow || null;
      }
    }

    const candidateMissing = [];
    if (!candidateProfile) {
      candidateMissing.push('candidate record');
    } else {
      if (!normaliseCandidateName(candidateProfile)) {
        candidateMissing.push('candidate name');
      }
      if (!candidateProfile.email) {
        candidateMissing.push('candidate email');
      }
    }

    if (assignmentMissing.length || candidateMissing.length) {
      const parts = [];
      if (assignmentMissing.length) {
        parts.push(`Assignment incomplete: ${assignmentMissing.join(', ')}`);
      }
      if (candidateMissing.length) {
        parts.push(`Candidate profile incomplete: ${candidateMissing.join(', ')}`);
      }
      return { statusCode: 400, body: JSON.stringify({ error: parts.join(' · ') }) };
    }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const baseRef = `LIVE-${now.getFullYear()}${month}`;
    const paddedId = String(id).padStart(4, '0');
    const candidatePart = assignment.contractor_id ? `-${assignment.contractor_id}` : '';
    const asRef = assignment.as_ref && /^LIVE-/i.test(assignment.as_ref)
      ? assignment.as_ref
      : `${baseRef}-${paddedId}${candidatePart}`;

    const candidateName = normaliseCandidateName(candidateProfile) || assignment.candidate_name || null;
    const updatePayload = {
      status: 'live',
      active: true,
      as_ref: asRef,
      candidate_name: candidateName,
      rate_pay: assignment.rate_pay || assignment.rate_std || null,
    };

    const { data: updated, error: updateError } = await supabase
      .from('assignments')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    await recordAudit({
      actor: user,
      action: 'publish',
      targetType: 'assignment',
      targetId: id,
      meta: { as_ref: asRef },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ...updated, candidate: candidateProfile || null }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Publish failed' }) };
  }
};

