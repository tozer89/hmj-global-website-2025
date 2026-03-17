'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  normaliseCandidateDocument,
  presentCandidateDocument,
  withDocumentVerificationMeta,
} = require('./_candidate-docs.js');
const { recordCandidateActivity, trimString } = require('./_candidate-portal.js');

function verificationActionMeta(action, notes, reviewerEmail, reviewedAt) {
  if (action === 'verify') {
    return {
      verification_status: 'verified',
      verified_at: reviewedAt,
      verified_by: reviewerEmail || null,
      reviewed_at: reviewedAt,
      reviewed_by: reviewerEmail || null,
      verification_notes: notes || null,
    };
  }
  if (action === 'reject') {
    return {
      verification_status: 'rejected',
      reviewed_at: reviewedAt,
      reviewed_by: reviewerEmail || null,
      verification_notes: notes || null,
      verified_at: null,
      verified_by: null,
    };
  }
  return {
    verification_status: 'pending',
    reviewed_at: reviewedAt,
    reviewed_by: reviewerEmail || null,
    verification_notes: notes || null,
    verified_at: null,
    verified_by: null,
  };
}

const baseHandler = async (event, context) => {
  const { supabase, user } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');

  const body = JSON.parse(event.body || '{}');
  const documentId = trimString(body.documentId || body.id, 120);
  const action = trimString(body.action, 40).toLowerCase();
  const notes = trimString(body.notes, 2000) || null;

  if (!documentId) throw coded(400, 'Document id required.');
  if (!['verify', 'reject', 'reset'].includes(action)) throw coded(400, 'Unknown document verification action.');

  const { data: record, error } = await supabase
    .from('candidate_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw coded(404, 'Candidate document not found.');

  const normalized = normaliseCandidateDocument(record);
  if (!normalized.verification_required) {
    throw coded(400, 'This document type does not require HMJ verification.');
  }

  const reviewedAt = new Date().toISOString();
  const nextMeta = withDocumentVerificationMeta(
    normalized.document_type,
    record.meta,
    verificationActionMeta(action, notes, user?.email || null, reviewedAt),
  );

  const { data: updated, error: updateError } = await supabase
    .from('candidate_documents')
    .update({
      meta: nextMeta,
      updated_at: reviewedAt,
    })
    .eq('id', documentId)
    .select('*')
    .single();
  if (updateError) throw updateError;

  await recordCandidateActivity(
    supabase,
    String(updated.candidate_id),
    action === 'verify'
      ? 'candidate_document_verified'
      : action === 'reject'
      ? 'candidate_document_rejected'
      : 'candidate_document_verification_reset',
    action === 'verify'
      ? `${normalized.label || 'Document'} marked as verified by HMJ.`
      : action === 'reject'
      ? `${normalized.label || 'Document'} marked for re-upload by HMJ.`
      : `${normalized.label || 'Document'} verification reset to pending.`,
    {
      actorRole: 'admin',
      actorIdentifier: user?.email || null,
      meta: {
        document_id: documentId,
        document_type: normalized.document_type,
        verification_status: nextMeta.verification_status || null,
        verification_notes: notes,
      },
      now: reviewedAt,
    },
  ).catch(() => null);

  const document = await presentCandidateDocument(supabase, updated);
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      action,
      document,
      message: action === 'verify'
        ? 'Document verified.'
        : action === 'reject'
        ? 'Document marked for re-upload.'
        : 'Document verification reset to pending.',
    }),
  };
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
