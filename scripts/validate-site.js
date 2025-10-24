const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const allowMissing = new Set([
  // Legacy endpoints served dynamically outside this repository
]);

const skippedPrefixes = [
  'http://',
  'https://',
  'mailto:',
  'tel:',
  'sms:',
  'javascript:',
  'data:',
  '//',
  '#',
];

function isExternal(resource) {
  const trimmed = resource.trim();
  return skippedPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

function normaliseResource(resource) {
  const withoutHash = resource.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  return withoutQuery.trim();
}

function shouldCheck(resource) {
  if (!resource) return false;
  if (isExternal(resource)) return false;
  if (allowMissing.has(resource)) return false;
  if (resource.includes('${') || resource.includes('{{')) return false;
  return true;
}

function fileExists(fromDir, resource) {
  if (!resource) return true;
  const cleaned = normaliseResource(resource);
  if (!cleaned) return true;
  const absolute = cleaned.startsWith('/')
    ? path.join(repoRoot, cleaned.replace(/^\//, ''))
    : path.join(fromDir, cleaned);
  return fs.existsSync(absolute);
}

function collectHtmlFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'netlify' || entry.name === 'scripts') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectHtmlFiles(fullPath));
      continue;
    }
    if (entry.name.toLowerCase().endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractResources(html) {
  const results = [];
  const withoutComments = html.replace(/<!--[^]*?-->/g, ' ');
  const patterns = [
    /\s(?:src|href|action)\s*=\s*"([^"]+)"/gi,
    /\s(?:src|href|action)\s*=\s*'([^']+)'/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(withoutComments)) !== null) {
      results.push(match[1]);
    }
  }
  return results;
}

function validateHtml(filePath) {
  const dir = path.dirname(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const resources = extractResources(content);
  const missing = [];
  for (const resource of resources) {
    if (!shouldCheck(resource)) continue;
    if (!fileExists(dir, resource)) {
      missing.push(resource);
    }
  }
  return missing;
}

const htmlFiles = collectHtmlFiles(repoRoot);

let errorCount = 0;

for (const htmlFile of htmlFiles) {
  const missing = validateHtml(htmlFile);
  if (missing.length > 0) {
    errorCount += missing.length;
    const relative = path.relative(repoRoot, htmlFile);
    console.error(`Missing resources referenced from ${relative}:`);
    for (const resource of missing) {
      console.error(`  - ${resource}`);
    }
  }
}

if (errorCount > 0) {
  console.error(`Site validation failed: ${errorCount} missing resource reference(s) found.`);
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML file(s); all referenced assets are present.`);
