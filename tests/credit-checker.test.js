const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateIndicativeLimit,
  normalisePublicSubmission,
  publicWidgetSettings,
  validatePublicSubmission,
} = require('../lib/credit-limit-checker.js');

test('credit checker calculation stays conservative and respects configured caps', () => {
  const input = normalisePublicSubmission({
    full_name: 'Test User',
    company: 'Example Ltd',
    email: 'test@example.com',
    turnover_band: 'gt50m',
    years_trading_band: 'gt10',
    sector: 'data_centre',
    company_structure: 'plc',
    payment_terms_band: 'up_to_30',
    accounts_status: 'strong',
    consent_confirmed: true,
  });

  const result = calculateIndicativeLimit(input, {});

  assert.equal(result.mid, 200000);
  assert.equal(result.high, 250000);
  assert.ok(result.low >= 2500);
  assert.match(result.rangeLabel, /^£/);
});

test('credit checker validation blocks incomplete or unconsented submissions', () => {
  const input = normalisePublicSubmission({
    full_name: 'Test User',
    company: '',
    email: 'not-an-email',
    turnover_band: 'lt500k',
    years_trading_band: 'lt2',
    sector: 'other',
    company_structure: '',
    payment_terms_band: '',
    accounts_status: '',
    consent_confirmed: false,
  });

  const errors = validatePublicSubmission(input, {});

  assert.ok(errors.some((entry) => /company/i.test(entry)));
  assert.ok(errors.some((entry) => /valid email/i.test(entry)));
  assert.ok(errors.some((entry) => /business structure/i.test(entry)));
  assert.ok(errors.some((entry) => /payment terms/i.test(entry)));
  assert.ok(errors.some((entry) => /accounts position/i.test(entry)));
  assert.ok(errors.some((entry) => /HMJ may contact you/i.test(entry)));
});

test('credit checker responds materially to stronger vs weaker underwriting signals', () => {
  const stronger = calculateIndicativeLimit(normalisePublicSubmission({
    full_name: 'Test User',
    company: 'Example Ltd',
    email: 'test@example.com',
    turnover_band: '5m_15m',
    years_trading_band: 'gt10',
    sector: 'professional',
    company_structure: 'ltd',
    payment_terms_band: 'up_to_30',
    accounts_status: 'strong',
    consent_confirmed: true,
  }), {});
  const weaker = calculateIndicativeLimit(normalisePublicSubmission({
    full_name: 'Test User',
    company: 'Example Ltd',
    email: 'test@example.com',
    turnover_band: '5m_15m',
    years_trading_band: 'gt10',
    sector: 'professional',
    company_structure: 'sole_trader',
    payment_terms_band: 'gt90',
    accounts_status: 'pressured',
    consent_confirmed: true,
  }), {});

  assert.ok(stronger.mid > weaker.mid);
  assert.ok(stronger.high > weaker.high);
});

test('public widget settings expose a safe, hidden-route friendly payload', () => {
  const widget = publicWidgetSettings({});

  assert.equal(widget.enabled, true);
  assert.equal(widget.widgetEnabled, true);
  assert.equal(widget.href, '/credit-check');
  assert.match(widget.buttonLabel, /indicative/i);
  assert.doesNotMatch(widget.pageDisclaimer, /lead-screening/i);
});
