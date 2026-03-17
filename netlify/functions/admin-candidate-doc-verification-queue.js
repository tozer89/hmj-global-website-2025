'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { normaliseCandidateDocument } = require('./_candidate-docs.js');
const { trimString } = require('./_candidate-portal.js');

function candidateName(row = {}) {
  return trimString(
    row.full_name
      || [row.first_name, row.last_name].filter(Boolean).join(' ')
      || row.email,
    240,
  ) || 'Candidate';
}

const baseHandler = async (event, context) => {
  const { supabase } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');

  const { data: docs, error } = await supabase
    .from('candidate_documents')
    .select('id,candidate_id,document_type,label,filename,original_filename,uploaded_at,created_at,updated_at,meta,deleted_at')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const normalizedDocs = (Array.isArray(docs) ? docs : [])
    .map((row) => normaliseCandidateDocument(row))
    .filter((doc) => doc.candidate_id && doc.verification_required && doc.verification_status !== 'verified');

  const pendingDocs = normalizedDocs.filter((doc) => doc.verification_status !== 'rejected');
  const candidateIds = Array.from(new Set(pendingDocs.map((doc) => String(doc.candidate_id))));

  let candidates = [];
  if (candidateIds.length) {
    const { data: candidateRows, error: candidateError } = await supabase
      .from('candidates')
      .select('id,ref,payroll_ref,email,first_name,last_name,full_name,status,updated_at')
      .in('id', candidateIds);
    if (candidateError) throw candidateError;
    candidates = Array.isArray(candidateRows) ? candidateRows : [];
  }

  const candidatesById = new Map(candidates.map((row) => [String(row.id), row]));
  const queueByCandidate = new Map();

  pendingDocs.forEach((doc) => {
    const key = String(doc.candidate_id);
    const candidate = candidatesById.get(key);
    if (!candidate || String(candidate.status || '').toLowerCase() === 'archived') return;
    const bucket = queueByCandidate.get(key) || {
      candidate_id: key,
      ref: trimString(candidate.ref, 120) || trimString(candidate.payroll_ref, 120) || null,
      name: candidateName(candidate),
      email: trimString(candidate.email, 320) || null,
      status: trimString(candidate.status, 80) || 'active',
      updated_at: candidate.updated_at || null,
      documents: [],
    };
    bucket.documents.push({
      id: doc.id,
      label: doc.label || doc.original_filename || doc.filename || 'Document',
      document_type: doc.document_type,
      uploaded_at: doc.uploaded_at || doc.created_at || null,
      verification_status: doc.verification_status || 'pending',
    });
    queueByCandidate.set(key, bucket);
  });

  const queue = Array.from(queueByCandidate.values())
    .map((entry) => ({
      ...entry,
      count: entry.documents.length,
    }))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      count: pendingDocs.length,
      candidates: queue,
    }),
  };
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
