'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const candidateMatcherCore = require('../lib/candidate-matcher-core.js');
const sourcingCore = require('../lib/sourcing-assistant-core.js');
const { generateTrialCvPack } = require('./helpers/trial-cv-pack.js');
const {
  buildBulkUploadFiles,
  buildMockOcrFetch,
  buildTrialJobSpecYaml,
  buildTrialRoleConfig,
  guessContentType,
} = require('./helpers/cv-parser-audit-fixtures.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readManifestEntryMap(manifest) {
  const map = new Map();
  for (const entry of Array.isArray(manifest) ? manifest : []) {
    map.set(entry.file_name, entry);
  }
  return map;
}

function findRecordByName(records, name) {
  return (Array.isArray(records) ? records : []).find((record) => record.candidate_name === name);
}

function normaliseForPhraseMatch(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

test('trial CV pack parses across varied layouts, file types, and older Word formats', async (t) => {
  const tempDir = makeTempDir('hmj-cv-pack-');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const { manifest } = generateTrialCvPack(tempDir);
  assert.equal(manifest.length, 10);

  for (const entry of manifest) {
    const absolutePath = path.join(tempDir, entry.relative_path || entry.file_name);
    const buffer = fs.readFileSync(absolutePath);
    const [prepared] = candidateMatcherCore.prepareCandidateFiles([{
      name: entry.file_name,
      contentType: guessContentType(entry.file_name),
      size: buffer.byteLength,
      data: buffer.toString('base64'),
    }]);

    assert.equal(prepared.status, 'ready', `${entry.file_name} should prepare successfully`);

    const extraction = await candidateMatcherCore.extractCandidateDocuments([prepared], entry.requires_ocr
      ? {
        enablePdfOcr: true,
        ocrFetchImpl: buildMockOcrFetch(entry.ocr_text),
      }
      : {});

    assert.equal(extraction.successCount, 1, `${entry.file_name} should extract successfully`);
    const document = extraction.documents[0];
    assert.equal(document.status, 'ok', `${entry.file_name} should be marked ok`);

    const extractedText = normaliseForPhraseMatch(document.extractedText || extraction.combinedText || '');
    for (const phrase of entry.expected_parse_phrases) {
      assert.match(
        extractedText,
        new RegExp(normaliseForPhraseMatch(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${entry.file_name} should contain phrase "${phrase}"`,
      );
    }

    if (entry.expected_parser === 'textutil') {
      assert.equal(document.extractionDiagnostics.parser, 'textutil');
    }
    if (entry.expected_text_source === 'ocr_pdf_text') {
      assert.equal(document.selectedTextSource, 'ocr_pdf_text');
      assert.equal(document.extractionDiagnostics.ocrTriggered, true);
    }
  }
});

test('trial CV pack flows through the sourcing workflow with sensible shortlist outcomes', async (t) => {
  const tempDir = makeTempDir('hmj-cv-audit-workflow-');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const cvDir = path.join(tempDir, 'trial-files');
  const { manifest } = generateTrialCvPack(cvDir);
  const workflowRoot = path.join(tempDir, 'workflow');
  const roleId = 'trial-senior-electrical-commissioning-manager';
  const created = sourcingCore.scaffoldRoleWorkspace({
    workflowRoot,
    roleId,
    roleTitle: 'Senior Electrical Commissioning Manager',
  });

  fs.writeFileSync(path.join(created.roleDir, 'inputs', 'job-spec.yaml'), buildTrialJobSpecYaml(), 'utf8');
  fs.writeFileSync(
    path.join(created.roleDir, 'inputs', 'role-config.json'),
    `${JSON.stringify(buildTrialRoleConfig(), null, 2)}\n`,
    'utf8',
  );

  const scannedEntry = manifest.find((entry) => entry.requires_ocr);
  const uploadResult = await sourcingCore.importBulkCvFiles({
    workflowRoot,
    roleId,
    files: buildBulkUploadFiles(cvDir, manifest),
    enablePdfOcr: true,
    ocrFetchImpl: buildMockOcrFetch(scannedEntry ? scannedEntry.ocr_text : ''),
  });

  assert.equal(uploadResult.filesReceived, 10);
  assert.equal(uploadResult.successfulCount, 10);
  assert.equal(uploadResult.failedCount, 0);

  const summary = await sourcingCore.runRoleWorkspace({
    workflowRoot,
    roleId,
    action: 'run_all',
  });

  const records = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'outputs', 'candidate-records.json'), 'utf8'));
  assert.equal(records.length, 10);

  const amelia = findRecordByName(records, 'Amelia Hart');
  const daniel = findRecordByName(records, 'Daniel Osei');
  const marek = findRecordByName(records, 'Marek Novak');
  const patrick = findRecordByName(records, 'Patrick Reilly');
  const luca = findRecordByName(records, 'Luca Romano');
  const ben = findRecordByName(records, 'Ben Carter');
  const sophie = findRecordByName(records, 'Sophie Webb');

  assert.ok(amelia, 'Amelia Hart should exist in candidate records');
  assert.ok(daniel, 'Daniel Osei should exist in candidate records');
  assert.ok(marek, 'Marek Novak should exist in candidate records');
  assert.ok(patrick, 'Patrick Reilly should exist in candidate records');
  assert.ok(luca, 'Luca Romano should exist in candidate records');
  assert.ok(ben, 'Ben Carter should exist in candidate records');
  assert.ok(sophie, 'Sophie Webb should exist in candidate records');

  assert.equal(amelia.full_cv.shortlist_recommendation, 'strong');
  assert.equal(daniel.full_cv.shortlist_recommendation, 'strong');
  assert.equal(marek.full_cv.shortlist_recommendation, 'strong');
  assert.match(patrick.full_cv.shortlist_recommendation, /strong|possible/);
  assert.match(luca.full_cv.shortlist_recommendation, /strong|possible/);
  assert.equal(ben.full_cv.shortlist_recommendation, 'reject');
  assert.equal(sophie.full_cv.shortlist_recommendation, 'reject');

  assert.ok((summary.metrics.shortlist_counts.strong || 0) >= 4);
  assert.ok((summary.metrics.shortlist_counts.reject || 0) >= 2);
  assert.ok((summary.metrics.viable_outreach_candidates || 0) >= 5);

  const importHistory = JSON.parse(fs.readFileSync(path.join(created.roleDir, 'outputs', 'bulk-cv-import-history.json'), 'utf8'));
  assert.equal(importHistory[0].parsed_successfully, 10);
  assert.equal(importHistory[0].failed, 0);
  assert.equal(importHistory[0].ocr_used_count, 1);
});
