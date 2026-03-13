const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../lib/candidate-matcher-core.js');
const {
  createCandidateMatchStatusBaseHandler,
  createCandidatePrepareBaseHandler,
  createCandidateHistoryListBaseHandler,
  createCandidateMatchBaseHandler,
  createCandidateRunMatchBaseHandler,
  createCandidateRunMatchBackgroundBaseHandler,
} = require('../lib/admin-candidate-match-function.js');

function buildValidMatcherResult() {
  return {
    candidate_summary: {
      name: 'Alex Example',
      current_or_recent_title: 'Commissioning Engineer',
      seniority_level: 'Mid-Senior',
      primary_discipline: 'Electrical Commissioning',
      sectors: ['Data Centres'],
      locations: ['London'],
      key_skills: ['HV commissioning', 'QA/QC'],
      key_qualifications: ['SSSTS'],
      summary: 'Strong site delivery candidate with direct commissioning evidence.',
    },
    top_matches: [{
      job_id: 'job-1',
      job_title: 'HV Commissioning Engineer',
      score: 89,
      recommendation: 'shortlist',
      why_match: 'Directly aligned experience.',
      matched_skills: ['HV commissioning'],
      matched_qualifications: ['SSSTS'],
      transferable_experience: [],
      gaps: [],
      follow_up_questions: ['Can the candidate start in two weeks?'],
      uncertainty_notes: '',
    }],
    other_matches: [],
    overall_recommendation: 'Shortlist for recruiter review.',
    general_follow_up_questions: ['Confirm current location.'],
    no_strong_match_reason: '',
  };
}

test('prepareCandidateFiles marks unsupported extensions without crashing the run', () => {
  const files = core.prepareCandidateFiles([
    { name: 'profile.doc', data: Buffer.from('legacy').toString('base64'), size: 6 },
    { name: 'notes.txt', data: Buffer.from('bad').toString('base64'), size: 3 }
  ]);

  assert.equal(files.length, 2);
  assert.equal(files[0].status, 'ready');
  assert.equal(files[1].status, 'unsupported');
});

test('prepareCandidateFiles accepts image evidence and strips data-url payload prefixes', () => {
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const files = core.prepareCandidateFiles([
    {
      name: 'certificate.png',
      contentType: 'image/png',
      data: `data:image/png;base64,${imageBytes.toString('base64')}`,
      size: imageBytes.length,
    }
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].status, 'ready');
  assert.equal(files[0].fileKind, 'image');
  assert.equal(files[0].extractionMode, 'image_only');
  assert.equal(files[0].buffer.byteLength, imageBytes.length);
});

test('extractCandidateDocuments reads text from a readable PDF buffer', async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 67 >>
stream
BT
/F1 12 Tf
72 100 Td
(Readable HMJ PDF text) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000248 00000 n 
0000000365 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
435
%%EOF`;

  const result = await core.extractCandidateDocuments([{
    id: 'doc-1',
    name: 'Readable CV (Final).pdf',
    extension: 'pdf',
    contentType: 'application/pdf',
    size: Buffer.byteLength(pdf),
    status: 'ready',
    buffer: Buffer.from(pdf, 'utf8'),
    storageKey: '',
    extractedText: '',
    extractedTextLength: 0,
    error: '',
  }]);

  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 0);
  assert.equal(result.documents[0].status, 'ok');
  assert.match(result.combinedText, /Readable HMJ PDF text/);
});

test('extractCandidateDocuments reads text from a readable DOCX buffer', async () => {
  const docxBase64 = 'UEsDBBQAAAAIAIBybVzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgAgHJtXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgAgHJtXEjS6NmyAAAA7AAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDWOwQrCMBBE737FkrumehApbXpQRAQRRMFrbFYtNLshiVb/3qTg5THDwNutmo/t4Y0+dEy1mM8KAUgtm44etbict9OVgBA1Gd0zYS2+GESjJtVQGm5fFilCMlAoh1o8Y3SllKF9otVhxg4pbXf2VsdU/UMO7I3z3GII6YDt5aIoltLqjoSaACTrjc03x7E4leAzojqhNvrWI+wOe9gc11eI+ImVzFumH+lGjfx7cvr/qX5QSwECFAMUAAAACACAcm1c13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAIBybVwgG4bqsgAAAC4BAAALAAAAAAAAAAAAAACAASIBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAIBybVxI0ujZsgAAAOwAAAARAAAAAAAAAAAAAACAAf0BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADeAgAAAAA=';
  const buffer = Buffer.from(docxBase64, 'base64');

  const result = await core.extractCandidateDocuments([{
    id: 'doc-2',
    name: 'Readable CV.docx',
    extension: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: buffer.byteLength,
    status: 'ready',
    buffer,
    storageKey: '',
    extractedText: '',
    extractedTextLength: 0,
    error: '',
  }]);

  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 0);
  assert.equal(result.documents[0].status, 'ok');
  assert.match(result.combinedText, /Readable HMJ DOCX text/);
});

test('extractCandidateDocuments keeps image evidence without crashing the run', async () => {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const result = await core.extractCandidateDocuments([{
    id: 'doc-3',
    name: 'Cert photo.png',
    extension: 'png',
    fileKind: 'image',
    extractionMode: 'image_only',
    parserPath: 'image-evidence',
    contentType: 'image/png',
    size: buffer.byteLength,
    status: 'ready',
    buffer,
    storageKey: '',
    extractedText: '',
    extractedTextLength: 0,
    error: '',
  }]);

  assert.equal(result.successCount, 0);
  assert.equal(result.documents[0].status, 'image_only');
  assert.equal(result.imageEvidence.length, 1);
  assert.equal(result.combinedText, '');
});

test('extractCandidateDocuments handles a readable PDF plus image evidence in one run', async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 64 >>
stream
BT
/F1 12 Tf
72 100 Td
(Planner CV evidence) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000248 00000 n 
0000000362 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
432
%%EOF`;
  const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  const result = await core.extractCandidateDocuments([
    {
      id: 'doc-4',
      name: 'cv.pdf',
      extension: 'pdf',
      contentType: 'application/pdf',
      size: Buffer.byteLength(pdf),
      status: 'ready',
      buffer: Buffer.from(pdf, 'utf8'),
      storageKey: '',
      extractedText: '',
      extractedTextLength: 0,
      error: '',
    },
    {
      id: 'doc-5',
      name: 'certificate.png',
      extension: 'png',
      fileKind: 'image',
      extractionMode: 'image_only',
      parserPath: 'image-evidence',
      contentType: 'image/png',
      size: imageBuffer.byteLength,
      status: 'ready',
      buffer: imageBuffer,
      storageKey: '',
      extractedText: '',
      extractedTextLength: 0,
      error: '',
    }
  ]);

  assert.equal(result.successCount, 1);
  assert.equal(result.imageEvidence.length, 1);
  assert.match(result.combinedText, /Planner CV evidence/);
});

