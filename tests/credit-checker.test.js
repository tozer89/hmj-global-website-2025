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
    consent_confirmed: false,
  });

  const errors = validatePublicSubmission(input, {});

  assert.ok(errors.some((entry) => /company/i.test(entry)));
  assert.ok(errors.some((entry) => /valid email/i.test(entry)));
  assert.ok(errors.some((entry) => /HMJ may contact you/i.test(entry)));
});

test('public widget settings expose a safe, hidden-route friendly payload', () => {
  const widget = publicWidgetSettings({});

  assert.equal(widget.enabled, true);
  assert.equal(widget.widgetEnabled, true);
  assert.equal(widget.href, '/credit-check');
  assert.match(widget.buttonLabel, /indicative/i);
});
