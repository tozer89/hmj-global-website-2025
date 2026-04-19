'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClientReadyDocx,
  buildFallbackProfile,
  buildOutputFileName,
  callOpenAiFormatter,
  sanitiseStructuredProfile,
} = require('../lib/cv-formatter-core.js');

async function withPatchedEnv(patch, fn) {
  const previous = {};
  Object.keys(patch).forEach((key) => {
    previous[key] = process.env[key];
    if (patch[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = patch[key];
    }
  });
  try {
    return await fn();
  } finally {
    Object.keys(patch).forEach((key) => {
      if (previous[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

test('sanitiseStructuredProfile redacts direct identifiers', () => {
  const profile = sanitiseStructuredProfile({
    target_role: 'Senior Design & Project Manager',
    sanitized_location: 'Hull HU13 9AZ',
    interview_availability: 'Call George Syngros on +44 7800 123456',
    languages: ['English', 'Greek'],
    profile: 'George Syngros can be reached at george@example.com and lives in Hull HU13 9AZ.',
    role_alignment: ['George Syngros has strong stakeholder skills.'],
    relevant_projects: ['Mission critical project delivery in live environments.'],
    key_skills: ['Leadership', 'CSA / MEP coordination'],
    qualifications: ['MSc Energy Technology'],
    accreditations: ['Certified Building Surveyor'],
    employment_history: [
      {
        dates: '2023 - Present',
        title: 'Senior Design & Project Manager',
        company: 'Union Properties',
        summary: 'George Syngros managed live project delivery and can be contacted on george@example.com.',
        bullets: ['Hull HU13 9AZ', '+44 7800 123456'],
      },
    ],
    additional_information: ['LinkedIn: https://linkedin.com/in/georgesyngros'],
    redactions_applied: ['Name removed'],
    warnings: [],
  }, {
    candidateName: 'George Syngros',
    candidateReference: 'HMJ-ABCD1234',
  });

  const serialised = JSON.stringify(profile);
  assert.equal(profile.candidateReference, 'HMJ-ABCD1234');
  assert.doesNotMatch(serialised, /George Syngros/i);
  assert.doesNotMatch(serialised, /george@example\.com/i);
  assert.doesNotMatch(serialised, /\+44 7800 123456/i);
  assert.doesNotMatch(serialised, /HU13 9AZ/i);
});

test('buildFallbackProfile derives recruiter-friendly sections', () => {
  const sourceText = [
    'Harry Watts',
    '',
    'Position',
    'Electrician',
    '',
    'Location',
    'Hull HU13 9AZ',
    '',
    'Profile',
    'I have 6+ years of experience within all types of electrical settings, domestic, commercial and industrial.',
    '',
    'Key Skills',
    'Health and Safety (ECS) (SMSTS)',
    'Fault finding/Testing',
    'Three-phase installation',
    '',
    'Qualifications',
    'NVQ level 3 Advanced apprenticeship in electrical installation and commissioning.',
    'BS7671 18th edition wiring regulations.',
    '',
    'Employment History',
    '2019 - 2025',
    'Electrician',
    'Beech Electrical',
    'Worked across domestic, industrial and hospital projects.',
  ].join('\n');

  const profile = buildFallbackProfile({
    candidateText: sourceText,
    jobSpecText: 'Senior Electrician required for a mission-critical data centre project.',
    candidateFileName: 'Harry Watts.docx',
  });

  assert.equal(profile.targetRole, 'Senior Electrician required for a mission-critical data centre project.');
  assert.equal(profile.location, 'Hull');
  assert.match(profile.candidateReference, /^HMJ-/);
  assert.ok(profile.profile.length > 40);
  assert.ok(profile.keySkills.length >= 2);
  assert.ok(profile.qualifications.length >= 1);
});

test('buildClientReadyDocx returns a docx buffer', async () => {
  const buffer = await buildClientReadyDocx({
    candidateReference: 'HMJ-TEST1234',
    targetRole: 'Senior Project Manager',
    location: 'Manchester',
    interviewAvailability: 'Available with notice',
    languages: ['English'],
    profile: 'Client-ready summary paragraph for a senior project manager with relevant mission-critical delivery experience.',
    roleAlignment: ['Aligned to mission-critical delivery requirements.'],
    relevantProjects: ['Data centre retrofit delivery', 'Brownfield fit-out leadership'],
    keySkills: ['Stakeholder management', 'CSA and MEP coordination'],
    qualifications: ['MSc in Energy Technology'],
    accreditations: ['Certified Building Surveyor'],
    employmentHistory: [
      {
        dates: '2023 - Present',
        title: 'Senior Project Manager',
        company: 'Example Projects Ltd',
        summary: 'Leads end-to-end project delivery for brownfield retrofit and fit-out works.',
        bullets: ['Managed live operational environments'],
      },
    ],
    additionalInformation: ['Full UK driving licence'],
    redactionsApplied: ['Direct contact details removed'],
    warnings: [],
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000);
});

test('buildClientReadyDocx supports option-driven layouts', async () => {
  const buffer = await buildClientReadyDocx({
    candidateReference: 'HMJ-TEST1234',
    targetRole: 'Operations Director',
    location: 'London',
    interviewAvailability: 'Immediate',
    languages: ['English'],
    profile: 'Executive-level summary paragraph for a candidate with leadership and mission-critical delivery experience.',
    roleAlignment: ['Matches senior stakeholder and delivery requirements.'],
    relevantProjects: ['Multi-site mission-critical programme leadership'],
    keySkills: ['Leadership', 'Commercial delivery'],
    qualifications: ['BSc Construction Management'],
    accreditations: ['SMSTS'],
    employmentHistory: [],
    additionalInformation: ['Full UK driving licence'],
    redactionsApplied: ['Name removed'],
    warnings: ['No job spec uploaded.'],
  }, {
    templatePreset: 'executive_summary',
    coverPageMode: 'skip',
    includeWarnings: false,
    includeFormattingNotes: false,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 800);
});

test('buildOutputFileName supports the configured naming modes', () => {
  const profile = {
    targetRole: 'Senior Electrical Project Manager',
    candidateReference: 'HMJ-TEST1234',
  };

  assert.equal(
    buildOutputFileName(profile, { outputNameMode: 'reference_only' }, 'Harry Watts.docx'),
    'HMJ-TEST1234 Client CV.docx'
  );
  assert.equal(
    buildOutputFileName(profile, { outputNameMode: 'source_reference' }, 'Harry Watts.docx'),
    'Harry Watts - HMJ-TEST1234.docx'
  );
});

test('callOpenAiFormatter retries on transient errors and succeeds on a backup model', async () => {
  const calls = [];

  const result = await withPatchedEnv({
    OPENAI_API_KEY: 'test-key',
    OPENAI_CV_FORMAT_MODEL: 'primary-model',
    OPENAI_CV_FORMAT_FALLBACK_MODELS: 'backup-model-1, backup-model-2',
  }, async () => callOpenAiFormatter({
    candidateFileName: 'Candidate CV.docx',
    candidateText: 'Experienced electrical project manager with mission-critical delivery background.',
    jobSpecText: 'Electrical Project Manager required for data centre delivery.',
    candidateReference: 'HMJ-TEST1234',
    requestFetch: async (_url, request) => {
      const body = JSON.parse(String(request.body || '{}'));
      calls.push(body.model);
      if (calls.length === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({
            error: { message: 'rate limit reached' },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output_text: JSON.stringify({
            target_role: 'Electrical Project Manager',
            profile: 'Structured summary from backup model.',
            key_skills: ['Electrical project delivery', 'Mission-critical coordination'],
          }),
        }),
      };
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.model, 'backup-model-1');
  assert.deepEqual(calls, ['primary-model', 'backup-model-1']);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[1].ok, true);
});

test('callOpenAiFormatter stops retrying when the API rejects the key', async () => {
  const calls = [];

  const result = await withPatchedEnv({
    OPENAI_API_KEY: 'test-key',
    OPENAI_CV_FORMAT_MODEL: 'primary-model',
    OPENAI_CV_FORMAT_FALLBACK_MODELS: 'backup-model-1, backup-model-2',
  }, async () => callOpenAiFormatter({
    candidateFileName: 'Candidate CV.docx',
    candidateText: 'Experienced electrical project manager with mission-critical delivery background.',
    jobSpecText: 'Electrical Project Manager required for data centre delivery.',
    candidateReference: 'HMJ-TEST1234',
    requestFetch: async (_url, request) => {
      const body = JSON.parse(String(request.body || '{}'));
      calls.push(body.model);
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({
          error: { message: 'Incorrect API key provided' },
        }),
      };
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.match(result.error, /authentication failed/i);
});
