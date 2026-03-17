const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidate registration page exposes updated skill suggestions and submit feedback wiring', () => {
  const html = read('candidates.html');

  assert.match(html, /id="candidateSubmitFeedback"/);
  assert.match(html, /assets\/js\/candidates\.enhanced\.js\?v=4/);
  assert.match(html, /assets\/js\/candidates\.portal\.js\?v=12/);
});

test('candidate registration enhancement script includes the new 10-skill default suggestion set', () => {
  const source = read('assets/js/candidates.enhanced.js');

  [
    'Gold Card',
    'IPAF',
    '18th Edition',
    'IST',
    'SAT',
    'BMS',
    'EPMS',
    'Project Manager',
    'Project Planner',
    'Quantity Surveyor',
  ].forEach((skill) => {
    assert.match(source, new RegExp(skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('candidate portal submit flow surfaces invalid-state feedback and signed-in success handling', () => {
  const source = read('assets/js/candidates.portal.js');

  assert.match(source, /candidate_signed_in/);
  assert.match(source, /Please complete the required fields highlighted below before sending your profile\./);
  assert.match(source, /If sign-in is immediately available, we will open your dashboard automatically\./);
  assert.match(source, /Success\. Your profile has been sent to HMJ and you are now signed into your candidate dashboard\./);
});
