'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUNDLED_PYTHON = path.join(
  os.homedir(),
  '.cache',
  'codex-runtimes',
  'codex-primary-runtime',
  'dependencies',
  'python',
  'bin',
  'python3'
);

function pythonCandidates() {
  return [
    process.env.HMJ_SOURCING_PYTHON,
    BUNDLED_PYTHON,
    'python3',
  ].filter(Boolean);
}

function resolvePython() {
  for (const candidate of pythonCandidates()) {
    try {
      const probe = spawnSync(candidate, ['-c', 'import reportlab, docx, PIL; print("ok")'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (probe.status === 0 && probe.stdout.includes('ok')) {
        return candidate;
      }
    } catch {
      // Try the next runtime candidate.
    }
  }
  throw new Error('No usable Python runtime with reportlab, docx, and PIL was found for the CV trial pack generator.');
}

function generateTrialCvPack(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate_trial_cv_pack.py');
  const python = resolvePython();
  const result = spawnSync(python, [scriptPath, outputDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`CV trial pack generator failed.\n${result.stderr || result.stdout || 'No output.'}`);
  }
  const manifestPath = path.join(outputDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`CV trial pack generator did not create ${manifestPath}.`);
  }
  return {
    python,
    manifestPath,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
  };
}

module.exports = {
  generateTrialCvPack,
  resolvePython,
};
