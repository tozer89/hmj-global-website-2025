const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../lib/sourcing-assistant-core.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');
const websiteRepoPath = path.join(__dirname, '..');

function makeWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-sourcing-hardening-'));
  fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'launcher-config.json'), `${JSON.stringify({
    websiteRepoPath,
    dashboardPort: 4287,
  }, null, 2)}\n`, 'utf8');
  return tempRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('runRoleWorkspace fails clearly for malformed YAML job specs', async () => {
  const workspaceRoot = makeWorkspace();
  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  fs.writeFileSync(path.join(roleDir, 'inputs', 'job-spec.yaml'), 'role_id: HMJ-ROLE-ESM-001\n  broken: true\n', 'utf8');

  await assert.rejects(
    core.runRoleWorkspace({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      action: 'run_all',
    }),
    (error) => {
      assert.match(error.message, /could not be parsed/i);
      assert.equal(error.code, 'invalid_job_spec_yaml');
      return true;
    },
  );
});

test('preview CSV import rejects malformed files and missing required columns', () => {
  const workspaceRoot = makeWorkspace();
  const malformedCsvPath = path.join(workspaceRoot, 'bad.csv');
  const missingColumnsCsvPath = path.join(workspaceRoot, 'missing-columns.csv');

  fs.writeFileSync(malformedCsvPath, 'candidate_id,source,search_variant\ncvl-1,"unterminated\n', 'utf8');
  fs.writeFileSync(missingColumnsCsvPath, 'candidate_id,candidate_name\ncvl-1,Jane Doe\n', 'utf8');

  assert.throws(
    () => core.importPreviewCandidates({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      inputPath: malformedCsvPath,
    }),
    (error) => {
      assert.equal(error.code, 'invalid_candidate_csv');
      assert.match(error.message, /could not be parsed/i);
      return true;
    },
  );

  assert.throws(
    () => core.importPreviewCandidates({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      inputPath: missingColumnsCsvPath,
    }),
    (error) => {
      assert.equal(error.code, 'invalid_candidate_csv');
      assert.match(error.message, /missing required column/i);
      return true;
    },
  );
});

test('candidate imports reject duplicate candidate ids', () => {
  const workspaceRoot = makeWorkspace();
  const duplicateJsonPath = path.join(workspaceRoot, 'duplicates.json');

  fs.writeFileSync(duplicateJsonPath, `${JSON.stringify([
    {
      candidate_id: 'dup-001',
      source: 'CV-Library',
      search_variant: 'medium',
      candidate_name: 'Jane Doe',
      current_title: 'Electrical Site Manager',
    },
    {
      candidate_id: 'dup-001',
      source: 'CV-Library',
      search_variant: 'medium',
      candidate_name: 'John Doe',
      current_title: 'Electrical Supervisor',
    },
  ], null, 2)}\n`, 'utf8');

  assert.throws(
    () => core.importPreviewCandidates({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      inputPath: duplicateJsonPath,
    }),
    (error) => {
      assert.equal(error.code, 'invalid_candidate_json');
      assert.match(JSON.stringify(error.details), /duplicated/i);
      return true;
    },
  );
});

test('missing role folders fail with a clear operator-facing error', async () => {
  const workspaceRoot = makeWorkspace();

  await assert.rejects(
    core.runRoleWorkspace({
      workflowRoot: workspaceRoot,
      roleId: 'missing-role',
      action: 'run_all',
    }),
    (error) => {
      assert.equal(error.code, 'missing_role_folder');
      assert.match(error.message, /Role folder was not found/i);
      return true;
    },
  );
});

test('invalid lifecycle updates are rejected before records become contradictory', async () => {
  const workspaceRoot = makeWorkspace();
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  await assert.rejects(
    core.updateCandidateOperatorState({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      candidateId: 'cvl-reject-004',
      patch: {
        shortlist_status: 'possible_shortlist',
        lifecycle_stage: 'possible_shortlist',
        override_reason: 'Trying to force a reject through.',
      },
    }),
    (error) => {
      assert.equal(error.code, 'invalid_operator_update');
      assert.match(JSON.stringify(error.details), /Shortlist status cannot be set before a completed CV review exists/i);
      return true;
    },
  );
});

test('missing CV files become warnings instead of crashing the whole run', async () => {
  const workspaceRoot = makeWorkspace();
  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  const candidatesPath = path.join(roleDir, 'inputs', 'candidates.json');
  const candidates = readJson(candidatesPath);
  candidates[0].cv_file = 'cvs/does-not-exist.txt';
  fs.writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');

  const summary = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const record = readJson(path.join(roleDir, 'records', 'cvl-strong-001.json'));
  assert.equal(summary.runSummary.status, 'completed_with_warnings');
  assert.equal(summary.runSummary.warning_count, 1);
  assert.equal(record.full_cv.review_status, 'error');
  assert.match(record.full_cv.error_message, /not found/i);
});

