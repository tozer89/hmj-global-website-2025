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

async function settle(window, passes = 6) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function makeJob(id, title, overrides = {}) {
  return {
    id,
    title,
    status: 'live',
    section: 'Data Centre Delivery',
    sectionLabel: 'Data Centre Delivery',
    discipline: 'Electrical',
    type: 'contract',
    customer: 'Hyperscale Programme',
    clientName: 'Internal Client',
    payType: 'day_rate',
    currency: 'EUR',
    dayRateMin: 450,
    dayRateMax: 550,
    locationText: 'Frankfurt, Germany',
    locationCode: 'frankfurt',
    overview: 'Lead delivery on a live programme.',
    responsibilities: ['Coordinate supervisors'],
    requirements: ['Live site background'],
    tags: ['Data Centre', 'Electrical'],
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
    createdAt: '2026-03-16T09:00:00Z',
    updatedAt: '2026-03-16T10:00:00Z',
    ...overrides,
  };
}

async function createJobsDom(width = 390) {
  const html = buildJobsHarnessHtml();
  const saveCalls = [];
  const jobs = [
    makeJob('planner-role', 'Senior Planner'),
    makeJob('freelance-role', 'Freelance Manager', {
      section: 'Commercial',
      sectionLabel: 'Commercial',
      discipline: 'Commercial',
      type: 'freelance',
      customer: 'Mission Critical Delivery',
      currency: 'GBP',
      locationText: 'Dublin, Ireland',
      locationCode: 'dublin',
      tags: ['Commercial', 'Data Centre'],
      benefits: ['Accommodation support'],
    }),
  ];

  const dom = new JSDOM(html, {
    url: 'https://example.com/admin/jobs.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = createMatchMedia(width);
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
              return {
                jobs,
                supabase: { ok: true },
                readOnly: false,
              };
            }
            if (endpoint === 'admin-jobs-save') {
              saveCalls.push(payload.job);
              return {
                job: {
                  ...payload.job,
                  id: payload.job.id || 'new-role',
                  updatedAt: '2026-03-16T12:00:00Z',
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
  return { dom, saveCalls };
}

test('jobs editor surfaces live suggestions and saves new custom values cleanly', async () => {
  const { dom, saveCalls } = await createJobsDom();
  const { document, Event, KeyboardEvent } = dom.window;

  document.querySelector('#btnNew').click();
  await settle(dom.window);

  const sectionToggle = document.querySelector('[data-smart-toggle="section"]');
  sectionToggle.click();
  await settle(dom.window);
  assert.match(document.querySelector('#smartMenuSection').textContent, /Data Centre Delivery/i);
  assert.match(document.querySelector('#smartMenuSection').textContent, /Commercial/i);

  const disciplineInput = document.querySelector('#edDiscipline');
  disciplineInput.value = 'Commissioning';
  disciplineInput.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-smart-toggle="discipline"]').click();
  await settle(dom.window);
  const createDiscipline = document.querySelector('#smartMenuDiscipline .smart-field__option--create');
  assert.match(createDiscipline.textContent, /Commissioning/i);
  createDiscipline.click();

  document.querySelector('#edTitle').value = 'Commissioning Lead';
  document.querySelector('#edSection').value = 'Commercial';
  document.querySelector('#edCustomer').value = 'Mission Critical Delivery';
  document.querySelector('#edLocationText').value = 'Amsterdam, Netherlands';
  document.querySelector('#edLocationCode').value = 'amsterdam';
  document.querySelector('#edPayType').value = 'day_rate';
  document.querySelector('#edPayType').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#edCurrency').value = 'eur';
  document.querySelector('#btnTypeEnterNew').click();
  await settle(dom.window);
  document.querySelector('#edTypeCustom').value = 'freelance';

  const tagInput = document.querySelector('#tagInput');
  tagInput.value = 'data centre';
  tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  tagInput.value = 'Data Centre';
  tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  const benefitInput = document.querySelector('#benefitInput');
  benefitInput.value = 'Housing support';
  benefitInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  document.querySelector('#btnSave').click();
  await settle(dom.window, 10);

  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].type, 'freelance');
  assert.equal(saveCalls[0].currency, 'EUR');
  assert.deepEqual(Array.from(saveCalls[0].tags || []), ['Data Centre']);
  assert.deepEqual(Array.from(saveCalls[0].benefits || []), ['Housing support']);
  assert.equal(saveCalls[0].section, 'Commercial');
  assert.equal(saveCalls[0].discipline, 'Commissioning');
});

test('jobs editor hydrates custom employment types without breaking standard mode', async () => {
  const { dom } = await createJobsDom();
  const { document } = dom.window;

  document.querySelector('[data-id="freelance-role"] footer button').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#edTypeCustomWrap').classList.contains('is-hidden'), false);
  assert.equal(document.querySelector('#edTypeCustom').value, 'freelance');
  assert.ok(Array.from(document.querySelectorAll('#typeOptions option')).some((option) => option.value === 'contract'));
  assert.ok(Array.from(document.querySelectorAll('#tagSuggestions option')).some((option) => option.value === 'Data Centre'));
  assert.ok(Array.from(document.querySelectorAll('#benefitSuggestions option')).some((option) => ['Travel support', 'Accommodation support'].includes(option.value)));

  document.querySelector('#btnTypeUseStandard').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#edTypeCustomWrap').classList.contains('is-hidden'), true);
  assert.equal(document.querySelector('#edType').value, 'permanent');
});