test('buildPreparedEvidenceSummary infers a likely candidate name from extracted text when possible', () => {
  const summary = core.buildPreparedEvidenceSummary({
    documents: [{
      id: 'doc-1',
      name: 'candidate.pdf',
      extension: 'pdf',
      contentType: 'application/pdf',
      size: 1200,
      status: 'ok',
      extractedTextLength: 140,
      error: '',
      storageKey: '',
    }],
    combinedText: 'Alex Murphy\nSenior Planner\nPrimavera P6\nData centre projects',
  });

  assert.equal(summary.inferred_candidate_name, 'Alex Murphy');
  assert.equal(summary.ready_for_match, true);
});

test('fetchPublishedLiveJobs keeps only published roles with live status', async () => {
  const rows = [
    { id: 'job-1', title: 'Live role', published: true, status: 'live', type: 'contract' },
    { id: 'job-2', title: 'Closed role', published: true, status: 'closed', type: 'contract' },
    { id: 'job-3', title: 'Draft role', published: false, status: 'live', type: 'contract' }
  ];

  const query = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    then(resolve) { return Promise.resolve(resolve({ data: rows, error: null })); }
  };

  const jobs = await core.fetchPublishedLiveJobs({
    from(tableName) {
      assert.equal(tableName, 'jobs');
      return query;
    }
  });

  assert.deepEqual(jobs.map((job) => job.job_id), ['job-1']);
});

test('candidate matcher schema is internally consistent before use', () => {
  assert.equal(core.MATCH_RESULT_SCHEMA_NAME, 'candidate_match_result');
  assert.deepEqual(core.validateStructuredOutputSchema(core.MATCH_RESULT_SCHEMA), []);
});

test('parseOpenAIMatchResponse recovers wrapped matcher JSON safely', () => {
  const payload = {
    id: 'resp_123',
    status: 'completed',
    output: [{
      status: 'completed',
      content: [{
        type: 'output_text',
        text: `\`\`\`json\n${JSON.stringify({ result: buildValidMatcherResult() }, null, 2)}\n\`\`\``,
      }],
    }],
  };

  const parsed = core.parseOpenAIMatchResponse(payload, {
    model: 'gpt-5.4',
    maxOutputTokens: 3200,
    repairMode: false,
  });

  assert.equal(parsed.result.candidate_summary.name, 'Alex Example');
  assert.equal(parsed.result.top_matches[0].job_id, 'job-1');
  assert.equal(parsed.diagnostics.parser_strategy, 'code_fence');
  assert.equal(parsed.diagnostics.wrapper_key, 'result');
});

test('parseOpenAIMatchResponse returns a canonical schema-valid matcher result', () => {
  const payload = {
    id: 'resp_schema_ok',
    status: 'completed',
    output: [{
      status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(buildValidMatcherResult()) }],
    }],
  };

  const parsed = core.parseOpenAIMatchResponse(payload, {
    model: 'gpt-5.4',
    maxOutputTokens: 3200,
    repairMode: false,
  });

  assert.deepEqual(core.validateMatcherResultAgainstSchema(parsed.result), []);
  assert.equal(parsed.result.top_matches[0].uncertainty_notes, '');
});

test('parseOpenAIMatchResponse reports incomplete structured output clearly', () => {
  assert.throws(() => {
    core.parseOpenAIMatchResponse({
      id: 'resp_incomplete',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{
        status: 'incomplete',
        content: [{ type: 'output_text', text: '{"candidate_summary": {' }],
      }],
    }, {
      model: 'gpt-5.4',
      maxOutputTokens: 3200,
      repairMode: false,
    });
  }, (error) => {
    assert.equal(error.code, 'openai_incomplete_output');
    assert.match(error.message, /max_output_tokens/i);
    assert.equal(error.details.parse_stage, 'incomplete');
    return true;
  });
});

test('parseOpenAIMatchResponse reports truncated JSON clearly', () => {
  assert.throws(() => {
    core.parseOpenAIMatchResponse({
      id: 'resp_bad_json',
      status: 'completed',
      output: [{
        status: 'completed',
        content: [{ type: 'output_text', text: '{"candidate_summary":{"name":"Alex"}' }],
      }],
    }, {
      model: 'gpt-5.4',
      maxOutputTokens: 3200,
      repairMode: false,
    });
  }, (error) => {
    assert.equal(error.code, 'openai_invalid_json');
    assert.equal(error.details.parse_stage, 'json_parse');
    return true;
  });
});

