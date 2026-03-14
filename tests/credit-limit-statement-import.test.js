const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const {
  parseCsvText,
  parsePdfText,
  parseXlsxBuffer,
  buildReconciliationSummary,
} = require('../lib/credit-limit-statement-import.js');

async function buildMinimalXlsx(rows) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '</Types>',
  ].join(''));
  zip.folder('_rels').file('.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>',
  ].join(''));
  zip.folder('xl').file('workbook.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>',
    '</workbook>',
  ].join(''));
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    '</Relationships>',
  ].join(''));

  const worksheetRows = rows.map((cells, rowIndex) => {
    const cellXml = cells.map((value, columnIndex) => {
      const ref = String.fromCharCode(65 + columnIndex) + (rowIndex + 1);
      if (typeof value === 'number') {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${String(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cellXml}</row>`;
  }).join('');

  zip.folder('xl').folder('worksheets').file('sheet1.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
    worksheetRows,
    '</sheetData>',
    '</worksheet>',
  ].join(''));

  return zip.generateAsync({ type: 'nodebuffer' });
}

test('statement import case 1: clean CSV maps invoice ref, due date, and outstanding amount', () => {
  const csv = [
    'Invoice Ref,Due Date,Outstanding Amount,Currency',
    'INV-1001,2026-01-16,12000,GBP',
    'INV-1002,2026-01-23,15000,GBP',
  ].join('\n');

  const draft = parseCsvText(csv, {
    fileName: 'debtor.csv',
    scenarioCurrency: 'GBP',
    forecastStartDate: '2026-01-05',
    paymentTerms: { type: '30_eom', customNetDays: 21, receiptLagDays: 0 },
  });

  assert.equal(draft.includedRowCount, 2);
  assert.equal(draft.importedTotal, 27000);
  assert.equal(draft.rows[0].invoiceRef, 'INV-1001');
  assert.equal(draft.rows[0].dueDate, '2026-01-16');
});

test('statement import case 2: XLSX alias mapping handles alternative column labels', async () => {
  const buffer = await buildMinimalXlsx([
    ['Inv No', 'Payable Date', 'Balance', 'Curr'],
    ['INV-2001', '2026-01-20', 22000, 'GBP'],
    ['INV-2002', '2026-01-27', 18000, 'GBP'],
  ]);

  const draft = await parseXlsxBuffer(buffer, {
    fileName: 'aged-debtor.xlsx',
    scenarioCurrency: 'GBP',
    forecastStartDate: '2026-01-05',
    paymentTerms: { type: '14_net', customNetDays: 21, receiptLagDays: 0 },
  });

  assert.equal(draft.includedRowCount, 2);
  assert.equal(draft.importedTotal, 40000);
  assert.equal(draft.mapping.invoiceRef, 'Inv No');
  assert.equal(draft.mapping.dueDate, 'Payable Date');
  assert.equal(draft.mapping.outstandingAmount, 'Balance');
});

test('statement import case 3: text-based PDF table is converted into imported rows', () => {
  const pdfText = [
    'Debtor Statement',
    'Invoice Ref    Invoice Date    Due Date    Outstanding Amount    Currency',
    'INV-3001       02/01/2026      16/01/2026  12000.00               GBP',
    'INV-3002       09/01/2026      23/01/2026  14000.00               GBP',
  ].join('\n');

  const draft = parsePdfText(pdfText, {
    fileName: 'statement.pdf',
    scenarioCurrency: 'GBP',
    forecastStartDate: '2026-01-05',
    paymentTerms: { type: '14_net', customNetDays: 21, receiptLagDays: 0 },
  });

  assert.equal(draft.includedRowCount, 2);
  assert.equal(draft.rows[0].dueDate, '2026-01-16');
  assert.equal(draft.importedTotal, 26000);
});

test('statement import case 4: weak PDF structure falls back to review-first mode', () => {
  const pdfText = [
    'Statement extract',
    'INV-4001 05/01/2026 12000 GBP overdue',
  ].join('\n');

  const draft = parsePdfText(pdfText, {
    fileName: 'weak-statement.pdf',
    scenarioCurrency: 'GBP',
    forecastStartDate: '2026-01-05',
    paymentTerms: { type: '30_eom', customNetDays: 21, receiptLagDays: 0 },
  });

  assert.ok(draft.confidence === 'low' || draft.confidence === 'medium');
  assert.ok(draft.warnings.length >= 1);
});

test('statement import case 5: reconciliation summary shows variance clearly', () => {
  const reconciliation = buildReconciliationSummary({
    importedTotal: 76000,
    reconciliationMode: 'keep_manual_opening_balance',
  }, 90000);

  assert.equal(reconciliation.importedTotal, 76000);
  assert.equal(reconciliation.enteredOpeningBalance, 90000);
  assert.equal(reconciliation.variance, -14000);
  assert.equal(reconciliation.matches, false);
});
