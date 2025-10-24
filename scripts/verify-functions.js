const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const functionsDir = path.join(rootDir, 'netlify', 'functions');

if (!fs.existsSync(functionsDir)) {
  console.error(`Netlify functions directory not found: ${functionsDir}`);
  process.exit(1);
}

let failures = 0;

function checkFile(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
  if (result.status !== 0) {
    failures += 1;
  }
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    const ext = path.extname(entry.name);
    if (ext.length && !['.js', '.json'].includes(ext)) {
      console.error(`Function file missing .js extension: ${path.relative(functionsDir, fullPath)}`);
      failures += 1;
      continue;
    }
    if (ext === '.js') {
      checkFile(fullPath);
    }
  }
}

walk(functionsDir);

if (failures > 0) {
  console.error(`Function verification failed with ${failures} issue(s).`);
  process.exit(1);
}

console.log('All Netlify function files passed syntax verification.');
