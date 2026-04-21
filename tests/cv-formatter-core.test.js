'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const {
  buildClientReadyDocx,
  buildFallbackProfile,
  buildOutputFileName,
  callOpenAiCandidatePackVerifier,
  callOpenAiFormatter,
  guessCandidateName,
  sanitiseStructuredProfile,
  verifyPremiumCandidatePack,
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

async function readDocxEntries(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const textByName = {};
  await Promise.all(names.map(async (name) => {
    textByName[name] = await zip.files[name].async('string');
  }));
  return textByName;
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
  assert.equal(profile.candidateName, 'George Syngros');
  assert.doesNotMatch(serialised.replace('George Syngros', ''), /George Syngros/i);
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

  assert.equal(profile.targetRole, 'Senior Electrician');
  assert.equal(profile.location, 'Hull');
  assert.match(profile.candidateReference, /^HMJ-/);
  assert.ok(profile.profile.length > 40);
  assert.ok(profile.keySkills.length >= 2);
  assert.ok(profile.qualifications.length >= 1);
});

test('guessCandidateName prefers the CV text name over a generic exported filename', () => {
  const candidateName = guessCandidateName(
    'candidate-exported.pdf',
    'Jane Candidate\nElectrical Project Manager\nLondon\nHV commissioning and site delivery'
  );

  assert.equal(candidateName, 'Jane Candidate');
});

test('buildFallbackProfile redacts the candidate name from generic PDF filenames and avoids using the role title as project evidence', () => {
  const profile = buildFallbackProfile({
    candidateText: [
      'Jane Candidate',
      'Electrical Project Manager',
      'London',
      'HV commissioning and site delivery',
    ].join('\n'),
    jobSpecText: 'Electrical Project Manager - Mission Critical',
    candidateFileName: 'candidate-exported.pdf',
  });

  assert.equal(profile.location, 'London');
  assert.doesNotMatch(profile.profile, /Jane Candidate/i);
  assert.match(profile.profile, /Electrical Project Manager/i);
  assert.match(profile.profile, /HV commissioning and site delivery/i);
  assert.deepEqual(profile.relevantProjects, ['HV commissioning and site delivery']);
});

test('buildFallbackProfile resolves conflicting role evidence into one client-facing quantity surveying profile', () => {
  const sourceText = [
    'Position',
    'Electrical Mate / Electrical Improver (Pharmaceutical Construction Project)',
    'Candidate ID',
    'HMJ-39556E44',
    'Location',
    'Scope & Role',
    'Relevant Data Centre Projects / Experience',
    'Senior Quantity Surveyor - CSA / MEP (Data Centres)Irish passport | Eligible to work freely across EU & UK | Open to relocation/travel across Europe.',
    'Profile',
    'Electrical Mate / Electrical Improver (Pharmaceutical Construction Project) with Senior Quantity Surveyor - CSA / MEP (Data Centres) experience.',
    'Role Alignment',
    'Content emphasis has been tuned and all statements remain grounded in the source material.',
    'Key Skills',
    'Pre-construction & cost planning (MEP & CSA), Procurement & tendering, package strategy, bid analysis, negotiation',
    'Qualifications & Accreditations',
    'BSc (Hons) Quantity Surveying & Construction Economics - Ireland (2000)',
    'Employment History',
    'Senior Quantity Surveyor - Data Centre Projects | Apr 2023 - Nov 2023',
    'Commercial lead across Stockholm, Frankfurt and Amsterdam for global cloud providers.',
    'Senior Quantity Surveyor - Data Centre Projects | 2021 - 2023',
    'Led procurement, package management, change control, and final accounts for mission-critical projects.',
  ].join('\n');

  const profile = buildFallbackProfile({
    candidateText: sourceText,
    jobSpecText: '',
    candidateFileName: 'Doc1.docx',
  });

  assert.equal(profile.targetRole, 'Senior Quantity Surveyor');
  assert.doesNotMatch(profile.profile, /Electrical Mate/i);
  assert.doesNotMatch(JSON.stringify(profile), /content emphasis has been tuned|all statements remain grounded/i);
  assert.ok(profile.keySkills.some((item) => /procurement/i.test(item)));
  assert.ok(profile.relevantProjects.every((item) => !/Electrical Mate|BSc \(Hons\)/i.test(item)));
  assert.ok(profile.employmentHistory.every((entry) => !entry.title || /Quantity Surveyor/i.test(entry.title)));
});

