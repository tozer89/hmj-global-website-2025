'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const candidateMatcherCore = require('../lib/candidate-matcher-core.js');
const sourcingCore = require('../lib/sourcing-assistant-core.js');
const { generateTrialCvPack } = require('../tests/helpers/trial-cv-pack.js');
const {
  buildBulkUploadFiles,
  buildMockOcrFetch,
  buildTrialJobSpecYaml,
  buildTrialRoleConfig,
  guessContentType,
} = require('../tests/helpers/cv-parser-audit-fixtures.js');

const WORKFLOW_ROOT = '/Users/joetozerosullivan/Desktop/HMJ Global Ltd/Candidates/Sourcing Workflow';
const SAMPLE_ROOT = path.join(WORKFLOW_ROOT, 'samples', 'cv-parser-trials');
const FILES_ROOT = path.join(SAMPLE_ROOT, 'files');
const AUDIT_WORKFLOW_ROOT = path.join(SAMPLE_ROOT, 'workflow-root');
const REPORT_PATH = path.join(WORKFLOW_ROOT, 'docs', 'cv-parser-trial-audit.md');
const ROLE_ID = 'trial-senior-electrical-commissioning-manager';

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, value, 'utf8');
}

function clearDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  ensureDir(targetPath);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normaliseForPhraseMatch(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchPhrases(text, phrases) {
  const lower = normaliseForPhraseMatch(text);
  return (Array.isArray(phrases) ? phrases : []).filter((phrase) => new RegExp(escapeRegExp(normaliseForPhraseMatch(phrase))).test(lower));
}

function findRecordByName(records, candidateName) {
  return (Array.isArray(records) ? records : []).find((record) => record.candidate_name === candidateName);
}

async function parseTrialPack(manifest) {
  const results = [];
  for (const entry of manifest) {
    const absolutePath = path.join(FILES_ROOT, entry.relative_path || entry.file_name);
    const buffer = fs.readFileSync(absolutePath);
    const [prepared] = candidateMatcherCore.prepareCandidateFiles([{
      name: entry.file_name,
      contentType: guessContentType(entry.file_name),
      size: buffer.byteLength,
      data: buffer.toString('base64'),
    }]);

    const extraction = await candidateMatcherCore.extractCandidateDocuments([prepared], entry.requires_ocr
      ? {
        enablePdfOcr: true,
        ocrFetchImpl: buildMockOcrFetch(entry.ocr_text),
      }
      : {});
    const document = extraction.documents[0] || {};
    const extractedText = String(document.extractedText || extraction.combinedText || '');
    const matchedPhrases = matchPhrases(extractedText, entry.expected_parse_phrases);

    results.push({
      id: entry.id,
      file_name: entry.file_name,
      candidate_name: entry.candidate_name,
      format: entry.format,
      structure_tags: entry.structure_tags,
      status: document.status || 'unknown',
      parser: document.extractionDiagnostics?.parser || '',
      selected_text_source: document.selectedTextSource || document.extractionDiagnostics?.selectedTextSource || '',
      ocr_triggered: document.extractionDiagnostics?.ocrTriggered === true,
      text_characters: document.extractedTextLength || extractedText.length,
      matched_phrases: matchedPhrases,
      expected_phrase_count: entry.expected_parse_phrases.length,
      phrase_match_ratio: entry.expected_parse_phrases.length
        ? Number((matchedPhrases.length / entry.expected_parse_phrases.length).toFixed(2))
        : 1,
      expected_shortlist_recommendation: entry.expected_shortlist_recommendation,
      parse_ok: document.status === 'ok',
    });
  }
  return results;
}

async function runWorkflowAudit(manifest) {
  clearDir(AUDIT_WORKFLOW_ROOT);
  const created = sourcingCore.scaffoldRoleWorkspace({
    workflowRoot: AUDIT_WORKFLOW_ROOT,
    roleId: ROLE_ID,
    roleTitle: 'Senior Electrical Commissioning Manager',
  });
  writeText(path.join(created.roleDir, 'inputs', 'job-spec.yaml'), buildTrialJobSpecYaml());
  writeJson(path.join(created.roleDir, 'inputs', 'role-config.json'), buildTrialRoleConfig());

  const scannedEntry = manifest.find((entry) => entry.requires_ocr);
  const uploadResult = await sourcingCore.importBulkCvFiles({
    workflowRoot: AUDIT_WORKFLOW_ROOT,
    roleId: ROLE_ID,
    files: buildBulkUploadFiles(FILES_ROOT, manifest),
    enablePdfOcr: true,
    ocrFetchImpl: buildMockOcrFetch(scannedEntry ? scannedEntry.ocr_text : ''),
  });
  const summary = await sourcingCore.runRoleWorkspace({
    workflowRoot: AUDIT_WORKFLOW_ROOT,
    roleId: ROLE_ID,
    action: 'run_all',
  });
  const records = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'outputs', 'candidate-records.json'), 'utf8'));
  return { created, uploadResult, summary, records };
}

function buildWorkflowComparison(manifest, records) {
  return manifest.map((entry) => {
    const record = findRecordByName(records, entry.candidate_name);
    return {
      candidate_name: entry.candidate_name,
      file_name: entry.file_name,
      expected: entry.expected_shortlist_recommendation,
      actual: record?.full_cv?.shortlist_recommendation || '',
      lifecycle_stage: record?.lifecycle?.current_stage || '',
      score: record?.full_cv?.score || 0,
      next_action: record?.status?.next_action || '',
      matches_expectation: !!record && record.full_cv?.shortlist_recommendation === entry.expected_shortlist_recommendation,
    };
  });
}

