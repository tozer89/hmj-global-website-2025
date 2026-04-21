const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../lib/sourcing-assistant-core.js');
const { parseYaml } = require('../lib/simple-yaml.js');
const { PRINT_TO_PDF_BASE64 } = require('./fixtures/print-to-pdf.fixture.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');
const fixtureRoleDir = path.join(fixtureRoot, 'roles', 'demo-electrical-site-manager');
const READABLE_DOCX_BASE64 = 'UEsDBBQAAAAIAIBybVzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgAgHJtXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgAgHJtXEjS6NmyAAAA7AAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDWOwQrCMBBE737FkrumehApbXpQRAQRRMFrbFYtNLshiVb/3qTg5THDwNutmo/t4Y0+dEy1mM8KAUgtm44etbict9OVgBA1Gd0zYS2+GESjJtVQGm5fFilCMlAoh1o8Y3SllKF9otVhxg4pbXf2VsdU/UMO7I3z3GII6YDt5aIoltLqjoSaACTrjc03x7E4leAzojqhNvrWI+wOe9gc11eI+ImVzFumH+lGjfx7cvr/qX5QSwECFAMUAAAACACAcm1c13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAIBybVwgG4bqsgAAAC4BAAALAAAAAAAAAAAAAACAASIBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAIBybVxI0ujZsgAAAOwAAAARAAAAAAAAAAAAAACAAf0BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADeAgAAAAA=';

function makeWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-sourcing-'));
  fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
  return tempRoot;
}

test('job spec normalization reads the structured intake shape cleanly', () => {
  const jobSpecPath = path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml');
  const raw = parseYaml(fs.readFileSync(jobSpecPath, 'utf8'));
  const job = core.normaliseJobSpecIntake(raw);

  assert.equal(job.roleId, 'HMJ-ROLE-ESM-001');
  assert.equal(job.title.canonical, 'Electrical Site Manager');
  assert.equal(job.location.base, 'Leeds');
  assert.deepEqual(job.mustHave.skills, [
    'site delivery',
    'electrical package management',
    'subcontractor coordination',
  ]);
  assert.ok(job.title.synonyms.includes('construction manager'));
});

test('search-pack generation builds usable booleans and synonym packs', () => {
  const raw = parseYaml(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml'), 'utf8'));
  const job = core.normaliseJobSpecIntake(raw);
  const searchPack = core.generateSearchPack(job);

  assert.match(searchPack.primaryBoolean, /Electrical Site Manager|Electrical Construction Manager/i);
  assert.match(searchPack.variants.narrow.boolean, /NOT/i);
  assert.ok(searchPack.titleSynonymPack.includes('construction manager'));
  assert.equal(searchPack.searchPriority.length, 3);
});

test('preview triage classifies strong and reject candidates with reasons', () => {
  const raw = parseYaml(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml'), 'utf8'));
  const job = core.normaliseJobSpecIntake(raw);
  const candidates = JSON.parse(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'candidates.json'), 'utf8'));
  const strong = core.scorePreviewCandidate(job, candidates[0]);
  const reject = core.scorePreviewCandidate(job, candidates[3]);

  assert.equal(strong.finalClassification, 'strong_open');
  assert.ok(strong.reasons.some((entry) => /Direct title evidence/i.test(entry)));
  assert.equal(reject.finalClassification, 'reject');
  assert.ok(reject.hardRejectReasons.some((entry) => /Excluded title pattern/i.test(entry)));
});

test('full CV review returns a structured suitability summary', () => {
  const raw = parseYaml(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml'), 'utf8'));
  const job = core.normaliseJobSpecIntake(raw);
  const candidate = JSON.parse(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'candidates.json'), 'utf8'))[0];
  const cvText = fs.readFileSync(path.join(fixtureRoleDir, 'cvs', 'andrei-popescu.txt'), 'utf8');
  const review = core.reviewFullCv(job, candidate, cvText);

  assert.equal(review.shortlistRecommendation, 'strong');
  assert.ok(Array.isArray(review.extractedHighlights));
  assert.ok(review.strengths.length >= 1);
  assert.ok(Array.isArray(review.followUpQuestions));
});