test('buildFallbackProfile keeps the most recent five years of employment history when available', () => {
  const sourceText = [
    'Position',
    'Commercial Manager',
    'Employment History',
    'Commercial Manager | 2025 - Present',
    'Leads commercial strategy and reporting for hyperscale delivery programmes.',
    'Senior Quantity Surveyor | 2023 - 2025',
    'Managed procurement, package buyout, and change control on mission-critical projects.',
    'Quantity Surveyor | 2021 - 2023',
    'Supported cost planning and final accounts across electrical and CSA packages.',
    'Assistant Quantity Surveyor | 2017 - 2021',
    'Earlier-career commercial support across regional projects.',
  ].join('\n');

  const profile = buildFallbackProfile({
    candidateText: sourceText,
    jobSpecText: 'Commercial Manager required for data centre delivery.',
    candidateFileName: 'Commercial Manager CV.docx',
  });

  assert.deepEqual(
    profile.employmentHistory.map((entry) => entry.dates),
    ['2025 - Present', '2023 - 2025', '2021 - 2023']
  );
});

test('buildFallbackProfile promotes a person-name location into the candidate title and clears the location field', () => {
  const sourceText = [
    'QAQC Lead',
    'Candidate ID',
    'HMJ-TEST1234',
    'Location',
    'David Castle',
    'Employment History',
    'QAQC Lead',
    'Exyte, Tnuvot 01/23-07/23',
    'Carry out W1 and W2 walkdowns on electrical equipment.',
  ].join('\n');

  const profile = buildFallbackProfile({
    candidateText: sourceText,
    jobSpecText: '',
    candidateFileName: 'QAQC Lead - HMJ-TEST1234.docx',
  });

  assert.equal(profile.candidateName, 'David Castle');
  assert.equal(profile.location, '');
});

