const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyBulkEditsToJob,
  applyTagOperation,
  createDuplicateJob,
  sanitiseBulkEdits,
} = require('../netlify/functions/_jobs-bulk-helpers.js');

test('sanitiseBulkEdits normalises supported scalar fields and tags', () => {
  const edits = sanitiseBulkEdits({
    status: ' Interviewing ',
    published: 'false',
    section: ' Critical Infrastructure ',
    type: ' Contract ',
    sortOrder: '42',
    tags: {
      mode: 'append',
      values: ' HV, QA/QC , hv ',
    },
  });

  assert.deepEqual(edits, {
    status: 'interviewing',
    published: false,
    section: 'Critical Infrastructure',
    type: 'contract',
    sortOrder: 42,
    tags: {
      mode: 'append',
      values: ['HV', 'QA/QC'],
    },
  });
});

test('sanitiseBulkEdits rejects invalid bulk values', () => {
  assert.throws(
    () => sanitiseBulkEdits({ status: 'draft' }),
    /valid status/i
  );

  assert.throws(
    () => sanitiseBulkEdits({ type: 'temporary' }),
    /valid employment type/i
  );

  assert.throws(
    () => sanitiseBulkEdits({ tags: { mode: 'append', values: [] } }),
    /need at least one tag/i
  );
});

test('applyTagOperation supports append, remove, and replace without duplicates', () => {
  assert.deepEqual(
    applyTagOperation(['HV', 'QA/QC'], { mode: 'append', values: ['Commissioning', 'hv'] }),
    ['HV', 'QA/QC', 'Commissioning']
  );

  assert.deepEqual(
    applyTagOperation(['HV', 'QA/QC', 'Commissioning'], { mode: 'remove', values: ['qa/qc'] }),
    ['HV', 'Commissioning']
  );

  assert.deepEqual(
    applyTagOperation(['HV'], { mode: 'replace', values: 'Safety, Quality' }),
    ['Safety', 'Quality']
  );
});

test('applyBulkEditsToJob updates only enabled fields and rebuilds derived section/tag data', () => {
  const updated = applyBulkEditsToJob({
    id: 'job-1',
    title: 'Senior Planner',
    section: 'General',
    sectionLabel: 'General',
    sectionKey: 'general',
    status: 'live',
    published: true,
    discipline: 'Planning',
    type: 'permanent',
    tags: ['HV', 'QA/QC'],
    keywords: 'HV, QA/QC',
    customer: 'Client A',
    sortOrder: 10,
  }, {
    section: 'Critical Infrastructure',
    published: false,
    customer: '',
    tags: {
      mode: 'remove',
      values: ['QA/QC'],
    },
  });

  assert.equal(updated.section, 'Critical Infrastructure');
  assert.equal(updated.sectionLabel, 'Critical Infrastructure');
  assert.equal(updated.sectionKey, 'critical-infrastructure');
  assert.equal(updated.published, false);
  assert.equal(updated.customer, '');
  assert.deepEqual(updated.tags, ['HV']);
  assert.equal(updated.keywords, 'HV');
  assert.equal(updated.title, 'Senior Planner');
  assert.equal(updated.status, 'live');
  assert.equal(updated.sortOrder, 10);
});

test('createDuplicateJob generates safe unique ids and unpublished copy titles', () => {
  const registries = {
    ids: new Set(['planner-role', 'planner-role-copy', 'planner-role-copy-2']),
    titles: new Set(['senior planner', 'senior planner (copy)']),
  };

  const duplicate = createDuplicateJob({
    id: 'planner-role',
    title: 'Senior Planner',
    published: true,
    section: 'General',
  }, registries);

  assert.equal(duplicate.id, 'planner-role-copy-3');
  assert.equal(duplicate.title, 'Senior Planner (Copy 2)');
  assert.equal(duplicate.published, false);
  assert.equal(duplicate.section, 'General');
});
