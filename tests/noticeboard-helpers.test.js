const assert = require('node:assert/strict');
const {
  computeEffectiveStatus,
  isPubliclyVisible,
  toDbPayload,
  toPublicNotice,
  sortNoticeCollection,
} = require('../netlify/functions/_noticeboard-helpers.js');

function run() {
  const now = new Date('2026-03-13T12:00:00.000Z');

  assert.equal(
    computeEffectiveStatus({
      status: 'scheduled',
      publish_at: '2026-03-14T12:00:00.000Z',
    }, now),
    'scheduled',
    'future scheduled notices should remain scheduled'
  );

  assert.equal(
    isPubliclyVisible({
      status: 'scheduled',
      publish_at: '2026-03-14T12:00:00.000Z',
    }, now),
    false,
    'future scheduled notices must stay hidden publicly'
  );

  const liveScheduled = {
    id: 'notice-live',
    title: 'Live notice',
    body: 'Body copy',
    status: 'scheduled',
    publish_at: '2026-03-12T08:00:00.000Z',
  };
  assert.equal(
    computeEffectiveStatus(liveScheduled, now),
    'published',
    'scheduled notices should become effectively published once the publish time passes'
  );
  assert.equal(!!toPublicNotice(liveScheduled), true, 'live scheduled notices should be emitted publicly');

  assert.equal(
    computeEffectiveStatus({
      status: 'published',
      publish_at: '2026-03-10T12:00:00.000Z',
      expires_at: '2026-03-12T00:00:00.000Z',
    }, now),
    'archived',
    'expired notices should resolve to archived'
  );

  const draftPayload = toDbPayload({
    title: 'HMJ milestone',
    body: 'Detailed update for the board.',
    status: 'published',
    ctaUrl: 'javascript:alert(1)',
  }, { now });

  assert.equal(draftPayload.status, 'published');
  assert.equal(draftPayload.publish_at, now.toISOString(), 'published notices without a date should publish immediately');
  assert.equal(draftPayload.cta_url, null, 'unsafe CTA URLs should be discarded');

  assert.throws(
    () => toDbPayload({
      title: 'Scheduled without time',
      body: 'This should fail.',
      status: 'scheduled',
    }, { now }),
    /publish date and time/i,
    'scheduled notices must require a publish timestamp'
  );

  const ordered = sortNoticeCollection([
    {
      id: 'b',
      title: 'Second',
      featured: false,
      sortOrder: 20,
      publishAt: '2026-03-10T08:00:00.000Z',
    },
    {
      id: 'a',
      title: 'Featured first',
      featured: true,
      sortOrder: 200,
      publishAt: '2026-03-01T08:00:00.000Z',
    },
    {
      id: 'c',
      title: 'Lower sort weight',
      featured: false,
      sortOrder: 10,
      publishAt: '2026-03-11T08:00:00.000Z',
    },
  ]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['a', 'c', 'b'],
    'featured notices should sort first, then by sort order'
  );

  console.log('noticeboard helper tests passed');
}

run();