test('outreach draft generation stays draft-only and role-specific', () => {
  const raw = parseYaml(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml'), 'utf8'));
  const job = core.normaliseJobSpecIntake(raw);
  const candidate = JSON.parse(fs.readFileSync(path.join(fixtureRoleDir, 'inputs', 'candidates.json'), 'utf8'))[0];
  const cvText = fs.readFileSync(path.join(fixtureRoleDir, 'cvs', 'andrei-popescu.txt'), 'utf8');
  const review = core.reviewFullCv(job, candidate, cvText);
  const draft = core.buildOutreachDraft(job, candidate, review);

  assert.match(draft.subject, /Electrical Site Manager/i);
  assert.match(draft.body, /Before I send over fuller details/i);
  assert.ok(draft.questions.length >= 1);
});

test('end-to-end role run writes records, drafts, metrics, and summaries', async () => {
  const workspaceRoot = makeWorkspace();
  const summary = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  const metricsPath = path.join(roleDir, 'outputs', 'metrics.json');
  const recordsPath = path.join(roleDir, 'outputs', 'candidate-records.json');
  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));

  assert.equal(summary.metrics.preview_counts.strong_open, 1);
  assert.equal(summary.metrics.preview_counts.maybe_open, 1);
  assert.equal(summary.metrics.preview_counts.reject, 2);
  assert.equal(metrics.cvs_downloaded, 2);
  assert.equal(metrics.shortlist_counts.strong, 1);
  assert.equal(metrics.shortlist_counts.possible, 1);
  assert.equal(metrics.viable_outreach_candidates, 2);
  assert.equal(metrics.outreach_drafts_prepared, 2);
  assert.equal(metrics.lifecycle_counts.outreach_drafted, 2);
  assert.equal(records.length, 4);
  assert.ok(fs.existsSync(path.join(roleDir, 'drafts', 'cvl-strong-001.md')));
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'search-pack.md')));
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'metrics-summary.md')));
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'candidate-review-export.csv')));
  assert.ok(fs.existsSync(path.join(roleDir, 'records', 'cvl-possible-002.json')));
  assert.ok(summary.artifacts.dashboardSummary.last_updated);
});

test('operator updates persist cleanly and drive lifecycle changes', async () => {
  const workspaceRoot = makeWorkspace();
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const update = await core.updateCandidateOperatorState({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    candidateId: 'cvl-possible-002',
    patch: {
      decision: 'manual_screened',
      shortlist_status: 'possible_shortlist',
      shortlist_bucket: 'backup',
      ranking_pin: true,
      lifecycle_stage: 'contacted',
      manual_notes: 'Spoke briefly and sent the outline for a Leeds discussion.',
      strengths: ['Strong electrical package delivery background'],
      concerns: ['Rate still to confirm'],
      follow_up_questions: ['Can he be in Leeds 4 days a week?'],
      appetite_notes: 'Open to hearing about a move from current project.',
      availability_notes: 'Could interview next week.',
      compensation_notes: 'Current rate still to confirm.',
      location_mobility_notes: 'Comfortable with Leeds-based travel.',
      manual_screening_summary: 'Manual screen completed after reviewing the CV and speaking briefly.',
      recommended_next_step: 'Book formal screening call',
      recruiter_confidence: 'high',
      final_manual_rationale: 'Worth keeping warm as a credible backup shortlist option.',
      override_reason: 'Manual review after phone conversation',
    },
  });

  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  const record = JSON.parse(fs.readFileSync(path.join(roleDir, 'records', 'cvl-possible-002.json'), 'utf8'));
  const metrics = JSON.parse(fs.readFileSync(path.join(roleDir, 'outputs', 'metrics.json'), 'utf8'));

  assert.deepEqual(update.changedFields.sort(), [
    'appetite_notes',
    'availability_notes',
    'compensation_notes',
    'concerns',
    'decision',
    'final_manual_rationale',
    'follow_up_questions',
    'lifecycle_stage',
    'location_mobility_notes',
    'manual_notes',
    'manual_screening_summary',
    'ranking_pin',
    'recommended_next_step',
    'recruiter_confidence',
    'override_reason',
    'shortlist_bucket',
    'shortlist_status',
    'strengths',
  ].sort());
  assert.equal(record.operator_review.decision, 'manual_screened');
  assert.equal(record.lifecycle.current_stage, 'contacted');
  assert.equal(record.status.needs_operator_review, false);
  assert.equal(record.operator_review.history.length, 1);
  assert.equal(record.operator_review.shortlist_bucket, 'backup');
  assert.equal(record.operator_review.ranking_pin, true);
  assert.equal(record.operator_review.recruiter_confidence, 'high');
  assert.equal(record.ranking.pinned, true);
  assert.equal(metrics.lifecycle_counts.contacted, 1);
  assert.equal(metrics.operator_overrides, 1);
});

