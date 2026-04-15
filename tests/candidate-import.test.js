const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildExistingCandidateLookup,
  buildTemplateWorkbook,
  findExistingCandidate,
  parseImportFile,
} = require('../netlify/functions/_candidate-import.js');

test('candidate import template workbook includes csv and xlsx outputs', () => {
  const template = buildTemplateWorkbook();

  assert.ok(Buffer.isBuffer(template.xlsxBuffer));
  assert.ok(template.xlsxBuffer.length > 0);
  assert.match(template.csv, /Email,Full Name,First Name,Last Name/);
  assert.match(template.csv, /candidate@example\.com/);
});

test('candidate import parser can read the generated xlsx template', () => {
  const template = buildTemplateWorkbook();
  const preview = parseImportFile({
    fileName: 'hmj-candidates-import-template.xlsx',
    buffer: template.xlsxBuffer,
  });

  assert.equal(preview.sheetName, 'Candidates');
  assert.ok(preview.headers.includes('Email'));
  assert.equal(preview.totalRows, 1);
  assert.equal(preview.validRows, 1);
  assert.equal(preview.rows[0].payload.email, 'candidate@example.com');
});

test('candidate import parser maps common headers into HMJ candidate fields', () => {
  const csv = [
    'Email,Name,Phone,Skills,Payroll Ref,Right To Work Status',
    'candidate@example.com,Joseph Tozer,+44 7700 900123,"SAP, HV",TSP-10021,Full right to work in place',
  ].join('\n');

  const preview = parseImportFile({
    fileName: 'candidates.csv',
    buffer: Buffer.from(csv, 'utf8'),
  });

  assert.equal(preview.totalRows, 1);
  assert.equal(preview.validRows, 1);
  assert.deepEqual(
    preview.mappedColumns
      .filter((column) => column.field)
      .map((column) => column.field),
    ['email', 'full_name', 'phone', 'skills', 'payroll_ref', 'right_to_work_status'],
  );
  assert.equal(preview.rows[0].payload.email, 'candidate@example.com');
  assert.equal(preview.rows[0].payload.full_name, 'Joseph Tozer');
  assert.equal(preview.rows[0].payload.first_name, 'Joseph');
  assert.equal(preview.rows[0].payload.last_name, 'Tozer');
  assert.equal(preview.rows[0].payload.skills, 'SAP, HV');
});

test('candidate import lookup matches existing rows by email or ref', () => {
  const lookup = buildExistingCandidateLookup([
    { id: 'candidate-1', email: 'candidate@example.com', ref: 'HMJ-1', auth_user_id: 'auth-1' },
  ]);

  const byEmail = findExistingCandidate({ payload: { email: 'candidate@example.com' } }, lookup);
  const byRef = findExistingCandidate({ payload: { ref: 'HMJ-1' } }, lookup);

  assert.equal(byEmail.id, 'candidate-1');
  assert.equal(byRef.id, 'candidate-1');
});
