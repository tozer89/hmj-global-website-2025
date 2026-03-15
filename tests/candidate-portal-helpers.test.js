const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidateWritePayload,
  buildJobApplicationPayload,
  normaliseSkillList,
  splitName,
} = require('../netlify/functions/_candidate-portal.js');

test('splitName handles single-token and multi-token names cleanly', () => {
  assert.deepEqual(splitName('Ava Miles'), {
    firstName: 'Ava',
    lastName: 'Miles',
    fullName: 'Ava Miles',
  });

  assert.deepEqual(splitName('Madonna'), {
    firstName: 'Madonna',
    lastName: null,
    fullName: 'Madonna',
  });
});

test('normaliseSkillList trims, deduplicates and preserves order', () => {
  assert.deepEqual(
    normaliseSkillList([' IST ', 'BMS', 'ist', '', ' QA/QC ']),
    ['IST', 'BMS', 'QA/QC']
  );
});

test('buildCandidateWritePayload maps form fields into the candidate table shape', () => {
  const payload = buildCandidateWritePayload({
    first_name: 'Ava',
    surname: 'Miles',
    email: ' Ava.Miles@Example.com ',
    current_location: 'Frankfurt, Germany',
    discipline: 'Commissioning',
    notice_period: 'Immediate',
    linkedin: 'https://linkedin.com/in/ava-miles',
    message: 'Open to hyperscale rotations.',
    skills: 'IST, BMS, IST',
    role: 'Lead Commissioning Manager',
  }, {
    authUserId: 'user-1',
    now: '2026-03-15T09:00:00.000Z',
    includeNulls: false,
    isNew: true,
  });

  assert.deepEqual(payload, {
    auth_user_id: 'user-1',
    email: 'ava.miles@example.com',
    first_name: 'Ava',
    last_name: 'Miles',
    full_name: 'Ava Miles',
    location: 'Frankfurt, Germany',
    sector_focus: 'Commissioning',
    skills: ['IST', 'BMS'],
    availability: 'Immediate',
    linkedin_url: 'https://linkedin.com/in/ava-miles',
    summary: 'Open to hyperscale rotations.',
    headline_role: 'Lead Commissioning Manager',
    updated_at: '2026-03-15T09:00:00.000Z',
    created_at: '2026-03-15T09:00:00.000Z',
    status: 'active',
  });
});

test('buildJobApplicationPayload keeps the required tracking fields and role snapshot', () => {
  const payload = buildJobApplicationPayload({
    job_id: 'job-42',
    job_title: 'CSA Package Manager',
    job_location: 'Dublin, Ireland',
    job_type: 'contract',
    job_pay: '€650 per day',
    job_source: 'contact_form',
    message: 'Available next month.',
  }, 'candidate-7', {
    now: '2026-03-15T10:30:00.000Z',
  });

  assert.deepEqual(payload, {
    candidate_id: 'candidate-7',
    job_id: 'job-42',
    applied_at: '2026-03-15T10:30:00.000Z',
    status: 'submitted',
    notes: 'Available next month.',
    job_title: 'CSA Package Manager',
    job_location: 'Dublin, Ireland',
    job_type: 'contract',
    job_pay: '€650 per day',
    source: 'contact_form',
    source_submission_id: null,
    share_code: null,
  });
});
