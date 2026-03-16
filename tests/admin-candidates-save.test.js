const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../netlify/functions/admin-candidates-save.js');

test('splitFullName derives first and last names from a full name string', () => {
  assert.deepEqual(_test.splitFullName('Joseph Tozer'), {
    first_name: 'Joseph',
    last_name: 'Tozer',
  });
});

test('splitFullName preserves multi-part surnames', () => {
  assert.deepEqual(_test.splitFullName('Mary Anne van der Berg'), {
    first_name: 'Mary',
    last_name: 'Anne van der Berg',
  });
});

test('splitFullName handles a single-word name safely', () => {
  assert.deepEqual(_test.splitFullName('Madonna'), {
    first_name: 'Madonna',
    last_name: '',
  });
});
