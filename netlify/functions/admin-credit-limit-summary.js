'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  sanitizeAssumptions,
  buildForecast,
  analyseCapacity,
  generateFallbackSummary,
  formatCurrency,
} = require('../../lib/credit-limit-forecast.js');

const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
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

function buildPromptContext(assumptions, forecast, capacity) {
  const metrics = forecast.metrics || {};
  const firstBreach = metrics.firstBreach;
  return [
    'Write a concise internal HMJ finance summary in 3 to 5 sentences.',
    'Tone: commercial, precise, calm, non-salesy.',
    'Mention whether the account is within limit, at risk, or over limit.',
    'If there is a breach, mention the first breach week/date.',
    'Quantify safe contractor additions or contractor removals if available.',
    'Reference the key assumptions briefly: currency, payment terms, VAT, invoicing cadence.',
    'Do not use bullets.',
    '',
    'Forecast facts:',
    JSON.stringify({
      clientName: assumptions.clientName || 'Unspecified client',
      scenarioName: assumptions.scenarioName,
      currency: assumptions.currency,
      creditLimit: formatCurrency(metrics.creditLimit || 0, assumptions.currency),
      currentBalance: formatCurrency(metrics.currentBalance || 0, assumptions.currency),
      peakBalance: formatCurrency(metrics.forecastPeakBalance || 0, assumptions.currency),
      minimumHeadroom: formatCurrency(metrics.minimumHeadroom || 0, assumptions.currency),
      overallStatus: forecast.overallStatusLabel,
      firstBreachWeek: firstBreach ? firstBreach.weekNumber : null,
      firstBreachDate: firstBreach ? firstBreach.breachDate : null,
      maxAdditionalContractorsAllowed: capacity && capacity.available ? capacity.maxAdditionalContractorsAllowed : null,
      contractorsToRemove: capacity && capacity.available ? capacity.contractorsToRemove : null,
      maxSafeWeeklyGrossIncrease: capacity && capacity.available ? formatCurrency(capacity.maxSafeWeeklyGrossIncrease || 0, assumptions.currency) : null,
      forecastHorizonWeeks: assumptions.forecastHorizonWeeks,
      vatApplicable: assumptions.vatApplicable,
      vatRate: assumptions.vatRate,
      paymentTerms: assumptions.paymentTerms.type,
      receiptLagDays: assumptions.paymentTerms.receiptLagDays,
      invoicingCadence: assumptions.invoice.cadence,
      invoiceWeekday: assumptions.invoice.invoiceWeekday,
    }, null, 2),
  ].join('\n');
}

async function callOpenAI(promptText) {
  const apiKey = trimString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      error: 'openai_key_missing',
    };
  }

  const model = trimString(process.env.OPENAI_CREDIT_LIMIT_SUMMARY_MODEL, 80) || 'gpt-4.1-mini';
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      max_output_tokens: 220,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You are HMJ Global\'s internal finance planning assistant. Keep summaries concise, factual, commercially useful, and suitable for operations handovers.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: promptText,
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: trimString(payload && (payload.error && payload.error.message || payload.message), 240) || `openai_http_${response.status}`,
      status: response.status,
      model: model,
    };
  }

  const summary = extractOutputText(payload);
  if (!summary) {
    return {
      ok: false,
      error: 'openai_empty_response',
      model: model,
    };
  }

  return {
    ok: true,
    summary: summary,
    model: model,
  };
}

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'invalid_json' }),
    };
  }

  const assumptions = sanitizeAssumptions(payload.assumptions || {});
  const forecast = buildForecast(assumptions);
  const capacity = analyseCapacity(assumptions);
  const fallbackSummary = generateFallbackSummary(forecast, assumptions, capacity);
  const promptText = buildPromptContext(assumptions, forecast, capacity);

  try {
    const ai = await callOpenAI(promptText);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: !!ai.ok,
        summary: ai.ok ? ai.summary : fallbackSummary,
        fallbackSummary: fallbackSummary,
        source: ai.ok ? 'openai' : 'fallback',
        model: ai.model || null,
        error: ai.ok ? null : ai.error || null,
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        summary: fallbackSummary,
        fallbackSummary: fallbackSummary,
        source: 'fallback',
        model: null,
        error: error && error.message ? error.message : 'summary_failed',
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
