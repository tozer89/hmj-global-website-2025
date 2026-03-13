const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildShortLinkPath,
  buildShortLinkUrl,
  buildSlugSuggestions,
  chooseAvailableSlug,
  mergeDestinationQuery,
  normaliseShortLinkSlug,
  suggestShortLinkSlug,
  validateDestinationUrl,
} = require('../lib/short-links.js');

test('validateDestinationUrl accepts standard http and https links', () => {
  const https = validateDestinationUrl('https://hmj-global.com/jobs/spec.html?id=role-1');
  const http = validateDestinationUrl('http://example.com/path?q=1');

  assert.equal(https.ok, true);
  assert.equal(https.url, 'https://hmj-global.com/jobs/spec.html?id=role-1');
  assert.equal(http.ok, true);
  assert.equal(http.url, 'http://example.com/path?q=1');
});

test('validateDestinationUrl rejects malformed or unsafe destination values', () => {
  assert.equal(validateDestinationUrl('').ok, false);
  assert.equal(validateDestinationUrl('javascript:alert(1)').ok, false);
  assert.equal(validateDestinationUrl('https://user:pass@example.com').ok, false);
  assert.equal(validateDestinationUrl('not-a-url').ok, false);
});

test('slug helpers normalise and suggest stable short codes', () => {
  assert.equal(normaliseShortLinkSlug(' Candidate Pack '), 'candidate-pack');
  assert.equal(
    suggestShortLinkSlug({
      title: '',
      destinationUrl: 'https://hmj-global.com/forms/candidate-pack?source=crm',
    }),
    'candidate-pack'
  );
  assert.equal(
    suggestShortLinkSlug({
      title: 'Planner Dublin',
      destinationUrl: 'https://example.com/anything',
    }),
    'planner-dublin'
  );
});

test('chooseAvailableSlug and buildSlugSuggestions avoid collisions cleanly', () => {
  const existing = new Set(['candidate-pack', 'candidate-pack-2', 'candidate-pack-3']);

  assert.equal(chooseAvailableSlug(existing, 'candidate-pack'), 'candidate-pack-4');
  assert.deepEqual(
    buildSlugSuggestions('candidate-pack', 3),
    ['candidate-pack-2', 'candidate-pack-3', 'candidate-pack-4']
  );
});

test('public path helpers always build /go links', () => {
  assert.equal(buildShortLinkPath('candidate-pack'), '/go/candidate-pack');
  assert.equal(buildShortLinkUrl('https://hmj-global.com/', 'candidate-pack'), 'https://hmj-global.com/go/candidate-pack');
});

test('mergeDestinationQuery preserves stored query strings and appends incoming params', () => {
  const merged = mergeDestinationQuery(
    'https://hmj-global.com/forms/apply?campaign=spring',
    new URLSearchParams('ref=crm&campaign=summer')
  );

  assert.equal(
    merged,
    'https://hmj-global.com/forms/apply?campaign=spring&ref=crm&campaign=summer'
  );
});
