const test = require('node:test');
const assert = require('node:assert/strict');

test('sitemap function returns a crawlable XML sitemap with key public URLs', async () => {
  const { handler } = require('../netlify/functions/sitemap.js');
  const response = await handler({});

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /application\/xml/);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.match(response.body, /<urlset/);
  assert.match(response.body, /https:\/\/hmjg\.netlify\.app\/about/);
  assert.match(response.body, /https:\/\/hmjg\.netlify\.app\/jobs/);
  assert.match(response.body, /https:\/\/hmjg\.netlify\.app\/candidates/);
  assert.match(response.body, /https:\/\/hmjg\.netlify\.app\/jobs\/gold-card-electrician-slough\//);
});