test('repeat imports dedupe cleanly, merge into a cumulative pool, and reruns remove stale records and drafts', async () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'csv-role';
  const role = core.scaffoldRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    roleTitle: 'Electrical Site Manager',
  });
  const sourceRoleDir = path.join(fixtureRoot, 'roles', 'demo-electrical-site-manager');
  fs.copyFileSync(
    path.join(sourceRoleDir, 'inputs', 'job-spec.yaml'),
    path.join(role.roleDir, 'inputs', 'job-spec.yaml'),
  );
  fs.cpSync(path.join(sourceRoleDir, 'cvs'), path.join(role.roleDir, 'cvs'), { recursive: true });

  const importPath = path.join(fixtureRoot, 'samples', 'candidate-previews.csv');
  const firstImport = core.importPreviewCandidates({
    workflowRoot: workspaceRoot,
    roleId,
    inputPath: importPath,
  });
  const secondImport = core.importPreviewCandidates({
    workflowRoot: workspaceRoot,
    roleId,
    inputPath: importPath,
  });

  assert.equal(firstImport.unchanged, false);
  assert.equal(firstImport.mode, 'merge_upsert');
  assert.equal(secondImport.unchanged, true);
  assert.equal(secondImport.totalCandidates, 2);
  const importHistory = readJson(path.join(role.roleDir, 'outputs', 'import-history.json'));
  assert.equal(importHistory.length, 2);
  assert.equal(importHistory[0].added.count, 2);
  assert.equal(importHistory[1].unchanged, true);

  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'run_all',
  });
  const firstRunHistory = readJson(path.join(role.roleDir, 'outputs', 'run-history.json'));
  assert.equal(firstRunHistory.length, 1);
  assert.equal(firstRunHistory[0].changes.added.count, 2);

  const candidatesPath = path.join(role.roleDir, 'inputs', 'candidates.json');
  const remainingCandidate = readJson(candidatesPath).slice(0, 1);
  fs.writeFileSync(candidatesPath, `${JSON.stringify(remainingCandidate, null, 2)}\n`, 'utf8');

  const rerun = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'run_all',
  });

  assert.equal(rerun.metrics.profiles_reviewed, 1);
  assert.equal(fs.existsSync(path.join(role.roleDir, 'records', 'cvl-possible-002.json')), false);
  assert.equal(fs.existsSync(path.join(role.roleDir, 'drafts', 'cvl-possible-002.md')), false);
  const secondRunHistory = readJson(path.join(role.roleDir, 'outputs', 'run-history.json'));
  assert.equal(secondRunHistory.length, 2);
  assert.equal(secondRunHistory[1].changes.removed.count, 1);
});

test('partial imports preserve existing source evidence when updated rows omit optional fields', () => {
  const workspaceRoot = makeWorkspace();
  const result = core.importPreviewCandidatesFromText({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    fileName: 'partial-update.csv',
    text: [
      'candidate_id,source,source_reference_id,search_variant,candidate_name,current_title,location,summary_text,email',
      'cvl-possible-002,CV-Library,CVL-POSSIBLE-002,medium,James Byrne,Electrical Supervisor,Bradford,Updated preview text only,james.byrne@example.com',
    ].join('\n'),
  });

  const candidates = readJson(path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager', 'inputs', 'candidates.json'));
  const updated = candidates.find((entry) => entry.candidate_id === 'cvl-possible-002');
  const latestHistory = readJson(path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager', 'outputs', 'import-history.json')).slice(-1)[0];
  const change = latestHistory.candidate_changes.find((entry) => entry.candidate_id === 'cvl-possible-002');

  assert.equal(result.importHistoryEntry.updated.count, 1);
  assert.match(updated.source_url, /cv-library/i);
  assert.match(updated.boolean_used, /Electrical Site Manager/i);
  assert.equal(updated.summary_text, 'Updated preview text only');
  assert.ok(!change.changed_fields.includes('source_url'));
  assert.ok(!change.changed_fields.includes('boolean_used'));
});

test('operator updates are idempotent when the same patch is applied twice', async () => {
  const workspaceRoot = makeWorkspace();
  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const first = await core.updateCandidateOperatorState({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    candidateId: 'cvl-possible-002',
    patch: {
      decision: 'manual_screened',
      shortlist_status: 'possible_shortlist',
      lifecycle_stage: 'contacted',
      manual_notes: 'Called and sent the role outline.',
      override_reason: 'Phone screen completed',
    },
  });
  const second = await core.updateCandidateOperatorState({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    candidateId: 'cvl-possible-002',
    patch: {
      decision: 'manual_screened',
      shortlist_status: 'possible_shortlist',
      lifecycle_stage: 'contacted',
      manual_notes: 'Called and sent the role outline.',
      override_reason: 'Phone screen completed',
    },
  });

  const record = readJson(path.join(roleDir, 'records', 'cvl-possible-002.json'));
  assert.equal(first.unchanged, false);
  assert.equal(second.unchanged, true);
  assert.equal(record.operator_review.history.length, 1);
});

test('triage-only reruns preserve previous CV review and outreach state for existing candidates', async () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'demo-electrical-site-manager';
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'run_all',
  });

  const summary = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'run_preview_triage',
  });

  const candidate = summary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-strong-001');
  assert.equal(candidate.fullCv.review_status, 'completed');
  assert.equal(candidate.outreach.ready, true);
  assert.equal(candidate.artifacts.outreachDraft.exists, true);
});

