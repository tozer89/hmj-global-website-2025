const fs = require('node:fs');
const path = require('node:path');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin', 'candidates.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(__dirname, '..', 'candidates.html'), 'utf8');

const hasToolbar = /class="toolbar"/.test(adminHtml);
const hasFilters = /id="filters"/.test(adminHtml);
const hasRows = /id="rows"/.test(adminHtml);
const hasPortalAuthRoot = /id="candidatePortalAuthRoot"/.test(publicHtml);
const hasDashboardRoot = /id="candidateDashboardRoot"/.test(publicHtml);
const hasCreateAccountToggle = /id="candidateCreateAccount"/.test(publicHtml);
const hasPasswordFields = /id="candidatePasswordFields"/.test(publicHtml);
const hasCandidateStatusRoot = /id="candidateFormStatusRoot"/.test(publicHtml);

if (!hasToolbar || !hasFilters || !hasRows || !hasPortalAuthRoot || !hasDashboardRoot || !hasCreateAccountToggle || !hasPasswordFields || !hasCandidateStatusRoot) {
  throw new Error('Candidates page failed basic mount check.');
}

console.log('[test] candidates page mounted ok');
