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
  assert.equal(payload.settings.linkedinTestimonials.items.length, 6);
  assert.match(response.headers['Cache-Control'] || response.headers['cache-control'], /max-age=60/);
});
