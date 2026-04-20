const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../lib/sourcing-assistant-core.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');

function makeWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-sourcing-hardening-'));
  fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
  return tempRoot;
}

function roleDir(workspaceRoot, roleId = 'demo-electrical-site-manager') {
  return path.join(workspaceRoot, 'roles', roleId);
}

test('malformed YAML fails clearly', async () => {
  const workspaceRoot = makeWorkspace();
  fs.writeFileSync(path.join(roleDir(workspaceRoot), 'inputs', 'job-spec.yaml'), 'role_id: HMJ\n  broken', 'utf8');

  await assert.rejects(
    core.runRoleWorkspace({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      action: 'run_all',
    }),
    (error) => {
      assert.equal(error.code, 'invalid_job_spec_yaml');
      return true;
    },
  );
});

test('malformed CSV and missing columns fail clearly', () => {
  const workspaceRoot = makeWorkspace();
  core.scaffoldRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'csv-role',
    roleTitle: 'Electrical Site Manager',
  });

  const badCsvPath = path.join(workspaceRoot, 'bad.csv');
  fs.writeFileSync(badCsvPath, 'source,search_variant,candidate_name\nCV-Library,"medium,Joe', 'utf8');
  assert.throws(
    () => core.importPreviewCandidates({ workflowRoot: workspaceRoot, roleId: 'csv-role', inputPath: badCsvPath }),
    /could not be parsed/i,
  );

  const missingColumnCsvPath = path.join(workspaceRoot, 'missing-columns.csv');
  fs.writeFileSync(missingColumnCsvPath, 'source,candidate_name\nCV-Library,Joe', 'utf8');
  assert.throws(
    () => core.importPreviewCandidates({ workflowRoot: workspaceRoot, roleId: 'csv-role', inputPath: missingColumnCsvPath }),
    /missing required column/i,
  );
});

test('duplicate candidate ids are rejected', async () => {
  const workspaceRoot = makeWorkspace();
  const candidatesPath = path.join(roleDir(workspaceRoot), 'inputs', 'candidates.json');
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
  candidates[1].candidate_id = candidates[0].candidate_id;
  fs.writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');

  await assert.rejects(
    core.runRoleWorkspace({
      workflowRoot: workspaceRoot,
      roleId: 'demo-electrical-site-manager',
      action: 'run_all',
    }),
    /duplicated/i,
  );
});

test('missing role folder fails clearly', async () => {
  const workspaceRoot = makeWorkspace();
  await assert.rejects(
    core.runRoleWorkspace({
      workflowRoot: workspaceRoot,
      roleId: 'missing-role',
      action: 'run_all',
    }),
    (error) => {
      assert.equal(error.code, 'missing_role_folder');
      return true;
    },
  );
});

test('invalid lifecycle updates are blocked', async () => {
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
      candidateId: 'cvl-possible-002',
      patch: {
        lifecycle_stage: 'awaiting_reply',
      },
    }),
    /can only follow contacted/i,
  );
});

test('missing CV files become warnings instead of crashing the run', async () => {
  const workspaceRoot = makeWorkspace();
  const candidatesPath = path.join(roleDir(workspaceRoot), 'inputs', 'candidates.json');
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
  candidates[0].cv_file = 'cvs/missing-file.txt';
  fs.writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');

  const summary = await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const record = JSON.parse(fs.readFileSync(path.join(roleDir(workspaceRoot), 'records', 'cvl-strong-001.json'), 'utf8'));
  assert.equal(record.full_cv.review_status, 'error');
  assert.match(record.full_cv.error_message, /CV file not found/i);
  assert.equal(summary.runSummary.warning_count, 1);
});

test('reruns are idempotent and remove stale record artifacts', async () => {
  const workspaceRoot = makeWorkspace();
  const rolePath = roleDir(workspaceRoot);
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const metricsFirst = JSON.parse(fs.readFileSync(path.join(rolePath, 'outputs', 'metrics.json'), 'utf8'));
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });
  const metricsSecond = JSON.parse(fs.readFileSync(path.join(rolePath, 'outputs', 'metrics.json'), 'utf8'));
  assert.deepEqual(metricsSecond, metricsFirst);

  const candidatesPath = path.join(rolePath, 'inputs', 'candidates.json');
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8')).slice(0, 1);
  fs.writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  assert.equal(fs.existsSync(path.join(rolePath, 'records', 'cvl-possible-002.json')), false);
  assert.equal(fs.existsSync(path.join(rolePath, 'drafts', 'cvl-possible-002.md')), false);
});

test('importing the same preview CSV twice is a stable replace operation', () => {
  const workspaceRoot = makeWorkspace();
  const roleId = 'csv-role';
  const created = core.scaffoldRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId,
    roleTitle: 'Electrical Site Manager',
  });
  fs.copyFileSync(
    path.join(roleDir(workspaceRoot), 'inputs', 'job-spec.yaml'),
    path.join(created.roleDir, 'inputs', 'job-spec.yaml'),
  );

  const csvPath = path.join(fixtureRoot, 'samples', 'candidate-previews.csv');
  const first = core.importPreviewCandidates({ workflowRoot: workspaceRoot, roleId, inputPath: csvPath });
  const second = core.importPreviewCandidates({ workflowRoot: workspaceRoot, roleId, inputPath: csvPath });

  assert.equal(first.mode, 'replace');
  assert.equal(second.unchanged, true);
});

test('corrupted dashboard summary recovers from persisted record files', async () => {
  const workspaceRoot = makeWorkspace();
  const rolePath = roleDir(workspaceRoot);
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  fs.writeFileSync(path.join(rolePath, 'outputs', 'dashboard-summary.json'), '{broken', 'utf8');
  const summary = core.summariseRoleFromDisk(workspaceRoot, 'demo-electrical-site-manager');
  assert.equal(summary.roleTitle, 'Electrical Site Manager');
  assert.equal(summary.metrics.profiles_reviewed, 4);
});

test('repeat-usage smoke run preserves operator state across reruns', async () => {
  const workspaceRoot = makeWorkspace();
  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  await core.updateCandidateOperatorState({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    candidateId: 'cvl-strong-001',
    patch: {
      decision: 'contacted',
      lifecycle_stage: 'contacted',
      manual_notes: 'Intro sent manually.',
      override_reason: 'Contacted after review',
    },
  });

  await core.runRoleWorkspace({
    workflowRoot: workspaceRoot,
    roleId: 'demo-electrical-site-manager',
    action: 'run_all',
  });

  const record = JSON.parse(fs.readFileSync(path.join(roleDir(workspaceRoot), 'records', 'cvl-strong-001.json'), 'utf8'));
  assert.equal(record.lifecycle.current_stage, 'contacted');
  assert.equal(record.operator_review.history.length, 1);
});
