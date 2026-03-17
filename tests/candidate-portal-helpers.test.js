const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidateWritePayload,
  buildJobApplicationPayload,
  extractMissingColumnName,
  normaliseSkillList,
  recordCandidateActivity,
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
    primary_specialism: 'Commissioning',
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

test('buildCandidateWritePayload maps the richer registration fields into the candidate table shape', () => {
  const payload = buildCandidateWritePayload({
    first_name: 'Jamie',
    surname: 'Bennett',
    email: 'jamie@example.com',
    phone: '+44 7700 900123',
    address1: '1 Cable Street',
    town: 'London',
    postcode: 'E1 6QL',
    country: 'United Kingdom',
    current_location: 'London, United Kingdom',
    nationality: 'Irish',
    right_to_work_status: 'Full right to work already in place',
    right_to_work_regions: 'United Kingdom, European Union / EEA',
    discipline: 'Electrical (MEP)',
    secondary_specialism: 'Commissioning',
    current_job_title: 'Senior Electrical Supervisor',
    desired_roles: 'Lead Electrical Supervisor, MEP Supervisor',
    years_experience: '12',
    qualifications: 'SSSTS, AP, IOSH',
    sector_experience: 'Data centres, commercial fit-out',
    availability: 'Available in two weeks',
    relocation: 'Maybe',
    salary_expectation: '£420 per day',
    linkedin: 'https://linkedin.com/in/jamie-bennett',
    message: 'Open to London and Frankfurt rotations.',
    skills: 'AP, QA/QC, QA/QC, BMS',
  }, {
    authUserId: 'user-77',
    now: '2026-03-15T11:00:00.000Z',
    includeNulls: false,
    isNew: true,
  });

  assert.deepEqual(payload, {
    auth_user_id: 'user-77',
    email: 'jamie@example.com',
    first_name: 'Jamie',
    last_name: 'Bennett',
    full_name: 'Jamie Bennett',
    phone: '+44 7700 900123',
    address1: '1 Cable Street',
    town: 'London',
    postcode: 'E1 6QL',
    country: 'United Kingdom',
    location: 'London, United Kingdom',
    nationality: 'Irish',
    right_to_work_status: 'Full right to work already in place',
    right_to_work_regions: ['United Kingdom', 'European Union / EEA'],
    primary_specialism: 'Electrical (MEP)',
    secondary_specialism: 'Commissioning',
    current_job_title: 'Senior Electrical Supervisor',
    desired_roles: 'Lead Electrical Supervisor, MEP Supervisor',
    qualifications: 'SSSTS, AP, IOSH',
    sector_experience: 'Data centres, commercial fit-out',
    relocation_preference: 'Maybe',
    salary_expectation: '£420 per day',
    experience_years: 12,
    sector_focus: 'Data centres, commercial fit-out',
    skills: ['AP', 'QA/QC', 'BMS'],
    availability: 'Available in two weeks',
    linkedin_url: 'https://linkedin.com/in/jamie-bennett',
    summary: 'Open to London and Frankfurt rotations.',
    headline_role: 'Lead Electrical Supervisor, MEP Supervisor',
    updated_at: '2026-03-15T11:00:00.000Z',
    created_at: '2026-03-15T11:00:00.000Z',
    status: 'active',
  });
});

test('buildCandidateWritePayload formats annual salary expectations and stores the selected unit', () => {
  const payload = buildCandidateWritePayload({
    first_name: 'Sam',
    surname: 'Walker',
    email: 'sam@example.com',
    salary_expectation: '75000',
    salary_expectation_unit: 'annual',
  }, {
    authUserId: 'user-88',
    now: '2026-03-16T09:30:00.000Z',
    includeNulls: false,
    isNew: true,
  });

  assert.equal(payload.salary_expectation, '75,000 per year');
  assert.equal(payload.salary_expectation_unit, 'annual');
});

test('extractMissingColumnName supports Postgres and Supabase schema cache errors', () => {
  assert.equal(
    extractMissingColumnName({ message: 'column "full_name" does not exist' }),
    'full_name'
  );

  assert.equal(
    extractMissingColumnName({ message: 'column candidates.pay_type does not exist' }),
    'pay_type'
  );

  assert.equal(
    extractMissingColumnName({ message: "Could not find the 'last_portal_login_at' column of 'candidates' in the schema cache" }),
    'last_portal_login_at'
  );
});

test('recordCandidateActivity falls back to the legacy activity schema when newer audit columns are missing', async () => {
  let insertCall = 0;
  const insertedPayloads = [];

  function buildInsertResult(error, data) {
    return {
      select() {
        return {
          maybeSingle: async () => ({ data, error }),
        };
      },
    };
  }

  const supabase = {
    from(table) {
      assert.equal(table, 'candidate_activity');
      return {
        insert(payload) {
          insertCall += 1;
          insertedPayloads.push(payload);
          if (insertCall === 1) {
            return buildInsertResult(
              { message: "Could not find the 'actor_identifier' column of 'candidate_activity' in the schema cache" },
              null
            );
          }
          return buildInsertResult(null, { id: 'activity-1', ...payload });
        },
      };
    },
  };

  const result = await recordCandidateActivity(
    supabase,
    'candidate-1',
    'profile_updated',
    'Profile updated from the candidate dashboard.',
    {
      actorRole: 'candidate',
      actorIdentifier: 'user-1',
      meta: { source: 'candidate_dashboard' },
      now: '2026-03-15T20:20:00.000Z',
    }
  );

  assert.equal(insertCall, 2);
  assert.deepEqual(insertedPayloads[1], {
    candidate_id: 'candidate-1',
    activity_type: 'profile_updated',
    description: 'Profile updated from the candidate dashboard.',
    actor_role: 'candidate',
    meta: { source: 'candidate_dashboard' },
    created_at: '2026-03-15T20:20:00.000Z',
  });
  assert.equal(result.id, 'activity-1');
});
