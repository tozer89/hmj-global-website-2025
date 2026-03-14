'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const matcherCore = require('../../lib/candidate-matcher-core.js');
const statementImport = require('../../lib/credit-limit-statement-import.js');

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function trimString(value) {
  return typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
}

function safeJsonParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function decodeBase64(value) {
  try {
    const raw = trimString(value).replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
    return Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
}

function buildOptions(body) {
  return {
    fileName: trimString(body?.file?.name),
    fileSize: Number(body?.file?.size) || 0,
    scenarioCurrency: trimString(body?.scenarioCurrency) || 'GBP',
    forecastStartDate: trimString(body?.forecastStartDate),
    paymentTerms: body?.paymentTerms && typeof body.paymentTerms === 'object' ? body.paymentTerms : {},
    extraction: null,
  };
}

async function parseFile(file, options) {
  const content = decodeBase64(file?.data);
  if (!content || !content.length) {
    return {
      ok: false,
      error: 'uploaded_file_unreadable',
      warnings: ['The uploaded file could not be read. Try uploading the file again, or use CSV/XLSX for a cleaner import.'],
      fallbackOptions: ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
    };
  }
  if (content.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: 'uploaded_file_too_large',
      warnings: ['The uploaded file is larger than the 5 MB import limit for this workflow.'],
      fallbackOptions: ['Upload a smaller statement export', 'Continue with manual opening-balance receipts'],
    };
  }

  const sourceType = statementImport.detectSourceType(file?.name, file?.contentType, content);
  if (!sourceType) {
    return {
      ok: false,
      error: 'unsupported_statement_file',
      warnings: ['Supported statement uploads are PDF, XLSX, and CSV.'],
      fallbackOptions: ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
    };
  }

  const parseOptions = Object.assign({}, options, {
    sourceType: sourceType,
    fileName: trimString(file?.name),
    fileSize: Number(file?.size) || content.length,
  });

  if (sourceType === 'csv') {
    const draft = statementImport.parseCsvText(content.toString('utf8'), parseOptions);
    return {
      ok: draft.includedRowCount > 0,
      statement: draft,
      warnings: draft.warnings || [],
      sourceType: sourceType,
      fallbackOptions: draft.includedRowCount > 0 ? [] : ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
    };
  }

  if (sourceType === 'xlsx') {
    try {
      const draft = await statementImport.parseXlsxBuffer(content, parseOptions);
      return {
        ok: draft.includedRowCount > 0,
        statement: draft,
        warnings: draft.warnings || [],
        sourceType: sourceType,
        fallbackOptions: draft.includedRowCount > 0 ? [] : ['Review column mapping', 'Continue with manual opening-balance receipts'],
      };
    } catch (error) {
      return {
        ok: false,
        error: 'xlsx_parse_failed',
        warnings: [trimString(error?.message) || 'The XLSX statement could not be parsed.'],
        fallbackOptions: ['Upload CSV instead', 'Continue with manual opening-balance receipts'],
      };
    }
  }

  try {
    const extraction = await matcherCore.extractPdfText({
      name: trimString(file?.name) || 'statement.pdf',
      buffer: content,
      extension: 'pdf',
    }, {
      enableOcr: true,
    });
    const draft = statementImport.parsePdfText(extraction?.text || extraction?.rawText || '', Object.assign({}, parseOptions, {
      extraction: {
        strategy: trimString(extraction?.strategy),
        parser: trimString(extraction?.parser),
        totalPages: Number(extraction?.totalPages) || 0,
        nativeQuality: trimString(extraction?.native?.quality),
        ocrQuality: trimString(extraction?.ocr?.quality),
      },
    }));
    if (!draft.includedRowCount) {
      return {
        ok: false,
        error: trimString(extraction?.failureCode) || 'pdf_statement_parse_low_confidence',
        statement: draft,
        warnings: draft.warnings.concat([
          'This PDF could not be read confidently. Review the candidate rows below, or upload Excel/CSV for a cleaner import.',
        ]),
        fallbackOptions: ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
      };
    }
    return {
      ok: true,
      statement: draft,
      warnings: draft.warnings || [],
      sourceType: sourceType,
      fallbackOptions: draft.confidence === 'low'
        ? ['Review imported rows before confirming', 'Upload Excel/CSV instead']
        : [],
    };
  } catch (error) {
    return {
      ok: false,
      error: trimString(error?.code) || 'pdf_parse_failed',
      warnings: [
        trimString(error?.message) || 'The PDF statement could not be parsed.',
        'If the PDF is difficult to read, Excel/CSV is usually the safest import path.',
      ],
      fallbackOptions: ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
    };
  }
}

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  const body = safeJsonParse(event.body || '{}');
  const file = body && body.file && typeof body.file === 'object' ? body.file : null;
  if (!file || !trimString(file.name) || !trimString(file.data)) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: 'statement_file_required',
        warnings: ['Upload a debtor statement file to build the opening-balance receipt schedule.'],
      }),
    };
  }

  const result = await parseFile(file, buildOptions(body));
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  };
};

exports.handler = withAdminCors(baseHandler);