test('buildFallbackProfile reconstructs recent QAQC employment history from a previously formatted source document', () => {
  const sourceText = [
    'Candidate profile',
    'QAQC Lead',
    'Candidate ID: HMJ-3B7A1F33   |   Location: David Castle',
    'Employment History',
    'LV SENIOR AUTHORISED PERSON',
    'WINTHROP, ARN060 AWS 09/25-01/26',
    'QA/QC HV/LV Authorised Person Exyte, Frankfurt FR16 (Equinix) 02/25-05/25 commissioning, to ensure client specification has been met.',
    'Managing and maintaining SSOW',
    'LOTO on all LV Equipment',
    'Electrical Construction Manager',
    'Exyte, Frankfurt FR16 (Equinix) 03/24-12/24',
    'commissioning electrical equipment',
    'Commissioning Engineer',
    'Exyte, Cyberjaya KUL03 Malaysia (Microsoft) 07/23-03/24',
    'systems, Busbars, Switchboards and ATS',
    'QAQC Lead',
    'Exyte, Tnuvot (North of Tel Aviv) Amazon 01/23- 07/23',
    'QAQC Lead SUIR Engineering, Eskilstuna Sweden, (Microsoft) 09/22-01/23 design commissioning authority LV Senior Authorised Person Dornans, Hillerod, Denmark, (FUJI Pharmaceutical) 05/22-09/22',
  ].join('\n');

  const profile = buildFallbackProfile({
    candidateText: sourceText,
    jobSpecText: '',
    candidateFileName: 'QAQC Lead - HMJ-3B7A1F33.docx',
    options: {
      templatePreset: 'premium_candidate_pack',
      candidateDisplayName: 'David Castle',
      targetRoleOverride: 'QAQC Lead',
    },
  });

  assert.equal(profile.candidateName, 'David Castle');
  assert.equal(profile.targetRole, 'QA/QC Lead');
  assert.equal(profile.location, '');
  assert.ok(profile.employmentHistory.length >= 5);
  assert.deepEqual(
    profile.employmentHistory.slice(0, 3).map((entry) => [entry.title, entry.company, entry.dates]),
    [
      ['LV Senior Authorised Person', 'WINTHROP, ARN060 AWS', '09/25-01/26'],
      ['QA/QC HV/LV Authorised Person', 'Exyte, Frankfurt FR16 (Equinix)', '02/25-05/25'],
      ['Electrical Construction Manager', 'Exyte, Frankfurt FR16 (Equinix)', '03/24-12/24'],
    ]
  );
  assert.ok(profile.relevantProjects.every((item) => !/\b(?:hnc|hnd|bsc|msc|edition|training)\b/i.test(item)));
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

test('buildClientReadyDocx includes branded footer contact details and a client-only document structure', async () => {
  const buffer = await buildClientReadyDocx({
    candidateName: 'David Castle',
    candidateReference: 'HMJ-TEST1234',
    targetRole: 'Electrical Project Manager',
    location: 'Birmingham',
    interviewAvailability: 'Available with short notice',
    languages: ['English'],
    profile: 'Client-ready summary paragraph for a delivery-focused electrical project manager supporting mission-critical projects.',
    roleAlignment: ['Aligned to data centre delivery requirements.'],
    relevantProjects: ['Hyperscale data centre fit-out delivery'],
    keySkills: ['Programme delivery', 'Stakeholder management', 'MEP coordination'],
    qualifications: ['HNC Electrical Engineering'],
    accreditations: ['SMSTS'],
    employmentHistory: [],
    additionalInformation: ['Open to travel'],
    redactionsApplied: ['Direct contact details removed'],
    warnings: ['This should not render in the client document.'],
  }, {
    coverPageMode: 'full',
  });

  const entries = await readDocxEntries(buffer);
  const footerNames = Object.keys(entries).filter((name) => /^word\/footer\d+\.xml$/.test(name));
  const footerRelNames = Object.keys(entries).filter((name) => /^word\/_rels\/footer\d+\.xml\.rels$/.test(name));
  const footerXml = Object.entries(entries)
    .filter(([name]) => /^word\/footer\d+\.xml$/.test(name))
    .map(([, xml]) => xml)
    .join('\n');
  const footerRels = Object.entries(entries)
    .filter(([name]) => /^word\/_rels\/footer\d+\.xml\.rels$/.test(name))
    .map(([, xml]) => xml)
    .join('\n');
  const documentXml = entries['word/document.xml'] || '';
  const stylesXml = entries['word/styles.xml'] || '';
  const contentTypesXml = entries['[Content_Types].xml'] || '';
  const mediaNames = Object.keys(entries).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
  const documentRelsXml = entries['word/_rels/document.xml.rels'] || '';
  const footerRelationshipIds = Array.from(footerXml.matchAll(/r:id="([^"]+)"/g)).map((match) => match[1]);

  assert.deepEqual(footerNames, ['word/footer1.xml']);
  assert.deepEqual(footerRelNames, ['word/_rels/footer1.xml.rels']);
  assert.match(footerXml, /info@hmj-global\.com/);
  assert.match(footerXml, /0800 861 1230/);
  assert.match(footerXml, /www\.HMJ-Global\.com/);
  assert.match(footerRels, /mailto:info@hmj-global\.com/);
  assert.match(footerRels, /https:\/\/www\.HMJ-Global\.com/);
  footerRelationshipIds.forEach((id) => assert.match(footerRels, new RegExp(`Id="${id}"`)));
  assert.match(documentXml, />DAVID CASTLE</);
  assert.match(documentXml, />Executive Summary</);
  assert.match(documentXml, />Core Strengths</);
  assert.match(documentXml, />Key Project Experience</);
  assert.match(documentXml, />Qualifications &amp; Certifications</);
  assert.doesNotMatch(documentXml, /<w:tblGrid>/);
  assert.doesNotMatch(documentXml, /w:type="page"/);
  assert.doesNotMatch(documentRelsXml, /footer2\.xml/);
  assert.equal((stylesXml.match(/<w:docDefaults>/g) || []).length, 1);
  assert.ok(mediaNames.every((name) => /\.png$/i.test(name)));
  assert.ok(mediaNames.length >= 1);
  assert.doesNotMatch(contentTypesXml, /\.undefined/);
  assert.doesNotMatch(documentXml, /Formatting Notes/);
  assert.doesNotMatch(documentXml, />Warnings</);
  assert.doesNotMatch(documentXml, />Role Alignment</);
  assert.doesNotMatch(documentXml, />Candidate profile</);
  assert.doesNotMatch(documentXml, />Client-ready candidate profile</);
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

test('verifyPremiumCandidatePack passes a well-formed premium candidate pack deterministically', async () => {
  const profile = {
    candidateName: 'David Castle',
    candidateReference: 'HMJ-TEST1234',
    targetRole: 'QAQC Lead',
    location: '',
    interviewAvailability: 'Available with short notice',
    languages: ['English'],
    profile: 'Experienced QAQC lead with data centre and pharmaceutical delivery exposure across electrical quality, commissioning readiness, and structured walkdown processes.',
    roleAlignment: [],
    relevantProjects: ['Data centre QA walkdowns and commissioning readiness'],
    keySkills: ['Electrical QA/QC', 'Commissioning', 'Punch-list closeout'],
    qualifications: ['C&G 2391 Electrical Test and Inspection'],
    accreditations: ['IPAF'],
    employmentHistory: [
      {
        dates: '01/23-07/23',
        title: 'QAQC Lead',
        company: 'Exyte, Tnuvot',
        summary: 'Led electrical QA and commissioning closeout activities.',
        bullets: ['Managed walkdowns and handover packs'],
      },
    ],
    additionalInformation: [],
    redactionsApplied: [],
    warnings: [],
  };

  const buffer = await buildClientReadyDocx(profile, { templatePreset: 'premium_candidate_pack' });
  const verification = await verifyPremiumCandidatePack({
    profile,
    buffer,
    options: { templatePreset: 'premium_candidate_pack' },
  });

  assert.equal(verification.passed, true);
  assert.equal(verification.blockingFailure, false);
  assert.equal(verification.deterministic.passed, true);
});

test('verifyPremiumCandidatePack blocks malformed premium output when employment entries remain incomplete', async () => {
  const profile = {
    candidateName: 'David Castle',
    candidateReference: 'HMJ-TEST1234',
    targetRole: 'QA/QC Lead',
    location: '',
    interviewAvailability: '',
    languages: [],
    profile: 'Experienced QA/QC lead with client-facing delivery exposure.',
    roleAlignment: [],
    relevantProjects: ['Professional Training and HNC summary fragment'],
    keySkills: ['Electrical QA/QC'],
    qualifications: ['C&G 2391 Electrical Test and Inspection'],
    accreditations: [],
    employmentHistory: [
      {
        dates: '',
        title: 'QA/QC Lead',
        company: '',
        summary: '',
        bullets: [],
      },
    ],
    additionalInformation: [],
    redactionsApplied: [],
    warnings: [],
  };

  const buffer = await buildClientReadyDocx(profile, { templatePreset: 'premium_candidate_pack' });
  const verification = await verifyPremiumCandidatePack({
    profile,
    buffer,
    options: { templatePreset: 'premium_candidate_pack' },
  });

  assert.equal(verification.passed, false);
  assert.equal(verification.blockingFailure, true);
  assert.equal(verification.deterministic.passed, false);
  assert.match(verification.deterministic.reasons.join(' '), /incomplete|weak or non-project/i);
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
            candidate_name: 'Jane Candidate',
            target_role: 'Electrical Project Manager',
            sanitized_location: 'London',
            interview_availability: '',
            languages: ['English'],
            profile: 'Structured summary from backup model.',
            role_alignment: ['Aligned to data centre delivery requirements.'],
            relevant_projects: ['Mission-critical delivery'],
            key_skills: ['Electrical project delivery', 'Mission-critical coordination'],
            qualifications: ['HNC Electrical Engineering'],
            accreditations: ['SMSTS'],
            employment_history: [],
            additional_information: [],
            redactions_applied: ['Name removed'],
            warnings: [],
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

test('callOpenAiFormatter retries a repair attempt on the same model after incomplete structured output', async () => {
  const calls = [];

  const result = await withPatchedEnv({
    OPENAI_API_KEY: 'test-key',
    OPENAI_CV_FORMAT_MODEL: 'primary-model',
    OPENAI_CV_FORMAT_FALLBACK_MODELS: 'backup-model-1',
  }, async () => callOpenAiFormatter({
    candidateFileName: 'Candidate CV.docx',
    candidateText: 'Experienced electrical project manager with mission-critical delivery background.',
    jobSpecText: 'Electrical Project Manager required for data centre delivery.',
    candidateReference: 'HMJ-TEST1234',
    requestFetch: async (_url, request) => {
      const body = JSON.parse(String(request.body || '{}'));
      calls.push({
        model: body.model,
        max_output_tokens: body.max_output_tokens,
      });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    candidate_name: 'Jane Candidate',
                    target_role: 'Electrical Project Manager',
                    sanitized_location: 'London',
                    interview_availability: '',
                    languages: ['English'],
                    profile: 'Structured summary from repair attempt.',
                    role_alignment: ['Aligned to electrical delivery requirements.'],
                    relevant_projects: ['Mission-critical delivery'],
                    key_skills: ['Electrical delivery', 'Commissioning'],
                    qualifications: ['HNC Electrical Engineering'],
                    accreditations: ['SMSTS'],
                    employment_history: [],
                    additional_information: [],
                    redactions_applied: ['Name removed'],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      };
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.model, 'primary-model');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].code, 'openai_incomplete_output');
  assert.equal(result.attempts[1].ok, true);
  assert.deepEqual(calls, [
    { model: 'primary-model', max_output_tokens: 2400 },
    { model: 'primary-model', max_output_tokens: 3400 },
  ]);
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
  assert.equal(result.code, 'openai_authentication_failed');
  assert.equal(calls.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].code, 'openai_authentication_failed');
  assert.match(result.error, /authentication failed/i);
});

test('callOpenAiCandidatePackVerifier accepts a passing review response', async () => {
  const result = await withPatchedEnv({
    OPENAI_API_KEY: 'test-key',
    OPENAI_CV_VERIFY_MODEL: 'verify-model',
  }, async () => callOpenAiCandidatePackVerifier({
    profile: {
      candidateName: 'David Castle',
      targetRole: 'QAQC Lead',
      profile: 'Premium candidate summary.',
      keySkills: ['Electrical QA/QC'],
      relevantProjects: ['Data centre QA/QC delivery'],
      employmentHistory: [],
      qualifications: [],
      accreditations: [],
    },
    snapshot: {
      documentText: 'DAVID CASTLE QAQC Lead Executive Summary Core Strengths Key Project Experience Employment History Qualifications & Certifications',
      headerText: '',
      footerText: 'info@hmj-global.com | 0800 861 1230 | www.HMJ-Global.com',
      headingSequence: ['Executive Summary', 'Core Strengths', 'Key Project Experience', 'Employment History', 'Qualifications & Certifications'],
      mediaNames: ['word/media/image1.png'],
      hasPremiumHeaderBand: true,
      hasLogoImage: true,
    },
    requestFetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        output_text: JSON.stringify({
          outcome: 'pass',
          confidence_score: 0.93,
          professionalism_score: 0.95,
          reasons: ['The pack is branded and client-ready.'],
          remediation_suggestions: [],
        }),
      }),
    }),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.outcome, 'pass');
});