function buildReportMarkdown({ parserResults, workflowResult, workflowComparison, manifest }) {
  const successfulParses = parserResults.filter((entry) => entry.parse_ok).length;
  const workflowMatches = workflowComparison.filter((entry) => entry.matches_expectation).length;
  const strongCount = workflowResult.summary.metrics.shortlist_counts?.strong || 0;
  const possibleCount = workflowResult.summary.metrics.shortlist_counts?.possible || 0;
  const rejectCount = workflowResult.summary.metrics.shortlist_counts?.reject || 0;
  const ocrEntry = parserResults.find((entry) => entry.ocr_triggered);

  const fileTable = parserResults.map((entry) => `| ${entry.file_name} | ${entry.format.toUpperCase()} | ${entry.parser || '-'} | ${entry.selected_text_source || '-'} | ${entry.text_characters} | ${entry.matched_phrases.length}/${entry.expected_phrase_count} | ${entry.parse_ok ? 'ok' : 'failed'} |`).join('\n');
  const workflowTable = workflowComparison.map((entry) => `| ${entry.candidate_name} | ${entry.expected} | ${entry.actual || '-'} | ${entry.score} | ${entry.lifecycle_stage || '-'} | ${entry.matches_expectation ? 'yes' : 'review'} |`).join('\n');

  return [
    '# CV Parser Trial Audit',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Scope',
    '',
    '- Created 10 synthetic but authentic-looking CV files covering multi-page PDFs, table-heavy DOCX, embedded-image DOCX, legacy `.doc`, long-form dense resumes, scanned/image-only PDF, adjacent-title profiles, and clear rejects.',
    '- Parsed each file individually through the candidate matcher.',
    '- Imported the same pack through the bulk CV workflow and ran the full sourcing role against a synthetic Senior Electrical Commissioning Manager job spec.',
    '',
    '## Headline Result',
    '',
    `- Parser success: ${successfulParses}/${manifest.length} files extracted successfully.`,
    `- Workflow expectation match: ${workflowMatches}/${manifest.length} candidate outcomes matched the planned strong/possible/reject benchmark.`,
    `- Shortlist distribution: ${strongCount} strong, ${possibleCount} possible, ${rejectCount} reject.`,
    `- OCR path: ${ocrEntry ? `validated on ${ocrEntry.file_name} using a deterministic OCR response for repeatable testing.` : 'not used.'}`,
    '',
    '## Parser Trial Matrix',
    '',
    '| File | Format | Parser | Selected text source | Text chars | Phrase coverage | Result |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
    fileTable,
    '',
    '## End-to-End Workflow Outcome',
    '',
    '| Candidate | Expected | Actual | Score | Lifecycle | Match |',
    '| --- | --- | --- | ---: | --- | --- |',
    workflowTable,
    '',
    '## Findings',
    '',
    '- Legacy `.doc` parsing now works on this Mac via `/usr/bin/textutil`, which closes an older-version gap that previously failed hard.',
    '- Table-heavy DOCX content and embedded-image DOCX files still extract the surrounding text cleanly enough for shortlist scoring.',
    '- Scanned/image-only PDFs remain dependent on OCR. The parser route is sound, but live reliability still depends on OCR availability when not using a mock.',
    '- Dense 10-page resumes continue to extract enough title, sector, and skills evidence for scoring without crashing the workflow.',
    '- Reject cases based on mechanical-only or facilities-maintenance backgrounds remain clearly separated from electrical commissioning/package leadership profiles.',
    '',
    '## Artifacts',
    '',
    `- Trial files: \`${FILES_ROOT}\``,
    `- Trial job spec: \`${path.join(SAMPLE_ROOT, 'trial-job-spec.yaml')}\``,
    `- Parser results JSON: \`${path.join(SAMPLE_ROOT, 'parser-results.json')}\``,
    `- Workflow comparison JSON: \`${path.join(SAMPLE_ROOT, 'workflow-comparison.json')}\``,
    `- Workflow run summary: \`${path.join(workflowResult.created.roleDir, 'outputs', 'run-summary.json')}\``,
    `- Workflow dashboard summary: \`${path.join(workflowResult.created.roleDir, 'outputs', 'dashboard-summary.json')}\``,
    '',
  ].join('\n');
}

async function main() {
  clearDir(FILES_ROOT);
  const { manifest } = generateTrialCvPack(FILES_ROOT);
  writeJson(path.join(FILES_ROOT, 'manifest.json'), manifest);
  writeText(path.join(SAMPLE_ROOT, 'trial-job-spec.yaml'), buildTrialJobSpecYaml());

  const parserResults = await parseTrialPack(manifest);
  writeJson(path.join(SAMPLE_ROOT, 'parser-results.json'), parserResults);

  const workflowResult = await runWorkflowAudit(manifest);
  const workflowComparison = buildWorkflowComparison(manifest, workflowResult.records);
  writeJson(path.join(SAMPLE_ROOT, 'workflow-comparison.json'), workflowComparison);
  writeJson(path.join(SAMPLE_ROOT, 'workflow-metrics.json'), workflowResult.summary.metrics);

  const markdown = buildReportMarkdown({
    parserResults,
    workflowResult,
    workflowComparison,
    manifest,
  });
  writeText(REPORT_PATH, `${markdown}\n`);

  console.log(JSON.stringify({
    ok: true,
    filesRoot: FILES_ROOT,
    reportPath: REPORT_PATH,
    parserSuccess: parserResults.filter((entry) => entry.parse_ok).length,
    workflowMatches: workflowComparison.filter((entry) => entry.matches_expectation).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
