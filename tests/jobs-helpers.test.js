const test = require('node:test');
const assert = require('node:assert/strict');

const { toJob, toDbPayload, cleanArray, slugify, resolveSection } = require('../netlify/functions/_jobs-helpers.js');

test('toJob normalises database row fields and derives tags/section meta', () => {
  const row = {
    id: ' role-1 ',
    title: '  Lead Engineer  ',
    status: null,
    section: '',
    discipline: ' Data Centre ',
    type: undefined,
    location_text: '  London ',
    location_code: ' uk-lon ',
    overview: '  Build stuff  ',
    responsibilities: ['Deliver', '  Test  '],
    requirements: null,
    keywords: 'power, hv',
    apply_url: 'https://example.com',
    published: 1,
    sort_order: 10,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  };

  const job = toJob(row);
  assert.equal(job.id, 'role-1');
  assert.equal(job.status, 'live'); // default fallback
  assert.equal(job.section, 'General');
  assert.equal(job.sectionLabel, 'General');
  assert.equal(job.sectionKey, 'general');
  assert.equal(job.type, 'permanent');
  assert.equal(job.locationText, 'London');
  assert.equal(job.locationCode, 'uk-lon');
  assert.equal(job.overview, 'Build stuff');
  assert.deepEqual(job.responsibilities, ['Deliver', 'Test']);
  assert.deepEqual(job.requirements, []);
  assert.equal(job.applyUrl, 'https://example.com');
  assert.equal(job.published, true);
  assert.equal(job.sortOrder, 10);
  assert.equal(job.createdAt, '2025-01-01T00:00:00Z');
  assert.equal(job.updatedAt, '2025-01-02T00:00:00Z');
  assert.deepEqual(job.tags, ['power', 'hv']);
});

test('toDbPayload trims values, converts arrays, and flattens tags to keywords string', () => {
  const payload = toDbPayload({
    id: ' role-2 ',
    title: ' Project Manager ',
    status: 'closed',
    section: 'Critical Infrastructure',
    discipline: 'HV',
    type: 'contract',
    locationText: ' Dublin ',
    locationCode: 'ie-dub',
    overview: 'Manage works',
    responsibilities: [' Plan ', ' Execute ', ''],
    requirements: ' - PMP\n - Experience ',
    tags: ['PM', 'HV'],
    applyUrl: 'https://apply',
    published: false,
    sortOrder: 5,
  });

  assert.deepEqual(payload, {
    id: 'role-2',
    title: 'Project Manager',
    status: 'closed',
    section: 'Critical Infrastructure',
    discipline: 'HV',
    type: 'contract',
    location_text: 'Dublin',
    location_code: 'ie-dub',
    overview: 'Manage works',
    responsibilities: ['Plan', 'Execute'],
    requirements: ['PMP', 'Experience'],
    keywords: 'PM, HV',
    apply_url: 'https://apply',
    published: false,
    sort_order: 5,
  });
});

test('cleanArray supports newline, comma, and bullet-separated strings', () => {
  assert.deepEqual(cleanArray(' - One\n* Two\n\u2022 Three , Four'), ['One', 'Two', 'Three', 'Four']);
  assert.deepEqual(cleanArray([' A ', null, 'B ']), ['A', 'B']);
  assert.deepEqual(cleanArray(undefined), []);
});

test('slugify and resolveSection provide stable keys', () => {
  assert.equal(slugify('Data Centre Delivery'), 'data-centre-delivery');
  const resolved = resolveSection('dc');
  assert.equal(resolved.label, 'Data Centre Delivery');
  assert.equal(resolved.key, 'dc');
  const custom = resolveSection('Critical Infrastructure');
  assert.equal(custom.label, 'Critical Infrastructure');
  assert.equal(custom.key, 'critical-infrastructure');
});
