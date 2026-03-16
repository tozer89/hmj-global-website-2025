const test = require('node:test');
const assert = require('node:assert/strict');

test('robots function returns a sitemap URL on the active host', async () => {
  const { handler } = require('../netlify/functions/robots.js');
  const response = await handler({
    headers: {
      host: 'hmjg.netlify.app',
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.match(response.body, /Disallow: \/admin\//);
  assert.match(response.body, /Sitemap: https:\/\/hmjg\.netlify\.app\/\.netlify\/functions\/sitemap/);
});
