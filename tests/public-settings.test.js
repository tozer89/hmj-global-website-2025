const test = require('node:test');
const assert = require('node:assert/strict');

test('public settings expose live-safe testimonial configuration', async () => {
  const { handler } = require('../netlify/functions/public-settings.js');
  const response = await handler({});
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.settings.linkedinTestimonials.enabled, true);
  assert.equal(Array.isArray(payload.settings.linkedinTestimonials.items), true);
  assert.doesNotMatch(
    JSON.stringify(payload.settings.linkedinTestimonials),
    /recommendation pending|nick to copy|job title pending|company pending|linkedin recommender/i
  );
  assert.equal(payload.settings.creditChecker.enabled, true);
  assert.equal(payload.settings.creditChecker.href, '/credit-check');
  assert.doesNotMatch(payload.settings.creditChecker.pageDisclaimer, /lead-screening/i);
  assert.match(response.headers['Cache-Control'] || response.headers['cache-control'], /max-age=60/);
});

test('public settings keep real testimonials visible while stripping optional placeholder metadata', async () => {
  const helpersPath = require.resolve('../netlify/functions/_settings-helpers.js');
  const handlerPath = require.resolve('../netlify/functions/public-settings.js');
  delete require.cache[helpersPath];
  delete require.cache[handlerPath];
  const helpers = require(helpersPath);
  const originalFetchSettings = helpers.fetchSettings;

  helpers.fetchSettings = async () => ({
    settings: {
      linkedin_testimonials: {
        enabled: true,
        items: [
          {
            id: 'one',
            text: 'Strong communication throughout the programme.',
            name: 'Lewis Fowler',
            title: 'Electrical Senior Authorised Person',
            company: 'Company pending',
            linkedinUrl: 'https://www.linkedin.com/in/lewis-fowler/'
          }
        ]
      },
      credit_checker_settings: helpers.DEFAULT_SETTINGS.credit_checker_settings,
      fiscal_week1_ending: helpers.DEFAULT_SETTINGS.fiscal_week1_ending,
      timesheet_deadline_note: helpers.DEFAULT_SETTINGS.timesheet_deadline_note,
      timesheet_deadline_timezone: helpers.DEFAULT_SETTINGS.timesheet_deadline_timezone,
    },
    source: 'supabase',
    supabase: { ok: true, error: null },
  });

  try {
    delete require.cache[handlerPath];
    const { handler } = require(handlerPath);
    const response = await handler({});
    const payload = JSON.parse(response.body);
    const item = payload.settings.linkedinTestimonials.items[0];

    assert.equal(payload.settings.linkedinTestimonials.items.length, 1);
    assert.equal(item.name, 'Lewis Fowler');
    assert.equal(item.title, 'Electrical Senior Authorised Person');
    assert.equal(item.company, '');
  } finally {
    helpers.fetchSettings = originalFetchSettings;
    delete require.cache[handlerPath];
    delete require.cache[helpersPath];
  }
});
