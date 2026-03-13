const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildApplicationUrl,
  extractApplicationContext,
  buildApplicationSubject,
  buildApplicationSummary,
  isInternalContactUrl,
} = require('../js/job-application-context.js');

test('buildApplicationUrl normalises HMJ contact links and appends structured job context', () => {
  const url = buildApplicationUrl({
    origin: 'https://deploy-preview-42--hmj-global.netlify.app',
    currentUrl: 'https://deploy-preview-42--hmj-global.netlify.app/jobs/spec.html?slug=share-123&id=job-9',
    rawApplyUrl: 'https://www.hmj-global.com/contact.html?utm_source=share',
    shareCode: 'share-123',
    source: 'job-share',
    job: {
      id: 'job-9',
      title: 'Senior Planner',
      locationText: 'Macclesfield, UK',
      type: 'contract',
      payText: '£500 - £650 per day',
    },
  });

  const parsed = new URL(url, 'https://deploy-preview-42--hmj-global.netlify.app');
  assert.equal(url.startsWith('/contact.html?'), true);
  assert.equal(parsed.origin, 'https://deploy-preview-42--hmj-global.netlify.app');
  assert.equal(parsed.pathname, '/contact.html');
  assert.equal(parsed.searchParams.get('utm_source'), 'share');
  assert.equal(parsed.searchParams.get('role'), 'Senior Planner');
  assert.equal(parsed.searchParams.get('job_title'), 'Senior Planner');
  assert.equal(parsed.searchParams.get('job_id'), 'job-9');
  assert.equal(parsed.searchParams.get('job_location'), 'Macclesfield, UK');
  assert.equal(parsed.searchParams.get('job_type'), 'contract');
  assert.equal(parsed.searchParams.get('job_pay'), '£500 - £650 per day');
  assert.equal(parsed.searchParams.get('job_share_code'), 'share-123');
  assert.equal(parsed.searchParams.get('job_source'), 'job-share');
});

test('buildApplicationUrl ignores non-contact apply URLs when forced into the HMJ application flow', () => {
  const url = buildApplicationUrl({
    origin: 'https://hmj-global.com',
    rawApplyUrl: 'https://external.example.com/apply',
    job: {
      id: 'job-10',
      title: 'CSA Package Manager',
    },
  });

  assert.equal(url.startsWith('/contact.html?'), true);
  assert.equal(url.includes('external.example.com'), false);
  assert.equal(url.includes('job_id=job-10'), true);
});

test('extractApplicationContext reads structured parameters and preserves fallback role support', () => {
  const context = extractApplicationContext('?role=Planner&job_id=job-11&job_location=Dublin&job_type=permanent&job_pay=%C2%A380000%20per%20year&job_share_code=share-xyz&job_source=job-share&job_spec_url=https%3A%2F%2Fhmj-global.com%2Fjobs%2Fspec.html%3Fslug%3Dshare-xyz');

  assert.deepEqual(context, {
    role: 'Planner',
    title: 'Planner',
    jobId: 'job-11',
    reference: 'job-11',
    locationText: 'Dublin',
    employmentType: 'permanent',
    payText: '£80000 per year',
    shareCode: 'share-xyz',
    source: 'job-share',
    specUrl: 'https://hmj-global.com/jobs/spec.html?slug=share-xyz',
    hasContext: true,
  });
});

test('buildApplicationSubject and buildApplicationSummary keep application context readable', () => {
  const context = {
    title: 'Electrical Project Manager',
    jobId: 'job-12',
    locationText: 'Frankfurt, Germany',
    employmentType: 'contract',
    payText: '€650 - €750 per day',
  };

  assert.equal(buildApplicationSubject(context), 'Application: Electrical Project Manager (job-12)');
  assert.equal(
    buildApplicationSummary(context),
    'Electrical Project Manager • Frankfurt, Germany • contract • €650 - €750 per day'
  );
});

test('isInternalContactUrl recognises both same-origin and HMJ-domain contact pages', () => {
  assert.equal(
    isInternalContactUrl(new URL('https://hmj-global.com/contact.html'), 'https://deploy-preview-4--hmj-global.netlify.app'),
    true
  );
  assert.equal(
    isInternalContactUrl(new URL('https://external.example.com/contact.html'), 'https://hmj-global.com'),
    false
  );
});
