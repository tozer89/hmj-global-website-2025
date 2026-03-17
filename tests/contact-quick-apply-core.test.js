const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQuickApplyRecruiterMessage,
  buildQuickApplySnapshot,
  mapAvailabilityToNotice,
  mapRelocation,
  mapRightToWork,
} = require('../js/contact-quick-apply-core.js');

test('buildQuickApplySnapshot maps saved candidate data into quick-apply form values', () => {
  const snapshot = buildQuickApplySnapshot({
    candidate: {
      id: 'cand-123',
      auth_user_id: 'auth-123',
      first_name: 'Joseph',
      last_name: 'Tozer',
      email: 'tozer89@gmail.com',
      phone: '07885785499',
      location: 'United Kingdom',
      availability: 'Immediate',
      right_to_work_status: 'Full right to work already in place',
      relocation_preference: 'Maybe',
      salary_expectation: '80000 per year',
      linkedin_url: 'https://linkedin.com/in/josephtozer',
      summary: 'Senior planner profile',
    },
    documents: [
      { document_type: 'cv', label: 'Joseph Tozer CV.pdf' },
      { document_type: 'right_to_work', label: 'Passport.pdf' },
    ],
    applications: [],
    context: {
      title: 'Senior Planner',
      jobId: 'planner-role',
      locationText: 'Macclesfield, UK',
      employmentType: 'permanent',
      payText: '£80,000 - £105,000',
      reference: 'REF-123',
      shareCode: 'planner-macclesfield',
    },
  });

  assert.equal(snapshot.candidateId, 'cand-123');
  assert.equal(snapshot.jobId, 'planner-role');
  assert.equal(snapshot.hasStoredCv, true);
  assert.equal(snapshot.documentCount, 2);
  assert.equal(snapshot.formValues.first_name, 'Joseph');
  assert.equal(snapshot.formValues.surname, 'Tozer');
  assert.equal(snapshot.formValues.current_location, 'United Kingdom');
  assert.equal(snapshot.formValues.email, 'tozer89@gmail.com');
  assert.equal(snapshot.formValues.phone, '07885785499');
  assert.equal(snapshot.formValues.salary_expectation, '80000');
  assert.equal(snapshot.formValues.notice_period, 'Immediate');
  assert.equal(snapshot.formValues.right_to_work, 'Yes – no sponsorship needed');
  assert.equal(snapshot.formValues.relocation, 'Maybe');
});

test('buildQuickApplySnapshot detects an existing application for the same job', () => {
  const snapshot = buildQuickApplySnapshot({
    candidate: {
      id: 'cand-123',
      email: 'candidate@example.com',
    },
    applications: [
      { id: 'app-1', job_id: 'planner-role', applied_at: '2026-03-17T12:00:00Z' },
    ],
    context: {
      title: 'Senior Planner',
      jobId: 'planner-role',
    },
  });

  assert.equal(snapshot.existingApplication.id, 'app-1');
});

test('buildQuickApplyRecruiterMessage summarises saved profile and stored documents', () => {
  const message = buildQuickApplyRecruiterMessage({
    candidateId: 'cand-123',
    name: 'Joseph Tozer',
    email: 'tozer89@gmail.com',
    phone: '07885785499',
    location: 'United Kingdom',
    availability: 'Immediate',
    rightToWorkStatus: 'Full right to work already in place',
    relocationPreference: 'Maybe',
    salaryExpectation: '80000 per year',
    roleTitle: 'Senior Planner',
    reference: 'REF-123',
    documentSummary: '2 stored documents including a CV',
    documentLabels: ['Joseph Tozer CV.pdf', 'Passport.pdf'],
  });

  assert.match(message, /Quick apply submitted from an authenticated HMJ candidate account\./);
  assert.match(message, /Role: Senior Planner/);
  assert.match(message, /Candidate ID: cand-123/);
  assert.match(message, /Documents on file: 2 stored documents including a CV/);
  assert.match(message, /Stored documents: Joseph Tozer CV\.pdf, Passport\.pdf/);
});

test('quick-apply normalisers preserve current public form option values', () => {
  assert.equal(mapAvailabilityToNotice('2 weeks notice'), '2 weeks');
  assert.equal(mapRightToWork('Require sponsorship'), 'No – require sponsorship');
  assert.equal(mapRelocation('Open to discuss / maybe'), 'Maybe');
});
