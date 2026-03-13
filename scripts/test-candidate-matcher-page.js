const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'candidate-matcher.html'), 'utf8');

const requiredMarkers = [
  'id="dropZone"',
  'id="fileInput"',
  'id="analyseButton"',
  'id="progressFill"',
  'id="resultsShell"',
  'id="historyList"',
  'id="runDiagnosticsList"',
  'id="retryAnalysisButton"'
];

requiredMarkers.forEach((marker) => {
  if (!html.includes(marker)) {
    throw new Error(`Candidate matcher page missing required marker: ${marker}`);
  }
});

console.log('[test] candidate matcher page mounted ok');
