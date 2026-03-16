const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  toJob,
  toPublicJob,
  toDbPayload,
  buildPayText,
  cleanArray,
  slugify,
  resolveSection,
  loadStaticJobs,
  isMissingTableError,
  isPublicJob,
  isPublishedLiveJob,
  buildPublicJobSeoSlug,
  buildPublicJobDetailPath,
  PUBLIC_PAGE_DEFAULTS,
  normalisePublicPageConfig,
} = require('../netlify/functions/_jobs-helpers.js');

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
    client_name: ' Confidential Client ',
    customer: ' Main contractor ',
    benefits: [' Travel allowance ', ' Bonus '],
    pay_type: 'day_rate',
    day_rate_min: 450,
    day_rate_max: 550,
    currency: ' eur ',
    apply_url: 'https://example.com',
    published: 1,
    sort_order: 10,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    public_page_config: {
      showCustomer: false,
      showPageMeta: 'true',
      showReference: 'false',
    },
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
  assert.equal(job.clientName, 'Confidential Client');
  assert.equal(job.customer, 'Main contractor');
  assert.deepEqual(job.benefits, ['Travel allowance', 'Bonus']);
  assert.deepEqual(job.publicPageConfig, {
    ...PUBLIC_PAGE_DEFAULTS,
    showCustomer: false,
    showPageMeta: true,
    showReference: false,
  });
  assert.equal(job.payType, 'day_rate');
  assert.equal(job.dayRateMin, 450);
  assert.equal(job.dayRateMax, 550);
  assert.equal(job.currency, 'EUR');
  assert.equal(job.payText, '€450 - €550 per day');
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
    benefits: ['Bonus', ' Pension '],
    customer: 'End client: Confidential',
    clientName: 'Stealth operator',
    publicPageConfig: {
      showCustomer: false,
      showBenefits: false,
      showPageMeta: true,
    },
    payType: 'salary_range',
    salaryMin: '65000',
    salaryMax: 80000,
    currency: 'GBP',
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
    benefits: ['Bonus', 'Pension'],
    client_name: 'Stealth operator',
    customer: 'End client: Confidential',
    public_page_config: {
      ...PUBLIC_PAGE_DEFAULTS,
      showCustomer: false,
      showBenefits: false,
      showPageMeta: true,
    },
    pay_type: 'salary_range',
    day_rate_min: null,
    day_rate_max: null,
    salary_min: 65000,
    salary_max: 80000,
    hourly_min: null,
    hourly_max: null,
    currency: 'GBP',
    apply_url: 'https://apply',
    published: false,
    sort_order: 5,
  });
});

test('toPublicJob strips internal-only fields while preserving public pay and customer data', () => {
  const job = toPublicJob({
    id: 'role-3',
    title: 'Planner',
    status: 'interviewing',
    published: true,
    client_name: 'Internal Client',
    customer: 'Hyperscale data centre client',
    benefits: ['Accommodation'],
    pay_type: 'hourly_range',
    hourly_min: 28,
    hourly_max: 35,
    currency: 'GBP',
    shareSpec: {
      enhanced: true,
      source: 'openai',
      model: 'gpt-5-mini',
      overview: 'Polished share overview',
      responsibilities: ['Lead planning cadence'],
      requirements: ['Advanced Primavera P6'],
    },
  });

  assert.equal(job.clientName, undefined);
  assert.equal(job.customer, 'Hyperscale data centre client');
  assert.deepEqual(job.benefits, ['Accommodation']);
  assert.equal(job.payType, 'hourly_range');
  assert.equal(job.payText, '£28 - £35 per hour');
  assert.equal(job.publicDetailPath, '/jobs/spec.html?id=role-3&slug=planner');
  assert.deepEqual(job.publicPageConfig, PUBLIC_PAGE_DEFAULTS);
  assert.deepEqual(job.shareSpec, {
    enhanced: true,
    source: 'openai',
    model: 'gpt-5-mini',
    overview: 'Polished share overview',
    responsibilities: ['Lead planning cadence'],
    requirements: ['Advanced Primavera P6'],
    generatedAt: null,
  });
});