test('callOpenAIForMatch validates the matcher schema before sending a request', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const originalRequired = [...core.MATCH_RESULT_SCHEMA.$defs.match.required];
  core.MATCH_RESULT_SCHEMA.$defs.match.required = originalRequired.filter((key) => key !== 'uncertainty_notes');
  let fetchCalled = false;

  try {
    await assert.rejects(() => core.callOpenAIForMatch({
      candidate: { candidate_text: 'Candidate text' },
      live_jobs: [{ job_id: 'job-1', title: 'HV Commissioning Engineer' }],
    }, {
      timeoutMs: 2000,
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('fetch should not be called when the schema is invalid');
      },
    }), (error) => {
      assert.equal(error.code, 'openai_schema_definition_invalid');
      assert.match((error.details.validation_errors || []).join('\n'), /uncertainty_notes/);
      return true;
    });
    assert.equal(fetchCalled, false);
  } finally {
    core.MATCH_RESULT_SCHEMA.$defs.match.required = originalRequired;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('callOpenAIForMatch retries once after incomplete structured output', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_CANDIDATE_MATCH_MODEL;
  const originalFallback = process.env.OPENAI_CANDIDATE_MATCH_FALLBACK_MODEL;
  const originalMaxTokens = process.env.OPENAI_CANDIDATE_MATCH_MAX_OUTPUT_TOKENS;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_CANDIDATE_MATCH_MODEL = 'gpt-5.4';
  process.env.OPENAI_CANDIDATE_MATCH_FALLBACK_MODEL = 'gpt-5-mini';
  delete process.env.OPENAI_CANDIDATE_MATCH_MAX_OUTPUT_TOKENS;

  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    const body = callCount === 1
      ? {
        id: 'resp_retry_1',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{
          status: 'incomplete',
          content: [{ type: 'output_text', text: '{"candidate_summary": {' }],
        }],
      }
      : {
        id: 'resp_retry_2',
        status: 'completed',
        output: [{
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(buildValidMatcherResult()) }],
        }],
      };

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    };
  };

  try {
    const response = await core.callOpenAIForMatch({
      candidate: { candidate_text: 'Candidate text' },
      live_jobs: [{ job_id: 'job-1', title: 'HV Commissioning Engineer' }],
    }, {
      timeoutMs: 2000,
      fetchImpl,
    });

    assert.equal(callCount, 2);
    assert.equal(response.result.candidate_summary.name, 'Alex Example');
    assert.equal(response.result.top_matches[0].job_id, 'job-1');
  } finally {
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalModel == null) delete process.env.OPENAI_CANDIDATE_MATCH_MODEL;
    else process.env.OPENAI_CANDIDATE_MATCH_MODEL = originalModel;
    if (originalFallback == null) delete process.env.OPENAI_CANDIDATE_MATCH_FALLBACK_MODEL;
    else process.env.OPENAI_CANDIDATE_MATCH_FALLBACK_MODEL = originalFallback;
    if (originalMaxTokens == null) delete process.env.OPENAI_CANDIDATE_MATCH_MAX_OUTPUT_TOKENS;
    else process.env.OPENAI_CANDIDATE_MATCH_MAX_OUTPUT_TOKENS = originalMaxTokens;
  }
});

test('summariseMatcherFailure keeps recruiter copy friendly while preserving technical schema detail', () => {
  const failure = core.summariseMatcherFailure(core.coded(
    500,
    'Local matcher schema validation failed before calling OpenAI.',
    'openai_schema_definition_invalid',
    {
      details: {
        stage: 'openai',
        parse_stage: 'schema_definition',
        validation_errors: ['#/$defs/match.required is missing "uncertainty_notes".'],
      }
    }
  ));

  assert.match(failure.userMessage, /misconfigured/i);
  assert.match(failure.technicalMessage, /uncertainty_notes/);
  assert.match(failure.technicalMessage, /openai_schema_definition_invalid/);
});

