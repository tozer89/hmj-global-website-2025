const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normaliseCandidateDocument,
  withDocumentVerificationMeta,
} = require('../netlify/functions/_candidate-docs.js');
const {
  missingRequestedDocuments,
  summariseOnboarding,
} = require('../netlify/functions/_candidate-onboarding.js');
const {
  buildTimesheetPortalContractorLookups,
  buildWebsiteCandidateLookups,
  matchTimesheetPortalContractorForCandidate,
  matchWebsiteCandidateForTimesheetPortalContractor,
  mergeTimesheetPortalCandidate,
} = require('../netlify/functions/_candidate-timesheet-sync.js');

test('verification-required candidate documents default to pending review from meta', () => {
  const presented = normaliseCandidateDocument({
    id: 'doc-1',
    candidate_id: 'cand-1',
    document_type: 'passport',
    label: 'Passport',
    meta: withDocumentVerificationMeta('passport', {}),
  });

  assert.equal(presented.document_type, 'passport');
  assert.equal(presented.verification_required, true);
  assert.equal(presented.verification_status, 'pending');
});

test('missingRequestedDocuments does not request RTW again when a candidate already uploaded evidence awaiting verification', () => {
  const candidate = {
    id: 'cand-1',
    right_to_work_status: '',
    rtw_url: '',
  };
  const documents = [{
    id: 'doc-1',
    candidate_id: 'cand-1',
    document_type: 'passport',
    label: 'Passport',
    meta: withDocumentVerificationMeta('passport', {}),
  }];

  const onboarding = summariseOnboarding({ candidate, documents, paymentDetails: null });
  const missing = missingRequestedDocuments(candidate, documents, ['right_to_work'], null);

  assert.equal(onboarding.hasRightToWork, false);
  assert.equal(onboarding.hasRightToWorkUpload, true);
  assert.equal(onboarding.hasRightToWorkPendingVerification, true);
  assert.deepEqual(missing, []);
});

test('Timesheet Portal candidate sync matches by email and carries TSP references into website candidates', () => {
  const contractor = {
    id: 'tsp-123',
    reference: '5580',
    email: 'tozer89@gmail.com',
    firstName: 'Joseph',
    lastName: 'Tozer',
    mobile: '07885785499',
    raw: { jobTitle: 'Planner', country: 'United Kingdom' },
  };
  const existingCandidate = {
    id: 'cand-1',
    ref: '',
    payroll_ref: '',
    email: 'tozer89@gmail.com',
    first_name: 'Joseph',
    last_name: 'Tozer',
    full_name: 'Joseph Tozer',
    status: 'active',
  };

  const contractorLookups = buildTimesheetPortalContractorLookups([contractor]);
  const websiteLookups = buildWebsiteCandidateLookups([existingCandidate]);

  const contractorMatch = matchTimesheetPortalContractorForCandidate(existingCandidate, contractorLookups);
  const candidateMatch = matchWebsiteCandidateForTimesheetPortalContractor(contractor, websiteLookups);
  const merged = mergeTimesheetPortalCandidate({
    contractor,
    existing: existingCandidate,
    now: '2026-03-17T12:00:00.000Z',
  });

  assert.equal(contractorMatch.matchedBy, 'email');
  assert.equal(candidateMatch.matchedBy, 'email');
  assert.equal(merged.id, 'cand-1');
  assert.equal(merged.ref, '5580');
  assert.equal(merged.payroll_ref, '5580');
  assert.equal(merged.email, 'tozer89@gmail.com');
  assert.equal(merged.current_job_title, 'Planner');
});
