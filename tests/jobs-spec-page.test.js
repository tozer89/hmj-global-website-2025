const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function buildSpecHtml() {
  const file = path.join(process.cwd(), 'jobs', 'spec.html');
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/g, '');
}

async function settle(window, passes = 8) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

test('job spec page renders printable share copy from payload without fetching', async () => {
  const payload = {
    job: {
      id: 'spec-role-1',
      title: 'Senior Planning Engineer',
      status: 'live',
      section: 'Project Controls',
      sectionLabel: 'Project Controls',
      discipline: 'Project Controls',
      type: 'contract',
      locationText: 'London, UK',
      overview: 'Base advert overview that should be replaced by share-spec copy.',
      responsibilities: [
        'Base responsibility',
      ],
      requirements: [
        'Base requirement',
      ],
      tags: ['Primavera P6', 'Infrastructure'],
      benefits: ['Long-term programme exposure'],
      payText: 'Competitive day rate',
      published: true,
      publicPageConfig: {
        showOverview: true,
        showPay: true,
        showCustomer: false,
        showBenefits: true,
        showResponsibilities: true,
        showRequirements: true,
        showTags: true,
        showRoleHighlights: true,
        showApplyPanel: true,
        showSecondaryCta: true,
        showPageMeta: true,
        showReference: true,
      },
      shareSpec: {
        enhanced: true,
        source: 'openai',
        model: 'gpt-5-mini',
        generatedAt: '2026-03-15T12:00:00.000Z',
        overview: 'Polished HMJ share-spec overview for candidates and print output.',
        responsibilities: [
          'Own the integrated programme schedule',
          'Lead progress and recovery planning reviews',
        ],
        requirements: [
          'Advanced Primavera P6 capability',
          'Strong stakeholder communication',
        ],
      },
    },
    meta: {
      slug: 'spec-role-1',
      jobId: 'spec-role-1',
      created_at: '2026-03-15T12:00:00.000Z',
      refreshed_at: '2026-03-15T12:30:00.000Z',
    },
  };
  const encodedPayload = encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString('base64'));
  const html = buildSpecHtml();

  const dom = new JSDOM(html, {
    url: `https://example.com/jobs/spec.html?payload=${encodedPayload}`,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = () => ({
        matches: false,
        media: '',
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.scrollTo = () => {};
      window.print = () => {};
      window.fetch = async (url) => {
        throw new Error(`Unexpected fetch: ${url}`);
      };
      window.HMJAnalytics = { track() {} };
      window.navigator.clipboard = { writeText: async () => {} };
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      window.HMJJobApplicationContext = {
        buildApplicationUrl() {
          return '/contact.html?role=Senior%20Planning%20Engineer';
        },
      };
    },
  });

  await settle(dom.window);

  const { document } = dom.window;
  assert.equal(dom.window.document.title, 'Senior Planning Engineer | HMJ Global');
  assert.match(document.getElementById('metaDescriptionTag').getAttribute('content'), /Senior Planning Engineer/);
  assert.match(document.getElementById('metaDescriptionTag').getAttribute('content'), /Polished HMJ share-spec overview/);
  assert.equal(document.getElementById('canonicalTag').getAttribute('href'), 'https://www.hmj-global.com/jobs/spec.html?id=spec-role-1&slug=senior-planning-engineer-london-uk');
  assert.equal(document.getElementById('ogTitleTag').getAttribute('content'), 'Senior Planning Engineer | HMJ Global');
  assert.equal(document.getElementById('twitterTitleTag').getAttribute('content'), 'Senior Planning Engineer | HMJ Global');
  assert.equal(document.getElementById('loading').style.display, 'none');
  assert.equal(document.getElementById('error').style.display, 'none');
  assert.equal(document.getElementById('specPage').style.display, 'grid');
  assert.equal(document.getElementById('title').textContent, 'Senior Planning Engineer');
  assert.equal(document.getElementById('overview').textContent, 'Polished HMJ share-spec overview for candidates and print output.');
  assert.equal(document.getElementById('printCopyMode').textContent, 'Candidate role brief');
  assert.equal(document.getElementById('printTitle').textContent, 'Senior Planning Engineer');
  assert.match(document.getElementById('printIntro').textContent, /Polished HMJ share-spec overview/);
  assert.equal(document.getElementById('printLocation').textContent, 'London, UK');
  assert.equal(document.getElementById('printEmployment').textContent, 'Contract');
  assert.equal(document.getElementById('printPay').textContent, 'Competitive day rate');
  assert.equal(document.getElementById('printDiscipline').textContent, 'Project Controls');
  assert.equal(document.getElementById('printSector').textContent, 'Project Controls');
  assert.equal(document.getElementById('printSkills').textContent, 'Primavera P6 • Infrastructure');
  assert.equal(document.getElementById('printApplyRoute').textContent, 'HMJ Global jobs team');
  assert.equal(document.getElementById('printFooterReference').textContent, 'spec-role-1');
  assert.doesNotMatch(document.body.textContent, /payload=/);
  assert.match(document.getElementById('meta').textContent, /Prepared as a candidate-facing HMJ brief/);

  const breadcrumbSchema = JSON.parse(document.getElementById('breadcrumbSchemaTag').textContent);
  const jobPostingSchema = JSON.parse(document.getElementById('jobPostingSchemaTag').textContent);
  assert.equal(breadcrumbSchema['@type'], 'BreadcrumbList');
  assert.equal(jobPostingSchema['@type'], 'JobPosting');
  assert.equal(jobPostingSchema.title, 'Senior Planning Engineer');
  assert.equal(jobPostingSchema.jobLocation.address.addressLocality, 'London, UK');
  assert.equal(jobPostingSchema.employmentType, 'CONTRACTOR');

  const emailShareHref = document.querySelector('[data-email-share]').href;
  const emailBody = new URLSearchParams(emailShareHref.split('?')[1]).get('body') || '';
  assert.match(emailBody, /https:\/\/www\.hmj-global\.com\/go\/spec-role-1/);
  assert.match(emailBody, /https:\/\/www\.hmj-global\.com\/contact\.html/);
  assert.doesNotMatch(emailBody, /payload=/);

  const responsibilityItems = Array.from(document.querySelectorAll('#respList li')).map((node) => node.textContent.trim());
  const requirementItems = Array.from(document.querySelectorAll('#reqList li')).map((node) => node.textContent.trim());

  assert.deepEqual(responsibilityItems, [
    'Own the integrated programme schedule',
    'Lead progress and recovery planning reviews',
  ]);
  assert.deepEqual(requirementItems, [
    'Advanced Primavera P6 capability',
    'Strong stakeholder communication',
  ]);
});