test('candidate match handler returns a happy-path payload with mocked dependencies', async () => {
  const originals = {
    prepareCandidateFiles: core.prepareCandidateFiles,
    extractCandidateDocuments: core.extractCandidateDocuments,
    fetchPublishedLiveJobs: core.fetchPublishedLiveJobs,
    maybeStoreUploads: core.maybeStoreUploads,
    callOpenAIForMatch: core.callOpenAIForMatch,
    saveMatchRun: core.saveMatchRun,
    buildCandidatePayload: core.buildCandidatePayload,
    summariseDocument: core.summariseDocument,
  };

  core.prepareCandidateFiles = () => [{
    id: 'file-1',
    name: 'candidate.docx',
    extension: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 1234,
    status: 'ready',
    buffer: Buffer.from('docx'),
    extractedText: '',
    extractedTextLength: 0,
    error: '',
    storageKey: '',
  }];
  core.extractCandidateDocuments = async (documents) => ({
    documents: [{
      ...documents[0],
      status: 'ok',
      extractedText: 'Candidate has HV commissioning experience and SSSTS.',
      extractedTextLength: 56,
      storageKey: 'candidate-matcher/run/file.docx',
    }],
    successful: [{
      ...documents[0],
      status: 'ok',
      extractedText: 'Candidate has HV commissioning experience and SSSTS.',
      extractedTextLength: 56,
      storageKey: 'candidate-matcher/run/file.docx',
    }],
    failed: [],
    successCount: 1,
    failureCount: 0,
    combinedText: 'Candidate has HV commissioning experience and SSSTS.',
  });
  core.fetchPublishedLiveJobs = async () => [{
    job_id: 'job-1',
    title: 'HV Commissioning Engineer',
    location: 'London',
    employment_type: 'contract',
    published: true,
    status: 'live',
  }];
  core.maybeStoreUploads = async () => ({ stored: true, bucket: 'candidate-matcher-uploads', warnings: [] });
  core.buildCandidatePayload = () => ({ candidate_text: 'Candidate text', recruiter_notes: 'notes' });
  core.callOpenAIForMatch = async () => ({
    model: 'gpt-5.4',
    raw: {},
    result: {
      candidate_summary: {
        name: 'Alex Example',
        current_or_recent_title: 'Commissioning Engineer',
        seniority_level: 'Mid-Senior',
        primary_discipline: 'Electrical Commissioning',
        sectors: ['Data Centres'],
        locations: ['London'],
        key_skills: ['HV commissioning', 'SSSTS'],
        key_qualifications: ['SSSTS'],
        summary: 'Strong site delivery candidate with direct commissioning evidence.'
      },
      top_matches: [{
        job_id: 'job-1',
        job_title: 'HV Commissioning Engineer',
        score: 89,
        recommendation: 'shortlist',
        why_match: 'Directly aligned experience.',
        matched_skills: ['HV commissioning'],
        matched_qualifications: ['SSSTS'],
        transferable_experience: [],
        gaps: [],
        follow_up_questions: ['Can the candidate start in two weeks?'],
        uncertainty_notes: ''
      }],
      other_matches: [],
      overall_recommendation: 'Shortlist for recruiter review.',
      general_follow_up_questions: ['Confirm current location.'],
      no_strong_match_reason: ''
    }
  });
  core.saveMatchRun = async () => ({
    saved: true,
    enabled: true,
    record: { id: 'run-1', created_at: '2026-03-13T10:00:00Z' }
  });
  core.summariseDocument = (document) => ({
    id: document.id,
    name: document.name,
    status: document.status,
    size: document.size,
    sizeLabel: '1 KB',
    extension: document.extension,
    contentType: document.contentType,
    extractedTextLength: document.extractedTextLength,
    error: document.error,
    storageKey: document.storageKey,
  });

  const handler = createCandidateMatchBaseHandler({
    getContextImpl: async () => ({
      supabase: {},
      user: { email: 'recruiter@hmjglobal.test' },
    })
  });

  const response = await handler({
    body: JSON.stringify({
      files: [{ name: 'candidate.docx', data: 'ignored' }],
      recruiterNotes: 'Prioritise data centre roles.',
      saveHistory: true,
    })
  }, {});

  Object.assign(core, originals);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.live_jobs_count, 1);
  assert.equal(payload.result.candidate_summary.name, 'Alex Example');
  assert.equal(payload.result.top_matches[0].job_id, 'job-1');
  assert.equal(payload.saved_to_history, true);
});

test('candidate prepare handler stores prepared evidence and returns a review payload', async () => {
  const originals = {
    prepareCandidateFiles: core.prepareCandidateFiles,
    extractCandidateDocuments: core.extractCandidateDocuments,
    maybeStoreUploads: core.maybeStoreUploads,
    savePreparedRun: core.savePreparedRun,
    getMatchRun: core.getMatchRun,
  };

  core.prepareCandidateFiles = () => [{
    id: 'file-1',
    name: 'candidate.pdf',
    extension: 'pdf',
    contentType: 'application/pdf',
    size: 1234,
    status: 'ready',
    buffer: Buffer.from('pdf'),
    extractedText: '',
    extractedTextLength: 0,
    error: '',
    storageKey: '',
  }];
  core.extractCandidateDocuments = async (documents) => ({
    documents: [{
      ...documents[0],
      status: 'ok',
      extractedText: 'Candidate evidence text',
      extractedTextLength: 23,
      storageKey: 'candidate-matcher/run/file.pdf',
    }],
    successful: [{
      ...documents[0],
      status: 'ok',
      extractedText: 'Candidate evidence text',
      extractedTextLength: 23,
      storageKey: 'candidate-matcher/run/file.pdf',
    }],
    failed: [],
    imageEvidence: [],
    successCount: 1,
    failureCount: 0,
    combinedText: 'Candidate evidence text',
  });
  core.maybeStoreUploads = async () => ({ stored: true, bucket: 'candidate-matcher-uploads', warnings: [] });
  core.savePreparedRun = async () => ({ saved: true, enabled: true, record: { id: 'prepared-1' } });
  core.getMatchRun = async () => ({
    id: 'prepared-1',
    created_at: '2026-03-13T12:00:00Z',
    updated_at: '2026-03-13T12:00:00Z',
    recruiter_notes: 'Prioritise planning roles.',
    status: 'pending',
    ready_for_match: true,
    has_result: false,
    prepared_evidence: {
      ready_for_match: true,
      files_attempted: 1,
      files_text_read: 1,
      image_evidence_count: 0,
      limited_count: 0,
      unsupported_count: 0,
      failed_count: 0,
      preview_text: 'Candidate evidence text',
      text_files: [{ name: 'candidate.pdf', status: 'ok', sizeLabel: '1 KB', contentType: 'application/pdf' }],
      image_evidence_files: [],
      limited_files: [],
      unsupported_files: [],
      failed_files: [],
      documents: [{ name: 'candidate.pdf', status: 'ok', size: 1234, contentType: 'application/pdf' }],
    },
    file_names: ['candidate.pdf'],
    files: [],
    raw_result_json: { preparation: { combined_candidate_text: 'Candidate evidence text' } },
  });

  const handler = createCandidatePrepareBaseHandler({
    getContextImpl: async () => ({
      supabase: {},
      user: { email: 'recruiter@hmjglobal.test' },
    })
  });

  const response = await handler({
    body: JSON.stringify({
      files: [{ name: 'candidate.pdf', data: 'ignored' }],
      recruiterNotes: 'Prioritise planning roles.',
    })
  }, {});

  Object.assign(core, originals);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.prepared_run.id, 'prepared-1');
  assert.equal(payload.prepared_run.ready_for_match, true);
  assert.equal(payload.extraction.success_count, 1);
});

