const test = require('node:test');
const assert = require('node:assert/strict');

const { toJob, toDbPayload, cleanArray } = require('../netlify/functions/_jobs-helpers.js');

test('toJob normalises database row fields', () => {
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
  assert.equal(job.section, 'dc'); // default fallback
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
});

test('toDbPayload trims values and converts arrays', () => {
  const payload = toDbPayload({
    id: ' role-2 ',
    title: ' Project Manager ',
    status: 'closed',
    section: 'substations',
    discipline: 'HV',
    type: 'contract',
    locationText: ' Dublin ',
    locationCode: 'ie-dub',
    overview: 'Manage works',
    responsibilities: [' Plan ', ' Execute ', ''],
    requirements: ' - PMP\n - Experience ',
    keywords: 'pm, hv',
    applyUrl: 'https://apply',
    published: false,
    sortOrder: 5,
  });

  assert.deepEqual(payload, {
    id: 'role-2',
    title: 'Project Manager',
    status: 'closed',
    section: 'substations',
    discipline: 'HV',
    type: 'contract',
    location_text: 'Dublin',
    location_code: 'ie-dub',
    overview: 'Manage works',
    responsibilities: ['Plan', 'Execute'],
    requirements: ['PMP', 'Experience'],
    keywords: 'pm, hv',
    apply_url: 'https://apply',
    published: false,
    sort_order: 5,
  });
});

test('cleanArray supports newline and bullet-separated strings', () => {
  assert.deepEqual(cleanArray(' - One\n* Two\n\u2022 Three '), ['One', 'Two', 'Three']);
  assert.deepEqual(cleanArray([' A ', null, 'B ']), ['A', 'B']);
  assert.deepEqual(cleanArray(undefined), []);
});
