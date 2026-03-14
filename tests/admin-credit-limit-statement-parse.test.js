const test = require('node:test');
const assert = require('node:assert/strict');

const statementParse = require('../netlify/functions/admin-credit-limit-statement-parse.js');

function toBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

test('poor PDF import uses AI-assisted fallback when standard confidence is weak', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';

  try {
    const result = await statementParse._private.parseFile({
      name: 'debtor-statement.pdf',
      contentType: 'application/pdf',
      size: 64,
      data: toBase64('%PDF- weak statement payload'),
    }, {
      fileName: 'debtor-statement.pdf',
      scenarioCurrency: 'GBP',
      forecastStartDate: '2026-01-05',
      paymentTerms: { type: '14_net', customNetDays: 21, receiptLagDays: 0 },
    }, {
      extractPdfText: async () => ({
        text: [
          'Statement extract',
          'INV-9001 05/01/2026 12000 GBP overdue',
        ].join('\n'),
        rawText: [
          'Statement extract',
          'INV-9001 05/01/2026 12000 GBP overdue',
        ].join('\n'),
        strategy: 'native_pdf_text',
        parser: 'pdf-parse',
        totalPages: 1,
        native: { quality: 'weak_native_text' },
        ocr: { quality: 'not_attempted' },
      }),
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            rows: [
              {
                invoice_reference: 'INV-9001',
                invoice_date: '2026-01-05',
                due_date: '2026-01-19',
                outstanding_amount: 12000,
                currency: 'GBP',
                credit_note: false,
                note: 'Recovered from weak PDF',
                confidence: 'medium',
              },
            ],
            warnings: ['The due date was inferred from the statement layout.'],
            summary: 'One invoice row recovered.',
          }),
        }),
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.aiAssistUsed, true);
    assert.equal(result.statement.parseMethod, 'ai_assisted_json');
    assert.equal(result.statement.includedRowCount, 1);
    assert.equal(result.statement.rows[0].invoiceRef, 'INV-9001');
    assert.equal(result.statement.rows[0].dueDate, '2026-01-19');
  } finally {
    if (originalKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('preferred AI assist path can be requested explicitly for a weak PDF import', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';

  try {
    const result = await statementParse._private.parseFile({
      name: 'debtor-statement.pdf',
      contentType: 'application/pdf',
      size: 64,
      data: toBase64('%PDF- weak statement payload'),
    }, {
      fileName: 'debtor-statement.pdf',
      scenarioCurrency: 'GBP',
      forecastStartDate: '2026-01-05',
      paymentTerms: { type: '14_net', customNetDays: 21, receiptLagDays: 0 },
      preferAiAssist: true,
    }, {
      extractPdfText: async () => ({
        text: [
          'Statement extract',
          'INV-9002 05/01/2026 12000 GBP overdue',
        ].join('\n'),
        rawText: [
          'Statement extract',
          'INV-9002 05/01/2026 12000 GBP overdue',
        ].join('\n'),
        strategy: 'native_pdf_text',
        parser: 'pdf-parse',
        totalPages: 1,
        native: { quality: 'weak_native_text' },
        ocr: { quality: 'not_attempted' },
      }),
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            rows: [
              {
                invoice_reference: 'INV-9002',
                invoice_date: '2026-01-05',
                due_date: '2026-01-12',
                outstanding_amount: 12000,
                currency: 'GBP',
                credit_note: false,
                note: 'Recovered by explicit AI assist request',
                confidence: 'medium',
              },
            ],
            warnings: [],
            summary: 'One invoice row recovered.',
          }),
        }),
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.aiAssistUsed, true);
    assert.equal(result.statement.parseMethod, 'ai_assisted_json');
    assert.equal(result.statement.rows[0].invoiceRef, 'INV-9002');
  } finally {
    if (originalKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