test('candidate run match handler queues background work without re-uploading files', async () => {
  const originals = {
    getMatchRun: core.getMatchRun,
    updatePreparedRunJobState: core.updatePreparedRunJobState,
  };

  let getCount = 0;
  core.getMatchRun = async () => {
    getCount += 1;
    return {
      id: 'prepared-2',
      created_at: '2026-03-13T12:00:00Z',
      updated_at: '2026-03-13T12:10:00Z',
      recruiter_notes: 'Reuse saved evidence.',
      status: 'pending',
      ready_for_match: true,
      has_result: false,
      match_job: getCount > 1
        ? {
          id: 'job-queued-1',
          status: 'queued',
          queued_at: '2026-03-13T12:11:00Z',
          started_at: '',
          completed_at: '',
          failed_at: '',
          last_error: '',
        }
        : null,
      prepared_evidence: {
        ready_for_match: true,
        files_attempted: 2,
        files_text_read: 1,
        image_evidence_count: 1,
        limited_count: 0,
        unsupported_count: 0,
        failed_count: 0,
        preview_text: 'Candidate evidence text',
        text_files: [{ name: 'candidate.pdf', status: 'ok', sizeLabel: '1 KB', contentType: 'application/pdf' }],
        image_evidence_files: [{ name: 'certificate.png', status: 'image_only', sizeLabel: '4 B', contentType: 'image/png' }],
        limited_files: [],
        unsupported_files: [],
        failed_files: [],
        documents: [
          { name: 'candidate.pdf', status: 'ok', size: 1234, contentType: 'application/pdf' },
          { name: 'certificate.png', status: 'image_only', size: 4, contentType: 'image/png' },
        ],
      },
      file_names: ['candidate.pdf', 'certificate.png'],
      files: [{ storage_bucket: 'candidate-matcher-uploads' }],
      raw_result_json: { preparation: { combined_candidate_text: 'Candidate evidence text' } },
    };
  };
  core.updatePreparedRunJobState = async () => ({ id: 'prepared-2' });

  let dispatchedPayload = null;

  const handler = createCandidateRunMatchBaseHandler({
    getContextImpl: async () => ({
      supabase: {},
      user: { email: 'recruiter@hmjglobal.test' },
    }),
    dispatchBackgroundImpl: async (_event, payload) => {
      dispatchedPayload = payload;
    },
  });

  const response = await handler({
    headers: {
      host: 'deploy-preview-100--hmjg.netlify.app',
      'x-forwarded-proto': 'https',
      authorization: 'Bearer fake-token',
    },
    body: JSON.stringify({
      preparedRunId: 'prepared-2',
      recruiterNotes: 'Reuse saved evidence.',
    })
  }, {});

  Object.assign(core, originals);

  assert.equal(response.statusCode, 202);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.prepared_run.id, 'prepared-2');
  assert.equal(payload.queued, true);
  assert.equal(payload.prepared_run.match_job.status, 'queued');
  assert.equal(dispatchedPayload.preparedRunId, 'prepared-2');
});