test('dashboard summaries recover from corrupted output files', async () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'demo-electrical-site-manager';
  const roleDir = path.join(workspaceRoot, 'roles', roleId);

  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    action: 'run_all',
  });

  fs.writeFileSync(path.join(roleDir, 'outputs', 'dashboard-summary.json'), '{\n', 'utf8');
  const summary = core.summariseRoleFromDisk(workspaceRoot, roleId);

  assert.equal(summary.roleId, 'HMJ-ROLE-ESM-001');
  assert.equal(summary.candidateReviews.length, 4);
  assert.equal(summary.metrics.profiles_reviewed, 4);
});

test('health checks surface broken launcher-config files without throwing', () => {
  const workspaceRoot = makeWorkspace();
  fs.writeFileSync(path.join(workspaceRoot, 'launcher-config.json'), '{\n', 'utf8');

  const health = core.runHealthCheck(workspaceRoot);
  assert.equal(health.ok, false);
  assert.equal(health.checks.launcher_config_valid, false);
  assert.match(health.issues.join('\n'), /launcher-config\.json is invalid/i);
});

test('repeated smoke usage over one role keeps outputs stable and current', async () => {
  const workspaceRoot = makeWorkspace();
  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  const secondBatchPath = path.join(workspaceRoot, 'batch-2.json');
  fs.writeFileSync(secondBatchPath, `${JSON.stringify([
    {
      candidate_id: 'cvl-possible-002',
      source: 'CV-Library',
      source_reference_id: 'CVL-POSSIBLE-002',
      search_variant: 'medium',
      candidate_name: 'Tom Gallagher',
      current_title: 'Electrical Construction Manager',
      location: 'Leeds',
      summary_text: 'Tom Gallagher updated preview text with stronger mission critical evidence and clearer relocation flexibility.',
      email: 'tom.gallagher@example.com',
    },
  ], null, 2)}\n`, 'utf8');

  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });
  await core.updateCandidateOperatorState({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    candidateId: 'cvl-possible-002',
    patch: {
      decision: 'manual_screened',
      shortlist_status: 'possible_shortlist',
      shortlist_bucket: 'backup',
      lifecycle_stage: 'contacted',
      manual_notes: 'Operator reviewed and made contact.',
      manual_screening_summary: 'Manual screen completed inside repeated smoke test.',
      override_reason: 'Smoke test update',
    },
  });
  core.importPreviewCandidates({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    inputPath: secondBatchPath,
  });
  core.exportCandidateReviewsCsv({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
  });
  const rerun = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const runSummary = readJson(path.join(roleDir, 'outputs', core.DEFAULT_RUN_SUMMARY_FILE));
  const metrics = readJson(path.join(roleDir, 'outputs', 'metrics.json'));
  const record = readJson(path.join(roleDir, 'records', 'cvl-possible-002.json'));
  const importHistory = readJson(path.join(roleDir, 'outputs', 'import-history.json'));
  const runHistory = readJson(path.join(roleDir, 'outputs', 'run-history.json'));
  const dashboardSummary = core.summariseRoleFromDisk(workspaceRoot, 'demo-electrical-site-manager');

  assert.equal(rerun.runSummary.status, 'completed');
  assert.equal(runSummary.status, 'completed');
  assert.equal(metrics.lifecycle_counts.contacted, 1);
  assert.equal(record.lifecycle.current_stage, 'contacted');
  assert.equal(record.operator_review.shortlist_bucket, 'backup');
  assert.equal(record.operator_review.manual_screening_summary, 'Manual screen completed inside repeated smoke test.');
  assert.ok(importHistory.length >= 1);
  assert.ok(runHistory.length >= 2);
  assert.equal(dashboardSummary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-possible-002').sessionFlags.changed_since_last_import, true);
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'candidate-review-export.csv')));
});