test('job spec page falls back to stored SEO content when share copy is unavailable', async () => {
  const payload = {
    job: {
      id: 'seo-role-9',
      title: 'Supervisor - DC',
      status: 'live',
      section: 'Data Centre Delivery',
      sectionLabel: 'Data Centre Delivery',
      discipline: 'Electrical',
      type: 'permanent',
      locationText: 'Frankfurt, Germany',
      overview: 'Thin source overview.',
      responsibilities: ['Base responsibility'],
      requirements: ['Base requirement'],
      tags: ['HV', 'LV', 'Data Centre'],
      benefits: ['Travel support'],
      payText: '€90,000 - €105,000 per year',
      published: true,
      publicPageConfig: {
        showOverview: true,
        showPay: true,
        showCustomer: false,
        showBenefits: true,
        showResponsibilities: true,
        showRequirements: true,
        showTags: true,
        showRoleHighlights: true,
        showApplyPanel: true,
        showSecondaryCta: false,
        showPageMeta: true,
        showReference: false,
      },
    },
    meta: {
      slug: 'seo-role-9',
      jobId: 'seo-role-9',
      created_at: '2026-03-15T12:00:00.000Z',
      refreshed_at: '2026-03-15T12:30:00.000Z',
    },
    seo: {
      optimized_title: 'Electrical Supervisor - Data Centre - Frankfurt',
      sector_focus: 'Data Centre',
      optimized_overview: 'HMJ Global is recruiting an Electrical Supervisor to support data centre delivery in Frankfurt, Germany on a permanent basis.',
      optimized_responsibilities: [
        'Lead electrical package delivery across live work fronts.',
        'Coordinate site teams, subcontractors, and reporting cadence.',
      ],
      optimized_requirements: [
        'Strong electrical supervision experience on major projects.',
        'Comfortable operating in data centre or mission critical delivery.',
      ],
      meta_title: 'Electrical Supervisor - Frankfurt | HMJ Global',
      meta_description: 'Electrical Supervisor role in Frankfurt supporting data centre delivery with HMJ Global.',
      slug_hint: 'electrical-supervisor-data-centre-frankfurt',
      source: 'openai',
    },
  };
  const encodedPayload = encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString('base64'));
  const html = buildSpecHtml();

  const dom = new JSDOM(html, {
    url: `https://example.com/jobs/spec.html?payload=${encodedPayload}`,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = () => ({
        matches: false,
        media: '',
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.scrollTo = () => {};
      window.print = () => {};
      window.fetch = async () => {
        throw new Error('Unexpected fetch');
      };
      window.HMJAnalytics = { track() {} };
      window.navigator.clipboard = { writeText: async () => {} };
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      window.HMJJobApplicationContext = {
        buildApplicationUrl() {
          return '/contact.html?role=Electrical%20Supervisor';
        },
      };
    },
  });

  await settle(dom.window);

  const { document } = dom.window;
  assert.equal(document.getElementById('title').textContent, 'Electrical Supervisor - Data Centre - Frankfurt');
  assert.equal(document.getElementById('overview').textContent, 'HMJ Global is recruiting an Electrical Supervisor to support data centre delivery in Frankfurt, Germany on a permanent basis.');
  assert.deepEqual(
    Array.from(document.querySelectorAll('#respList li')).map((node) => node.textContent.trim()),
    [
      'Lead electrical package delivery across live work fronts.',
      'Coordinate site teams, subcontractors, and reporting cadence.',
    ]
  );
  assert.deepEqual(
    Array.from(document.querySelectorAll('#reqList li')).map((node) => node.textContent.trim()),
    [
      'Strong electrical supervision experience on major projects.',
      'Comfortable operating in data centre or mission critical delivery.',
    ]
  );
  assert.equal(document.getElementById('printSector').textContent, 'Data Centre');
  assert.match(document.getElementById('meta').textContent, /Prepared as a candidate-facing HMJ brief/);
  assert.doesNotMatch(document.body.textContent, /payload=/);
});