test('candidate run match background handler completes matching from prepared evidence', async () => {
  const originals = {
    getMatchRun: core.getMatchRun,
    updatePreparedRunJobState: core.updatePreparedRunJobState,
    buildCandidatePayloadFromPreparedRun: core.buildCandidatePayloadFromPreparedRun,
    fetchPublishedLiveJobs: core.fetchPublishedLiveJobs,
    callOpenAIForMatch: core.callOpenAIForMatch,
    updatePreparedRunWithMatch: core.updatePreparedRunWithMatch,
  };

  let getCount = 0;
  core.getMatchRun = async () => {
    getCount += 1;
    return getCount > 1
      ? {
        id: 'prepared-3',
        created_at: '2026-03-13T12:00:00Z',
        updated_at: '2026-03-13T12:15:00Z',
        recruiter_notes: 'Reuse saved evidence.',
        status: 'completed',
        ready_for_match: true,
        has_result: true,
        match_job: { id: 'job-async-1', status: 'completed', started_at: '2026-03-13T12:10:00Z', completed_at: '2026-03-13T12:15:00Z', failed_at: '', last_error: '' },
        prepared_evidence: {
          ready_for_match: true,
          files_attempted: 1,
          files_text_read: 1,
          image_evidence_count: 0,
          limited_count: 0,
          unsupported_count: 0,
          failed_count: 0,
          preview_text: 'Candidate evidence text',
          text_files: [{ name: 'candidate.pdf', status: 'ok', sizeLabel: '1 KB', contentType: 'application/pdf' }],
          image_evidence_files: [],
          limited_files: [],
          unsupported_files: [],
          failed_files: [],
          documents: [{ name: 'candidate.pdf', status: 'ok', size: 1234, contentType: 'application/pdf' }],
        },
        file_names: ['candidate.pdf'],
        files: [{ storage_bucket: 'candidate-matcher-uploads' }],
        best_match_job_title: 'Planner',
        best_match_score: 91,
        raw_result_json: {
          preparation: { combined_candidate_text: 'Candidate evidence text' },
          result: {
            candidate_summary: { name: 'Alex Example' },
            top_matches: [{ job_id: 'job-1', job_title: 'Planner', score: 91, recommendation: 'shortlist', why_match: 'Direct planning experience.', matched_skills: [], matched_qualifications: [], transferable_experience: [], gaps: [], follow_up_questions: [], uncertainty_notes: '' }],
            other_matches: [],
            overall_recommendation: 'Shortlist.',
            general_follow_up_questions: [],
            no_strong_match_reason: '',
          }
        },
      }
      : {
        id: 'prepared-3',
        created_at: '2026-03-13T12:00:00Z',
        updated_at: '2026-03-13T12:10:00Z',
        recruiter_notes: 'Reuse saved evidence.',
        status: 'processing',
        ready_for_match: true,
        has_result: false,
        match_job: { id: 'job-async-1', status: 'queued', queued_at: '2026-03-13T12:10:00Z', started_at: '', completed_at: '', failed_at: '', last_error: '' },
        prepared_evidence: {
          ready_for_match: true,
          files_attempted: 1,
          files_text_read: 1,
          image_evidence_count: 0,
          limited_count: 0,
          unsupported_count: 0,
          failed_count: 0,
          preview_text: 'Candidate evidence text',
          text_files: [{ name: 'candidate.pdf', status: 'ok', sizeLabel: '1 KB', contentType: 'application/pdf' }],
          image_evidence_files: [],
          limited_files: [],
          unsupported_files: [],
          failed_files: [],
          documents: [{ name: 'candidate.pdf', status: 'ok', size: 1234, contentType: 'application/pdf' }],
        },
        file_names: ['candidate.pdf'],
        files: [{ storage_bucket: 'candidate-matcher-uploads' }],
        raw_result_json: { preparation: { combined_candidate_text: 'Candidate evidence text' } },
      };
  };
  core.updatePreparedRunJobState = async () => ({ id: 'prepared-3' });
  core.buildCandidatePayloadFromPreparedRun = () => ({
    recruiter_notes: 'Reuse saved evidence.',
    extraction_summary: [{ name: 'candidate.pdf', status: 'ok' }],
    candidate_text: 'Candidate evidence text',
    candidate_text_truncated: false,
    image_evidence: [],
  });
  core.fetchPublishedLiveJobs = async () => [{ job_id: 'job-1', title: 'Planner', published: true, status: 'live' }];
  core.callOpenAIForMatch = async () => ({
    model: 'gpt-5-mini',
    raw: {},
    result: {
      candidate_summary: { name: 'Alex Example', current_or_recent_title: 'Planner', seniority_level: 'Senior', primary_discipline: 'Project Controls', sectors: [], locations: [], key_skills: [], key_qualifications: [], summary: 'Strong planner.' },
      top_matches: [{ job_id: 'job-1', job_title: 'Planner', score: 91, recommendation: 'shortlist', why_match: 'Direct planning experience.', matched_skills: [], matched_qualifications: [], transferable_experience: [], gaps: [], follow_up_questions: [], uncertainty_notes: '' }],
      other_matches: [],
      overall_recommendation: 'Shortlist.',
      general_follow_up_questions: [],
      no_strong_match_reason: '',
    }
  });
  core.updatePreparedRunWithMatch = async () => ({ id: 'prepared-3' });

  const handler = createCandidateRunMatchBackgroundBaseHandler({
    getContextImpl: async () => ({
      supabase: {},
      user: { email: 'recruiter@hmjglobal.test' },
    })
  });

  const response = await handler({
    body: JSON.stringify({
      preparedRunId: 'prepared-3',
      recruiterNotes: 'Reuse saved evidence.',
      jobId: 'job-async-1',
    })
  }, {});

  Object.assign(core, originals);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.prepared_run.match_job.status, 'completed');
  assert.equal(payload.result.top_matches[0].job_id, 'job-1');
});

test('candidate match status handler returns the latest prepared run state', async () => {
  const original = core.getMatchRun;
  core.getMatchRun = async () => ({
    id: 'prepared-4',
    created_at: '2026-03-13T12:00:00Z',
    updated_at: '2026-03-13T12:16:00Z',
    recruiter_notes: 'Reuse saved evidence.',
    status: 'processing',
    ready_for_match: true,
    has_result: false,
    match_job: { id: 'job-async-2', status: 'running', queued_at: '2026-03-13T12:14:00Z', started_at: '2026-03-13T12:15:00Z', completed_at: '', failed_at: '', last_error: '' },
    prepared_evidence: { ready_for_match: true, files_attempted: 1, files_text_read: 1, image_evidence_count: 0, limited_count: 0, unsupported_count: 0, failed_count: 0, preview_text: 'Candidate evidence text', text_files: [], image_evidence_files: [], limited_files: [], unsupported_files: [], failed_files: [], documents: [] },
    file_names: ['candidate.pdf'],
    raw_result_json: { preparation: { combined_candidate_text: 'Candidate evidence text' } },
  });

  const handler = createCandidateMatchStatusBaseHandler({
    getContextImpl: async () => ({ supabase: {} })
  });

  const response = await handler({ body: JSON.stringify({ preparedRunId: 'prepared-4' }) }, {});
  core.getMatchRun = original;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.prepared_run.match_job.status, 'running');
});

test('candidate match handler returns per-file extraction diagnostics when no file is readable', async () => {
  const originals = {
    prepareCandidateFiles: core.prepareCandidateFiles,
    extractCandidateDocuments: core.extractCandidateDocuments,
  };

  core.prepareCandidateFiles = () => [{
    id: 'file-1',
    name: 'candidate.pdf',
    extension: 'pdf',
    contentType: 'application/pdf',
    size: 2048,
    status: 'ready',
    buffer: Buffer.from('fake'),
    extractedText: '',
    extractedTextLength: 0,
    error: '',
    storageKey: '',
  }];
  core.extractCandidateDocuments = async (documents) => ({
    documents: [{
      ...documents[0],
      status: 'failed',
      error: 'PDF extraction dependency is unavailable on the server. MODULE_NOT_FOUND Cannot find module',
      extractedText: '',
      extractedTextLength: 0,
    }],
    successful: [],
    failed: [{
      ...documents[0],
      status: 'failed',
      error: 'PDF extraction dependency is unavailable on the server. MODULE_NOT_FOUND Cannot find module',
      extractedText: '',
      extractedTextLength: 0,
    }],
    successCount: 0,
    failureCount: 1,
    combinedText: '',
  });

  const handler = createCandidateMatchBaseHandler({
    getContextImpl: async () => ({
      supabase: {},
      user: { email: 'recruiter@hmjglobal.test' },
    })
  });

  const response = await handler({
    body: JSON.stringify({
      files: [{ name: 'candidate.pdf', data: 'ignored' }],
      recruiterNotes: '',
      saveHistory: false,
    })
  }, {});

  Object.assign(core, originals);

  assert.equal(response.statusCode, 422);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'all_files_failed');
  assert.equal(payload.details.stage, 'extraction');
  assert.equal(payload.details.storage_readback, 'not_used');
  assert.equal(Array.isArray(payload.details.documents), true);
  assert.equal(payload.details.documents[0].name, 'candidate.pdf');
  assert.match(payload.details.documents[0].error, /PDF extraction dependency is unavailable/);
});

