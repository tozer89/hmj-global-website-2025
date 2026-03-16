const test = require('node:test');
const assert = require('node:assert/strict');

test('sitemap function returns a crawlable XML sitemap with key public URLs', async () => {
  const { handler } = require('../netlify/functions/sitemap.js');
  const response = await handler({});

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /application\/xml/);
  assert.match(response.body, /<urlset/);
  assert.match(response.body, /https:\/\/www\.hmj-global\.com\/about/);
  assert.match(response.body, /https:\/\/www\.hmj-global\.com\/jobs/);
  assert.match(response.body, /https:\/\/www\.hmj-global\.com\/candidates/);
  assert.match(response.body, /https:\/\/www\.hmj-global\.com\/jobs\/gold-card-electrician-slough\//);
});