test('normalisePublicPageConfig applies defaults and understands string booleans', () => {
  assert.deepEqual(
    normalisePublicPageConfig({
      showOverview: 'false',
      showBenefits: true,
      showSecondaryCta: 'true',
      showReference: 'invalid',
    }),
    {
      ...PUBLIC_PAGE_DEFAULTS,
      showOverview: false,
      showBenefits: true,
      showSecondaryCta: true,
      showReference: false,
    }
  );
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
  assert.equal(resolved.key, 'data-centre-delivery');
  const resolvedFromLabel = resolveSection('Data Centre Delivery');
  assert.equal(resolvedFromLabel.label, 'Data Centre Delivery');
  assert.equal(resolvedFromLabel.key, 'data-centre-delivery');
  const custom = resolveSection('Critical Infrastructure');
  assert.equal(custom.label, 'Critical Infrastructure');
  assert.equal(custom.key, 'critical-infrastructure');
});

test('public helper exposes stable public detail paths for any published job', () => {
  assert.equal(isPublicJob({ id: 'role-1', status: 'live', published: true }), true);
  assert.equal(isPublicJob({ id: 'role-1', status: 'interviewing', published: true }), true);
  assert.equal(isPublicJob({ id: 'role-1', status: 'closed', published: true }), true);
  assert.equal(isPublicJob({ id: 'role-1', status: 'live', published: false }), false);
  assert.equal(isPublishedLiveJob({ id: 'role-1', status: 'interviewing', published: true }), true);
  assert.equal(buildPublicJobSeoSlug({ id: 'role-1', title: 'Electrical Supervisor', locationText: 'Frankfurt, Germany', status: 'live', published: true }), 'electrical-supervisor-frankfurt-germany');
  assert.equal(buildPublicJobDetailPath({ id: 'role-1', title: 'Electrical Supervisor', locationText: 'Frankfurt, Germany', status: 'live', published: true }), '/jobs/spec.html?id=role-1&slug=electrical-supervisor-frankfurt-germany');
  assert.equal(buildPublicJobDetailPath({ id: 'role-1', title: 'Electrical Supervisor - Frankfurt', locationText: 'Frankfurt, Germany', status: 'closed', published: true }), '/jobs/spec.html?id=role-1&slug=electrical-supervisor-frankfurt');
  assert.equal(buildPublicJobDetailPath({ id: 'role-1', status: 'live', published: false }), '');
});

test('buildPayText handles competitive and salary range formats', () => {
  assert.equal(buildPayText({ pay_type: 'competitive' }), 'Competitive');
  assert.equal(
    buildPayText({ pay_type: 'salary_range', salary_min: 65000, salary_max: 80000, currency: 'GBP' }),
    '£65,000 - £80,000 per year'
  );
});

test('loadStaticJobs still exposes a legacy static seed for deferred secondary paths', () => {
  const jobs = loadStaticJobs();
  assert.ok(Array.isArray(jobs));
  assert.ok(jobs.length > 0, 'expected seed jobs for fallback');
  assert.ok(jobs.every((job) => job.title && job.sectionKey));
});

test('loadStaticJobs prefers the authored seed file without duplicating rows', () => {
  const jobs = loadStaticJobs();
  const localJsonPath = path.join(__dirname, '..', 'data', 'jobs.json');
  const localJson = JSON.parse(fs.readFileSync(localJsonPath, 'utf8'));
  const localJobs = Array.isArray(localJson?.jobs) ? localJson.jobs : [];

  assert.equal(jobs.length, localJobs.length);
  assert.deepEqual(
    jobs.map((job) => job.id),
    localJobs.map((job) => job.id)
  );
});

test('isMissingTableError matches both legacy relation errors and schema-cache errors', () => {
  assert.equal(
    isMissingTableError(
      { code: '42P01', message: 'relation "public.job_specs" does not exist' },
      'job_specs'
    ),
    true
  );

  assert.equal(
    isMissingTableError(
      { code: 'PGRST205', message: "Could not find the table 'public.job_specs' in the schema cache" },
      'job_specs'
    ),
    true
  );

  assert.equal(
    isMissingTableError(
      { code: 'PGRST205', message: "Could not find the table 'public.jobs' in the schema cache" },
      'job_specs'
    ),
    false
  );
});