test('candidate match handler returns stage metadata when OpenAI times out', async () => {
  const originals = {
    prepareCandidateFiles: core.prepareCandidateFiles,
    extractCandidateDocuments: core.extractCandidateDocuments,
    fetchPublishedLiveJobs: core.fetchPublishedLiveJobs,
    maybeStoreUploads: core.maybeStoreUploads,
    callOpenAIForMatch: core.callOpenAIForMatch,
  };

  core.prepareCandidateFiles = () => [{
    id: 'file-1',
    name: 'candidate.pdf',
    extension: 'pdf',
    contentType: 'application/pdf',
    size: 1024,
    status: 'ready',
    buffer: Buffer.from('fake'),
    extractedText: '',
    extractedTextLength: 0,
    error: '',
    storageKey: '',
  }];
  core.extractCandidateDocuments = async (documents) => ({
    documents: [{
      ...documents[0],
      status: 'ok',
      extractedText: 'Candidate text',
      extractedTextLength: 14,
    }],
    successful: [{
      ...documents[0],
      status: 'ok',
      extractedText: 'Candidate text',
      extractedTextLength: 14,
    }],
    failed: [],
    successCount: 1,
    failureCount: 0,
    combinedText: 'Candidate text',
  });
  core.fetchPublishedLiveJobs = async () => [{
    job_id: 'job-1',
    title: 'Live role',
    published: true,
    status: 'live',
  }];
  core.maybeStoreUploads = async () => ({ stored: false, bucket: '', warnings: [] });
  core.callOpenAIForMatch = async () => {
    throw core.coded(504, 'OpenAI candidate matching timed out after 60000ms.', 'openai_timeout', {
      details: {
        stage: 'openai',
        stage_label: 'Run recruiter matching',
        timeout_ms: 60000,
      }
    });
  };

  const handler = createCandidateMatchBaseHandler({
    getContextImpl: async () => ({
      supabase: {},
      user: { email: 'recruiter@hmjglobal.test' },
    })
  });

  const response = await handler({
    body: JSON.stringify({
      files: [{ name: 'candidate.pdf', data: 'ignored' }],
      recruiterNotes: '',
      saveHistory: false,
    })
  }, {});

  Object.assign(core, originals);

  assert.equal(response.statusCode, 504);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'openai_timeout');
  assert.equal(payload.details.stage, 'openai');
  assert.equal(payload.details.stage_label, 'Run recruiter matching');
  assert.equal(payload.details.timeout_ms, 60000);
  assert.equal(Array.isArray(payload.details.timings), true);
});

test('history list handler returns disabled state when no table is configured', async () => {
  const original = core.listMatchRuns;
  core.listMatchRuns = async () => ({ enabled: false, runs: [] });

  const handler = createCandidateHistoryListBaseHandler({
    getContextImpl: async () => ({ supabase: {} })
  });

  const response = await handler({ body: JSON.stringify({ limit: 5 }) }, {});
  core.listMatchRuns = original;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.history_enabled, false);
  assert.deepEqual(payload.runs, []);
});

