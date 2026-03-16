const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function createMatchMedia(width) {
  return (query) => {
    const max = /max-width:\s*(\d+)px/i.exec(query);
    const min = /min-width:\s*(\d+)px/i.exec(query);
    let matches = true;
    if (max) matches = matches && width <= Number(max[1]);
    if (min) matches = matches && width >= Number(min[1]);
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  };
}

function buildJobsHarnessHtml() {
  const file = path.join(process.cwd(), 'admin', 'jobs.html');
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/g, '');
}

async function settle(window, passes = 8) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function makeJob(overrides = {}) {
  return {
    id: 'electrical-supervisor-frankfurt',
    title: 'Electrical Supervisor',
    status: 'live',
    section: 'Critical Infrastructure',
    sectionLabel: 'Critical Infrastructure',
    discipline: 'Electrical',
    type: 'contract',
    customer: 'Hyperscale programme',
    clientName: 'Delivery',
    payType: 'day_rate',
    currency: 'EUR',
    dayRateMin: 450,
    dayRateMax: 550,
    locationText: 'Frankfurt, Germany',
    locationCode: 'frankfurt',
    overview: 'Lead electrical package delivery on a live programme.',
    responsibilities: ['Coordinate supervisors'],
    requirements: ['Electrical background'],
    tags: ['Data Centre'],
    benefits: ['Travel support'],
    published: true,
    sortOrder: 10,
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
      showPageMeta: false,
      showReference: false,
    },
    createdAt: '2026-03-13T09:00:00Z',
    updatedAt: '2026-03-13T11:00:00Z',
    ...overrides,
  };
}

async function createJobsDom() {
  const html = buildJobsHarnessHtml();
  const saveCalls = [];
  const optimizeCalls = [];
  const job = makeJob();

  const dom = new JSDOM(html, {
    url: 'https://example.com/admin/jobs.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = createMatchMedia(390);
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.console = console;
      window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      window.navigator.clipboard = { writeText: async () => {} };
      window.Admin = {
        bootAdmin: async (mainFn) => mainFn({
          api: async (endpoint, _method, payload) => {
            if (endpoint === 'admin-jobs-list') {
              return { jobs: [job], supabase: { ok: true }, readOnly: false };
            }
            if (endpoint === 'admin-jobs-seo-get') {
              return {
                stored: true,
                source: 'stored',
                suggestion: {
                  optimized_title: 'Electrical Supervisor - Data Centre - Frankfurt',
                  meta_title: 'Electrical Supervisor - Frankfurt | HMJ Global',
                  meta_description: 'Electrical Supervisor role in Frankfurt, Germany for a live data centre programme.',
                  slug_hint: 'electrical-supervisor-data-centre-frankfurt',
                  sector_focus: 'Data Centre',
                  optimized_overview: 'HMJ Global is recruiting an Electrical Supervisor for a live data centre project in Frankfurt, Germany.',
                  optimized_responsibilities: ['Lead electrical package coordination'],
                  optimized_requirements: ['Electrical supervision experience on mission critical projects'],
                  schema_missing_fields: ['salary'],
                  source: 'openai',
                  model: 'gpt-5-mini',
                },
              };
            }
            if (endpoint === 'admin-jobs-save') {
              saveCalls.push(payload.job);
              return {
                job: {
                  ...job,
                  ...payload.job,
                  updatedAt: '2026-03-13T12:00:00Z',
                },
              };
            }
            if (endpoint === 'admin-jobs-seo-optimize') {
              optimizeCalls.push(payload);
              return {
                stored: true,
                source: 'openai',
                suggestion: {
                  optimized_title: 'Electrical Supervisor - Data Centre - Frankfurt',
                  meta_title: 'Electrical Supervisor - Frankfurt | HMJ Global',
                  meta_description: 'Electrical Supervisor role in Frankfurt, Germany for a live data centre programme.',
                  slug_hint: 'electrical-supervisor-data-centre-frankfurt',
                  sector_focus: 'Data Centre',
                  optimized_overview: 'HMJ Global is recruiting an Electrical Supervisor for a live data centre project in Frankfurt, Germany.',
                  optimized_responsibilities: ['Lead electrical package coordination'],
                  optimized_requirements: ['Electrical supervision experience on mission critical projects'],
                  schema_missing_fields: ['salary'],
                  source: 'openai',
                  model: 'gpt-5-mini',
                },
              };
            }
            return {};
          },
          sel: (selector, root = window.document) => root.querySelector(selector),
          toast: () => {},
          identity: async () => ({ ok: true, email: 'admin@hmj-global.com' }),
        }),
      };
    },
  });

  await settle(dom.window);
  return { dom, saveCalls, optimizeCalls };
}

test('jobs editor loads, applies, and refreshes the SEO assistant draft', async () => {
  const { dom, saveCalls, optimizeCalls } = await createJobsDom();
  const { document, Event } = dom.window;

  document.querySelector('.card footer button').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#seoOptimizedTitle').value, 'Electrical Supervisor - Data Centre - Frankfurt');
  assert.match(document.querySelector('#seoStatusBadge').textContent, /GPT-assisted/i);
  assert.match(document.querySelector('#seoStorageBadge').textContent, /Stored draft/i);

  document.querySelector('#btnSeoApply').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#edTitle').value, 'Electrical Supervisor - Data Centre - Frankfurt');
  assert.match(document.querySelector('#edOverview').value, /HMJ Global is recruiting an Electrical Supervisor/);

  document.querySelector('#edTitle').dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#btnSave').click();
  await settle(dom.window, 12);

  assert.equal(saveCalls.length, 1);
  assert.equal(optimizeCalls.length >= 1, true);
  assert.equal(optimizeCalls.at(-1).job.id, 'electrical-supervisor-frankfurt');
});
