#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const steps = [
  { label: 'verify-functions', cmd: 'node', args: ['scripts/verify-functions.js'] },
  { label: 'verify-jobs-integration', cmd: 'node', args: ['scripts/verify-jobs-integration.js'] },
  { label: 'check-apply-links', cmd: 'node', args: ['scripts/check-apply-links.js'] },
  { label: 'validate-site', cmd: 'node', args: ['scripts/validate-site.js'] }
];

for(const step of steps){
  const result = spawnSync(step.cmd, step.args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false
  });

  if(result.error){
    console.error(`\nFailed to run ${step.label}:`, result.error.message || result.error);
    process.exit(1);
  }

  if(result.status !== 0){
    console.error(`\n${step.label} exited with status ${result.status}.`);
    process.exit(result.status || 1);
  }
}

console.log('\nAll test steps completed successfully.');