test('saveMatchRun writes live-schema aligned run and file records', async () => {
  let savedRunPayload = null;
  let savedFilePayload = null;

  const supabase = {
    from(tableName) {
      if (tableName === 'candidate_match_runs') {
        return {
          insert(payload) {
            savedRunPayload = payload;
            return {
              select() {
                return {
                  single: async () => ({
                    data: {
                      id: payload.id,
                      created_at: '2026-03-13T12:00:00Z',
                      candidate_name: payload.candidate_name,
                      best_match_job_id: payload.best_match_job_id,
                      best_match_score: payload.best_match_score,
                      status: payload.status,
                    },
                    error: null,
                  })
                };
              }
            };
          }
        };
      }

      if (tableName === 'candidate_match_files') {
        return {
          insert(payload) {
            savedFilePayload = payload;
            return {
              select: async () => ({
                data: payload.map((row, index) => ({ id: `file-${index + 1}` })),
                error: null,
              })
            };
          }
        };
      }

      throw new Error(`Unexpected table ${tableName}`);
    }
  };

  const result = await core.saveMatchRun({
    supabase,
    runId: 'f0f0f0f0-1111-2222-3333-444444444444',
    actorEmail: 'recruiter@hmjglobal.test',
    recruiterNotes: 'Prioritise contract roles.',
    extraction: {
      successCount: 1,
      failureCount: 1,
      documents: [
        {
          id: 'doc-1',
          name: 'candidate.pdf',
          extension: 'pdf',
          contentType: 'application/pdf',
          size: 1400,
          status: 'ok',
          extractedText: 'Candidate text',
          extractedTextLength: 14,
          storageKey: 'candidate-matcher/f0/run-candidate.pdf',
        },
        {
          id: 'doc-2',
          name: 'cert.doc',
          extension: 'doc',
          contentType: 'application/msword',
          size: 900,
          status: 'unsupported',
          extractedText: '',
          extractedTextLength: 0,
          error: 'Legacy DOC uploads are accepted, but automatic text extraction is not configured for this runtime yet.',
          storageKey: 'candidate-matcher/f0/run-cert.doc',
        }
      ]
    },
    analysisResult: {
      candidate_summary: {
        name: 'Alex Example',
        current_or_recent_title: 'Commissioning Engineer',
        seniority_level: 'Mid-Senior',
        primary_discipline: 'Electrical Commissioning',
        sectors: ['Data Centres'],
        locations: ['London'],
        key_skills: ['HV commissioning'],
        key_qualifications: ['SSSTS'],
        summary: 'Strong site delivery candidate.',
      },
      top_matches: [{
        job_id: 'job-1',
        job_title: 'HV Commissioning Engineer',
        score: 89,
        recommendation: 'shortlist',
        why_match: 'Directly aligned experience.',
        matched_skills: ['HV commissioning'],
        matched_qualifications: ['SSSTS'],
        transferable_experience: [],
        gaps: [],
        follow_up_questions: [],
        uncertainty_notes: '',
      }],
      other_matches: [],
      overall_recommendation: 'Shortlist for recruiter review.',
      general_follow_up_questions: [],
      no_strong_match_reason: '',
    },
    documents: [
      {
        id: 'doc-1',
        name: 'candidate.pdf',
        extension: 'pdf',
        contentType: 'application/pdf',
        size: 1400,
        status: 'ok',
        extractedText: 'Candidate text',
        extractedTextLength: 14,
        storageKey: 'candidate-matcher/f0/run-candidate.pdf',
      },
      {
        id: 'doc-2',
        name: 'cert.doc',
        extension: 'doc',
        contentType: 'application/msword',
        size: 900,
        status: 'unsupported',
        extractedText: '',
        extractedTextLength: 0,
        error: 'Legacy DOC uploads are accepted, but automatic text extraction is not configured for this runtime yet.',
        storageKey: 'candidate-matcher/f0/run-cert.doc',
      }
    ],
    bucket: 'candidate-matcher-uploads',
    liveJobs: [{ job_id: 'job-1', job_slug: 'hv-commissioning-engineer', title: 'HV Commissioning Engineer' }],
    enabled: true,
  });

  assert.equal(result.saved, true);
  assert.equal(savedRunPayload.created_by, null);
  assert.equal(savedRunPayload.best_match_job_slug, 'hv-commissioning-engineer');
  assert.equal(savedRunPayload.best_match_job_title, 'HV Commissioning Engineer');
  assert.equal(savedRunPayload.status, 'completed');
  assert.ok(!('uploaded_file_names' in savedRunPayload));
  assert.deepEqual(core.validateMatcherResultAgainstSchema(savedRunPayload.raw_result_json.result), []);
  assert.equal(Array.isArray(savedFilePayload), true);
  assert.equal(savedFilePayload.length, 2);
  assert.equal(savedFilePayload[0].match_run_id, 'f0f0f0f0-1111-2222-3333-444444444444');
  assert.equal(savedFilePayload[0].storage_bucket, 'candidate-matcher-uploads');
  assert.equal(savedFilePayload[0].extraction_status, 'completed');
  assert.equal(savedFilePayload[1].extraction_status, 'completed');
});

test('listMatchRuns hydrates file names from candidate_match_files', async () => {
  const supabase = {
    from(tableName) {
      if (tableName === 'candidate_match_runs') {
        return {
          select() {
            return {
              order() {
                return {
                  limit: async () => ({
                    data: [{
                      id: 'run-1',
                      created_at: '2026-03-13T12:00:00Z',
                      candidate_name: 'Alex Example',
                      current_or_recent_title: 'Commissioning Engineer',
                      seniority_level: 'Mid-Senior',
                      primary_discipline: 'Electrical Commissioning',
                      recruiter_notes: 'Prioritise contract roles.',
                      extracted_text_summary: 'Strong site delivery candidate.',
                      candidate_summary_json: {
                        name: 'Alex Example',
                        current_or_recent_title: 'Commissioning Engineer',
                        seniority_level: 'Mid-Senior',
                        primary_discipline: 'Electrical Commissioning',
                      },
                      raw_result_json: {
                        result: {
                          candidate_summary: { name: 'Alex Example' },
                          top_matches: [{ job_id: 'job-1', job_title: 'HV Commissioning Engineer', score: 89 }],
                        }
                      },
                      best_match_job_id: 'job-1',
                      best_match_job_slug: 'hv-commissioning-engineer',
                      best_match_job_title: 'HV Commissioning Engineer',
                      best_match_score: 89,
                      overall_recommendation: 'Shortlist',
                      no_strong_match_reason: '',
                      error_message: null,
                      status: 'completed',
                    }],
                    error: null,
                  })
                };
              }
            };
          }
        };
      }

      if (tableName === 'candidate_match_files') {
        return {
          select() {
            return {
              in() {
                return {
                  order: async () => ({
                    data: [{
                      id: 'file-1',
                      match_run_id: 'run-1',
                      original_filename: 'candidate.pdf',
                      mime_type: 'application/pdf',
                      file_size_bytes: 1400,
                      storage_bucket: 'candidate-matcher-uploads',
                      storage_path: 'candidate-matcher/run-1/candidate.pdf',
                      extraction_status: 'completed',
                      extraction_error: null,
                    }],
                    error: null,
                  })
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table ${tableName}`);
    }
  };

  const history = await core.listMatchRuns(supabase, 5);

  assert.equal(history.enabled, true);
  assert.equal(history.runs.length, 1);
  assert.deepEqual(history.runs[0].file_names, ['candidate.pdf']);
  assert.equal(history.runs[0].best_match_job_slug, 'hv-commissioning-engineer');
});
