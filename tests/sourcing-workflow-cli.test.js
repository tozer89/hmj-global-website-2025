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
