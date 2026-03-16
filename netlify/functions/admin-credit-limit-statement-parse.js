'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const matcherCore = require('../../lib/candidate-matcher-core.js');
const statementImport = require('../../lib/credit-limit-statement-import.js');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const AI_STATEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'warnings', 'summary'],
  properties: {
    rows: {
      type: 'array',
      maxItems: 240,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'invoice_reference',
          'invoice_date',
          'due_date',
          'outstanding_amount',
          'currency',
          'credit_note',
          'note',
          'confidence',
        ],
        properties: {
          invoice_reference: { type: 'string' },
          invoice_date: { type: 'string' },
          due_date: { type: 'string' },
          outstanding_amount: { type: 'number' },
          currency: { type: 'string' },
          credit_note: { type: 'boolean' },
          note: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low', ''],
          },
        },
      },
    },
    warnings: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
};
const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
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
    preferAiAssist: body?.preferAiAssist === true,
    extraction: null,
  };
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (trimString(payload.output_text)) return trimString(payload.output_text);

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (let index = 0; index < output.length; index += 1) {
    const item = output[index];
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
      const part = content[contentIndex];
      const text = trimString(part && (part.text || part.output_text || part.summary));
      if (text) return text;
    }
  }

  return '';
}

function hasAiAssistConfigured() {
  const apiKey = trimString(process.env.OPENAI_API_KEY);
  return !!apiKey && !/^YOUR_OPENAI_API_KEY$/i.test(apiKey);
}

async function callOpenAIStatementAssist(extractedText, options, overrides) {
  const apiKey = trimString(process.env.OPENAI_API_KEY);
  if (!apiKey || /^YOUR_OPENAI_API_KEY$/i.test(apiKey)) {
    return {
      ok: false,
      error: 'openai_key_missing',
    };
  }

  const requestFetch = overrides && typeof overrides.fetchImpl === 'function'
    ? overrides.fetchImpl
    : fetchImpl;
  const model = trimString(process.env.OPENAI_CREDIT_LIMIT_STATEMENT_MODEL, 80) || 'gpt-4.1-mini';
  const sourceText = trimString(extractedText).slice(0, 32000);
  if (!sourceText) {
    return {
      ok: false,
      error: 'pdf_statement_text_unavailable',
    };
  }

  const prompt = [
    'Extract open invoice rows from this debtor statement text.',
    'Return only rows that appear to be invoices or credit notes with an outstanding/open balance.',
    'Use the statement text only. Do not invent rows.',
    'If due date is missing, leave it blank.',
    'If invoice date is missing, leave it blank.',
    'If currency is not stated on a row, infer it only when the statement clearly shows one currency throughout; otherwise leave it blank.',
    'Use negative outstanding_amount for credit notes.',
    'The output must match the provided JSON schema exactly.',
    '',
    'Scenario context:',
    JSON.stringify({
      scenarioCurrency: trimString(options.scenarioCurrency) || 'GBP',
      forecastStartDate: trimString(options.forecastStartDate),
      paymentTerms: options.paymentTerms || {},
      fileName: trimString(options.fileName),
    }, null, 2),
    '',
    'Statement text:',
    sourceText,
  ].join('\n');

  const requestBody = {
    model: model,
    max_output_tokens: 2200,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'You are HMJ Global\'s internal finance data extraction assistant. Return only schema-compliant JSON and keep uncertain fields blank rather than guessing.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: prompt,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'credit_limit_statement_rows',
        schema: AI_STATEMENT_SCHEMA,
        strict: true,
      },
    },
  };

  try {
    const response = await requestFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: trimString(payload && (payload.error && payload.error.message || payload.message), 240) || `openai_http_${response.status}`,
      };
    }

    const parsed = safeJsonParse(extractOutputText(payload));
    const rows = Array.isArray(parsed && parsed.rows) ? parsed.rows : [];
    if (!rows.length) {
      return {
        ok: false,
        error: 'openai_statement_empty',
      };
    }

    const draft = statementImport.buildAiAssistedDraft(rows.map(function (row) {
      return {
        invoice_reference: trimString(row.invoice_reference),
        invoice_date: trimString(row.invoice_date),
        due_date: trimString(row.due_date),
        outstanding_amount: Number(row.outstanding_amount) || 0,
        currency: trimString(row.currency),
        credit_note: !!row.credit_note,
        note: trimString(row.note),
        confidence: trimString(row.confidence),
      };
    }), Object.assign({}, options, {
      parseMethod: 'ai_assisted_json',
      warnings: (Array.isArray(parsed && parsed.warnings) ? parsed.warnings : []).concat([
        'AI-assisted extraction was used because the standard PDF parser had low confidence. Review every row before confirming.',
      ]),
      extraction: Object.assign({}, options.extraction || {}, {
        aiAssist: true,
        aiModel: model,
        aiSummary: trimString(parsed && parsed.summary, 240),
      }),
    }));

    return {
      ok: draft.includedRowCount > 0,
      statement: draft,
      model: model,
    };
  } catch (error) {
    return {
      ok: false,
      error: trimString(error && error.message, 240) || 'openai_statement_failed',
    };
  }
}

