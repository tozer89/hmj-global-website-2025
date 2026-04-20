const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../lib/sourcing-assistant-core.js');
const { parseYaml } = require('../lib/simple-yaml.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');
const fixtureRoleDir = path.join(fixtureRoot, 'roles', 'demo-electrical-site-manager');

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
  assert.equal(records.length, 4);
  assert.ok(fs.existsSync(path.join(roleDir, 'drafts', 'cvl-strong-001.md')));
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'search-pack.md')));
  assert.ok(fs.existsSync(path.join(roleDir, 'outputs', 'metrics-summary.md')));
  assert.ok(fs.existsSync(path.join(roleDir, 'records', 'cvl-possible-002.json')));
});