test('CSV import and export support recruiter-friendly review flows', async () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'csv-import-role';
  const created = core.scaffoldRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    roleTitle: 'Electrical Site Manager',
  });
  const sourceRoleDir = path.join(fixtureRoot, 'roles', 'demo-electrical-site-manager');
  fs.copyFileSync(
    path.join(sourceRoleDir, 'inputs', 'job-spec.yaml'),
    path.join(created.roleDir, 'inputs', 'job-spec.yaml'),
  );
  fs.cpSync(path.join(sourceRoleDir, 'cvs'), path.join(created.roleDir, 'cvs'), { recursive: true });

  const importResult = core.importPreviewCandidates({
    workflowRoot: workspaceRoot,
    roleId,
    inputPath: path.join(fixtureRoot, 'samples', 'candidate-previews.csv'),
  });

  assert.equal(importResult.importedCount, 2);

  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'run_all',
  });

  const exportResult = core.exportCandidateReviewsCsv({
    workflowRoot: workspaceRoot,
    roleId,
  });
  const exportText = fs.readFileSync(exportResult.outputPath, 'utf8');

  assert.equal(exportResult.exportedCount, 2);
  assert.match(exportText, /lifecycle_stage/);
  assert.match(exportText, /source_url/);
  assert.match(exportText, /cvl-strong-001/);
});

test('role index gives an at-a-glance operational summary', async () => {
  const workspaceRoot = makeWorkspace();
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const index = core.listRoleIndex(workspaceRoot);
  assert.equal(index.length, 1);
  assert.equal(index[0].role_title, 'Electrical Site Manager');
  assert.equal(index[0].previews_processed, 4);
  assert.equal(index[0].cvs_reviewed, 2);
  assert.equal(index[0].shortlist_count, 2);
  assert.equal(index[0].outreach_drafts_prepared, 2);
  assert.equal(index[0].current_kpi, 2);
});

test('dashboard summary exposes ranked candidate detail, outreach draft visibility, and source audit fields', async () => {
  const workspaceRoot = makeWorkspace();
  const updatedBatchPath = path.join(workspaceRoot, 'updated-previews.json');
  fs.writeFileSync(updatedBatchPath, `${JSON.stringify([
    {
      candidate_id: 'cvl-possible-002',
      source: 'CV-Library',
      source_reference_id: 'CVL-POSSIBLE-002',
      search_variant: 'medium',
      candidate_name: 'Tom Gallagher',
      current_title: 'Electrical Construction Manager',
      location: 'Leeds',
      summary_text: 'Updated preview text for Tom Gallagher with clearer data centre delivery evidence.',
      email: 'tom.gallagher@example.com',
    },
  ], null, 2)}\n`, 'utf8');
  core.importPreviewCandidates({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    inputPath: updatedBatchPath,
  });
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const summary = core.summariseRoleFromDisk(workspaceRoot, 'demo-electrical-site-manager');
  const candidate = summary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-strong-001');
  const changedCandidate = summary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-possible-002');

  assert.equal(summary.shortlistProgress.target, 10);
  assert.equal(summary.roleState, 'outreach_ready');
  assert.ok(candidate.ranking.position >= 1);
  assert.equal(candidate.identity.email, 'andrei.popescu@example.com');
  assert.equal(candidate.sourceAudit.source_reference_id, 'CVL-STRONG-001');
  assert.match(candidate.sourceAudit.display, /CV-Library/i);
  assert.match(candidate.outreach.subject, /Electrical Site Manager/i);
  assert.ok(candidate.artifacts.candidateRecord.exists);
  assert.ok(candidate.artifacts.outreachDraft.exists);
  assert.ok(summary.roleHistory.importHistory.length >= 1);
  assert.ok(summary.roleHistory.runHistory.length >= 1);
  assert.equal(changedCandidate.sessionFlags.changed_since_last_import, true);
  assert.equal(changedCandidate.changeReview.import_change.change_type, 'updated');
  assert.ok(changedCandidate.changeReview.import_change.changed_fields.includes('summary_text'));
  assert.ok(!changedCandidate.changeReview.import_change.changed_fields.includes('source_url'));
  assert.match(changedCandidate.sourceAudit.source_url, /cv-library/i);
  assert.match(changedCandidate.changeReview.import_change.current_preview_excerpt, /Updated preview text/i);
  assert.ok((summary.roleHistory.recentActivity || []).length >= 2);
});

test('role config updates feed through to summary and shortlist thresholds', async () => {
  const workspaceRoot = makeWorkspace();
  const update = await core.updateRoleConfig({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    patch: {
      shortlist_target_size: 6,
      shortlist_mode: 'strict',
      minimum_shortlist_score: 55,
      minimum_draft_score: 70,
    },
  });

  assert.equal(update.role.roleConfig.shortlist_target_size, 6);
  assert.equal(update.role.shortlistProgress.target, 6);
  assert.equal(update.role.roleConfig.shortlist_mode, 'strict');
  assert.equal(update.role.runSummary.role_config.minimum_draft_score, 70);
});

