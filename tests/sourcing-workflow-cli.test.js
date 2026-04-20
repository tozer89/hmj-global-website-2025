const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cliPath = path.join(__dirname, '..', 'scripts', 'run-sourcing-workflow.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');

function makeWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-sourcing-cli-'));
  fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
  return tempRoot;
}

function runCli(workspaceRoot, args) {
  return spawnSync(process.execPath, [cliPath, ...args, '--workflow-root', workspaceRoot], {
    encoding: 'utf8',
  });
}

test('CLI init-role scaffolds a new role folder', () => {
  const workspaceRoot = makeWorkspace();
  const result = runCli(workspaceRoot, ['init-role', '--role-id', 'new-role', '--role-title', 'Planner']);
  assert.equal(result.status, 0, result.stderr);

  const roleDir = path.join(workspaceRoot, 'roles', 'new-role');
  assert.ok(fs.existsSync(path.join(roleDir, 'inputs', 'job-spec.yaml')));
  assert.ok(fs.existsSync(path.join(roleDir, 'inputs', 'candidates.json')));
});

test('CLI generate-search-pack and prepare-drafts run against the fixture role', () => {
  const workspaceRoot = makeWorkspace();
  const searchPackResult = runCli(workspaceRoot, ['generate-search-pack', '--role-id', 'demo-electrical-site-manager']);
  assert.equal(searchPackResult.status, 0, searchPackResult.stderr);

  const runAllResult = runCli(workspaceRoot, ['prepare-drafts', '--role-id', 'demo-electrical-site-manager']);
  assert.equal(runAllResult.status, 0, runAllResult.stderr);

  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'search-pack.json')));
  assert.ok(fs.existsSync(path.join(roleDir, 'drafts', 'cvl-strong-001.md')));
});

test('CLI update-candidate refreshes records without manual JSON editing', () => {
  const workspaceRoot = makeWorkspace();
  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');

  const runAllResult = runCli(workspaceRoot, ['run', '--role-id', 'demo-electrical-site-manager', '--action', 'run_all']);
  assert.equal(runAllResult.status, 0, runAllResult.stderr);

  const updateResult = runCli(workspaceRoot, [
    'update-candidate',
    '--role-id', 'demo-electrical-site-manager',
    '--candidate-id', 'cvl-possible-002',
    '--operator-decision', 'manual_screened',
    '--shortlist-status', 'possible_shortlist',
    '--lifecycle-stage', 'contacted',
    '--manual-notes', 'Called and sent brief outline.',
    '--override-reason', 'Manual review',
  ]);
  assert.equal(updateResult.status, 0, updateResult.stderr);

  const updatedRecord = JSON.parse(fs.readFileSync(path.join(roleDir, 'records', 'cvl-possible-002.json'), 'utf8'));
  assert.equal(updatedRecord.lifecycle.current_stage, 'contacted');
  assert.equal(updatedRecord.operator_review.decision, 'manual_screened');
});

test('CLI import-previews, export-candidates, and role-index support daily operator flow', () => {
  const workspaceRoot = makeWorkspace();
  const initResult = runCli(workspaceRoot, ['init-role', '--role-id', 'csv-role', '--role-title', 'Electrical Site Manager']);
  assert.equal(initResult.status, 0, initResult.stderr);

  const createdRoleDir = path.join(workspaceRoot, 'roles', 'csv-role');
  const sourceRoleDir = path.join(fixtureRoot, 'roles', 'demo-electrical-site-manager');
  fs.copyFileSync(path.join(sourceRoleDir, 'inputs', 'job-spec.yaml'), path.join(createdRoleDir, 'inputs', 'job-spec.yaml'));
  fs.cpSync(path.join(sourceRoleDir, 'cvs'), path.join(createdRoleDir, 'cvs'), { recursive: true });

  const importResult = runCli(workspaceRoot, [
    'import-previews',
    '--role-id', 'csv-role',
    '--input', path.join(fixtureRoot, 'samples', 'candidate-previews.csv'),
  ]);
  assert.equal(importResult.status, 0, importResult.stderr);

  const runResult = runCli(workspaceRoot, ['run', '--role-id', 'csv-role', '--action', 'run_all']);
  assert.equal(runResult.status, 0, runResult.stderr);

  const exportResult = runCli(workspaceRoot, ['export-candidates', '--role-id', 'csv-role']);
  assert.equal(exportResult.status, 0, exportResult.stderr);

  const indexResult = runCli(workspaceRoot, ['role-index', '--format', 'json']);
  assert.equal(indexResult.status, 0, indexResult.stderr);
  assert.match(indexResult.stdout, /csv-role|Electrical Site Manager/);
  assert.ok(fs.existsSync(path.join(createdRoleDir, 'outputs', 'candidate-review-export.csv')));
});

test('CLI update-role-config and log-contact support review-console operations', () => {
  const workspaceRoot = makeWorkspace();
  const roleDir = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager');

  const configResult = runCli(workspaceRoot, [
    'update-role-config',
    '--role-id', 'demo-electrical-site-manager',
    '--shortlist-target-size', '6',
    '--shortlist-mode', 'strict',
    '--minimum-shortlist-score', '55',
    '--minimum-draft-score', '70',
  ]);
  assert.equal(configResult.status, 0, configResult.stderr);

  const contactResult = runCli(workspaceRoot, [
    'log-contact',
    '--role-id', 'demo-electrical-site-manager',
    '--candidate-id', 'cvl-strong-001',
    '--stage', 'contacted',
    '--date', '2026-04-20',
    '--note', 'Manual outreach sent',
    '--message-summary', 'Shared role outline',
  ]);
  assert.equal(contactResult.status, 0, contactResult.stderr);

  const summary = JSON.parse(fs.readFileSync(path.join(roleDir, 'outputs', 'dashboard-summary.json'), 'utf8'));
  assert.equal(summary.shortlistProgress.target, 6);
  assert.equal(summary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-strong-001').lifecycle.current_stage, 'contacted');
});