function shouldUseAiAssist(draft, extraction) {
  const confidence = trimString(draft && draft.confidence);
  const includedRowCount = Number(draft && draft.includedRowCount) || 0;
  const parseMethod = trimString(draft && draft.parseMethod);
  const nativeQuality = trimString(extraction && extraction.nativeQuality);
  if (!includedRowCount) return true;
  if (confidence === 'low') return true;
  if (parseMethod === 'heuristic_lines' && confidence !== 'high' && nativeQuality === 'weak_native_text') return true;
  return extraction && trimString(extraction.strategy) === 'ocr_pdf_text' && confidence !== 'high';
}

async function parseFile(file, options, overrides) {
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
    const extractPdfText = overrides && typeof overrides.extractPdfText === 'function'
      ? overrides.extractPdfText
      : matcherCore.extractPdfText;
    const extraction = await extractPdfText({
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
    const aiAssistAvailable = hasAiAssistConfigured();
    if (parseOptions.preferAiAssist && aiAssistAvailable) {
      const aiPreferred = await callOpenAIStatementAssist(extraction?.text || extraction?.rawText || '', parseOptions, overrides);
      if (aiPreferred.ok && aiPreferred.statement) {
        return {
          ok: true,
          statement: aiPreferred.statement,
          warnings: aiPreferred.statement.warnings || [],
          sourceType: sourceType,
          aiAssistAvailable: true,
          aiAssistUsed: true,
          fallbackOptions: ['Review imported rows before confirming', 'Upload Excel/CSV instead'],
        };
      }
      draft.warnings = (draft.warnings || []).concat([
        'AI-assisted extraction could not improve this PDF, so the best standard parse has been left in place for review.',
      ]);
    } else if (shouldUseAiAssist(draft, draft.extraction) && aiAssistAvailable) {
      const ai = await callOpenAIStatementAssist(extraction?.text || extraction?.rawText || '', parseOptions, overrides);
      if (ai.ok && ai.statement) {
        return {
          ok: true,
          statement: ai.statement,
          warnings: ai.statement.warnings || [],
          sourceType: sourceType,
          aiAssistAvailable: true,
          aiAssistUsed: true,
          fallbackOptions: ['Review imported rows before confirming', 'Upload Excel/CSV instead'],
        };
      }
      draft.warnings = (draft.warnings || []).concat([
        'AI-assisted extraction was unavailable for this PDF, so the best standard parse has been left in place for review.',
      ]);
    }
    if (!draft.includedRowCount) {
      return {
        ok: false,
        error: trimString(extraction?.failureCode) || 'pdf_statement_parse_low_confidence',
        statement: draft,
        warnings: draft.warnings.concat([
          'This PDF could not be read confidently. Review the candidate rows below, or upload Excel/CSV for a cleaner import.',
        ]),
        aiAssistAvailable: aiAssistAvailable,
        fallbackOptions: aiAssistAvailable
          ? ['AI-assisted extraction was not able to produce a reliable schedule', 'Upload Excel/CSV instead', 'Continue with manual opening-balance receipts']
          : ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
      };
    }
    return {
      ok: true,
      statement: draft,
      warnings: draft.warnings || [],
      sourceType: sourceType,
      aiAssistAvailable: aiAssistAvailable,
      aiAssistUsed: false,
      fallbackOptions: draft.confidence === 'low'
        ? (aiAssistAvailable
          ? ['Review imported rows before confirming', 'AI-assisted extraction is available if this PDF still looks weak', 'Upload Excel/CSV instead']
          : ['Review imported rows before confirming', 'Upload Excel/CSV instead'])
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
exports._private = {
  parseFile,
  callOpenAIStatementAssist,
  shouldUseAiAssist,
};
