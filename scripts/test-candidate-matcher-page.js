const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'candidate-matcher.html'), 'utf8');

const requiredMarkers = [
  'id="dropZone"',
  'id="fileInput"',
  'id="prepareEvidenceButton"',
  'id="runMatchButton"',
  'id="workflowStepPrepare"',
  'id="workflowStepMatch"',
  'id="progressFill"',
  'id="resultsShell"',
  'id="copyCandidateSummaryButton"',
  'id="historyList"',
  'id="preparedEvidenceShell"',
  'id="runDiagnosticsList"',
  'id="jobStatusList"',
  'id="retryAnalysisButton"'
];

requiredMarkers.forEach((marker) => {
  if (!html.includes(marker)) {
    throw new Error(`Candidate matcher page missing required marker: ${marker}`);
  }
});

console.log('[test] candidate matcher page mounted ok');