test('contact logging updates candidate lifecycle and preserves audit events', async () => {
  const workspaceRoot = makeWorkspace();
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const result = await core.logCandidateContactState({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    candidateId: 'cvl-strong-001',
    stage: 'contacted',
    date: '2026-04-20',
    note: 'Sent initial outreach manually.',
    messageSummary: 'Shared role summary and asked for availability.',
  });

  const summary = core.summariseRoleFromDisk(workspaceRoot, 'demo-electrical-site-manager');
  const candidate = summary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-strong-001');

  assert.equal(result.contactEvent.stage, 'contacted');
  assert.equal(candidate.lifecycle.current_stage, 'contacted');
  assert.equal(candidate.operatorReview.contact_log.length, 1);
  assert.ok(candidate.auditTrail.some((entry) => entry.stage === 'contacted'));
});

test('bulk CV import parses readable PDF and DOCX files into the sourcing workflow', async () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'bulk-cv-role';
  const created = core.scaffoldRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    roleTitle: 'Electrical Site Manager',
  });
  fs.copyFileSync(
    path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml'),
    path.join(created.roleDir, 'inputs', 'job-spec.yaml'),
  );

  const uploadResult = await core.importBulkCvFiles({
    workflowRoot: workspaceRoot,
    roleId,
    files: [
      {
        name: 'jane-candidate.pdf',
        contentType: 'application/pdf',
        size: Buffer.byteLength(Buffer.from(PRINT_TO_PDF_BASE64, 'base64')),
        data: PRINT_TO_PDF_BASE64,
      },
      {
        name: 'readable-docx.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: Buffer.byteLength(Buffer.from(READABLE_DOCX_BASE64, 'base64')),
        data: READABLE_DOCX_BASE64,
      },
    ],
  });

  assert.equal(uploadResult.successfulCount, 2);
  assert.equal(uploadResult.failedCount, 0);
  assert.equal(uploadResult.importResult.importedCount, 2);

  const summary = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'review_downloaded_cvs',
  });
  const candidates = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'inputs', 'candidates.json'), 'utf8'));
  const bulkHistory = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'outputs', core.DEFAULT_BULK_CV_IMPORT_HISTORY_FILE), 'utf8'));
  const jane = summary.candidateDetails.find((entry) => /Jane Candidate/i.test(entry.identity?.name || ''));

  assert.equal(candidates.length, 2);
  assert.equal(bulkHistory[0].parsed_successfully, 2);
  assert.equal(bulkHistory[0].failed, 0);
  assert.ok(candidates.every((candidate) => candidate.import_method === 'bulk_cv_upload'));
  assert.ok(candidates.every((candidate) => String(candidate.cv_file || '').includes('cvs/bulk-upload/')));
  assert.equal(summary.metrics.cvs_downloaded, 2);
  assert.ok(jane);
  assert.match(jane.fullCv.extraction_summary, /bulk CV batch|inline CV text/i);
  assert.equal(jane.sourceAudit.import_method, 'bulk_cv_upload');
});

test('bulk CV import records unreadable or unsupported files without creating bad candidates', async () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'bulk-cv-failure-role';
  const created = core.scaffoldRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    roleTitle: 'Electrical Site Manager',
  });
  fs.copyFileSync(
    path.join(fixtureRoleDir, 'inputs', 'job-spec.yaml'),
    path.join(created.roleDir, 'inputs', 'job-spec.yaml'),
  );

  const uploadResult = await core.importBulkCvFiles({
    workflowRoot: workspaceRoot,
    roleId,
    files: [
      {
        name: 'legacy-profile.doc',
        contentType: 'application/msword',
        size: 6,
        data: Buffer.from('legacy', 'utf8').toString('base64'),
      },
    ],
  });

  const candidates = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'inputs', 'candidates.json'), 'utf8'));
  const bulkHistory = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'outputs', core.DEFAULT_BULK_CV_IMPORT_HISTORY_FILE), 'utf8'));

  assert.equal(uploadResult.successfulCount, 0);
  assert.equal(uploadResult.failedCount, 1);
  assert.equal(uploadResult.importResult, null);
  assert.equal(candidates.length, 0);
  assert.equal(bulkHistory[0].failed, 1);
  assert.match(bulkHistory[0].files[0].error, /legacy DOC|automatic text extraction is not configured/i);
});
