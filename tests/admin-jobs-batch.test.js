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
  const file = path.join(process.cwd(), 'admin/jobs.html');
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
    section: 'Critical Infrastructure',
    sectionLabel: 'Critical Infrastructure',
    discipline: 'Planning',
    type: 'contract',
    customer: 'Client A',
    clientName: 'Internal Client',
    payType: 'day_rate',
    currency: 'GBP',
    dayRateMin: 450,
    dayRateMax: 550,
    locationText: 'Frankfurt, Germany',
    locationCode: 'frankfurt',
    overview: 'Lead site planning across a live programme.',
    responsibilities: ['Own the delivery schedule'],
    requirements: ['Live site background'],
    tags: ['HV'],
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

async function createJobsDom(width = 390) {
  const html = buildJobsHarnessHtml();
  const saveCalls = [];
  const bulkCalls = [];
  let currentJobs = [
    makeJob('planner-role', 'Senior Planner'),
    makeJob('qa-role', 'QA Lead', { status: 'interviewing', section: 'Data Centre Delivery', sectionLabel: 'Data Centre Delivery', locationText: 'London, UK', locationCode: 'london' }),
    makeJob('ops-role', 'Operations Lead', { status: 'closed', published: false, section: 'Commercial', sectionLabel: 'Commercial', type: 'permanent' }),
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
          api: async (endpoint, method, payload) => {
            if (endpoint === 'admin-jobs-list') {
              return {
                jobs: currentJobs,
                supabase: { ok: true },
                readOnly: false,
              };
            }

            if (endpoint === 'admin-jobs-save') {
              saveCalls.push(payload.job);
              currentJobs = currentJobs.map((job) => (
                job.id === payload.job.id
                  ? { ...job, ...payload.job, updatedAt: '2026-03-13T12:00:00Z' }
                  : job
              ));
              return {
                job: currentJobs.find((job) => job.id === payload.job.id),
              };
            }

            if (endpoint === 'admin-jobs-bulk') {
              bulkCalls.push(payload);
              currentJobs = currentJobs.map((job) => {
                if (!payload.ids.includes(job.id)) return job;
                const next = { ...job };
                if (payload.edits.status) next.status = payload.edits.status;
                if (Object.prototype.hasOwnProperty.call(payload.edits, 'published')) next.published = payload.edits.published;
                if (payload.edits.overview?.mode === 'append') {
                  next.overview = `${next.overview}\n\n${payload.edits.overview.value}`.trim();
                }
                return { ...next, updatedAt: '2026-03-13T12:30:00Z' };
              });
              return {
                jobs: currentJobs.filter((job) => payload.ids.includes(job.id)),
                updatedCount: payload.ids.length,
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
  return { dom, saveCalls, bulkCalls };
}

test('selection controls follow visible jobs and reconcile after filter changes', async () => {
  const { dom } = await createJobsDom();
  const { document, Event } = dom.window;

  const checkboxes = document.querySelectorAll('[data-role="select-card"]');
  assert.equal(checkboxes.length, 3);

  checkboxes[0].checked = true;
  checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  assert.equal(document.querySelector('#selectedCount').textContent.trim(), '1 selected');
  assert.equal(document.querySelector('#btnBatchAction').disabled, false);

  document.querySelector('#filterStatus').value = 'live';
  document.querySelector('#filterStatus').dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  document.querySelector('#selectVisible').click();
  await settle(dom.window);
  assert.equal(document.querySelector('#selectedCount').textContent.trim(), '1 selected');

  document.querySelector('#filterStatus').value = 'closed';
  document.querySelector('#filterStatus').dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  assert.equal(document.querySelector('#selectedCount').textContent.trim(), '0 selected');
  assert.equal(document.querySelector('#btnBatchAction').disabled, true);
});

test('batch modal confirms and submits structured bulk edits', async () => {
  const { dom, bulkCalls } = await createJobsDom();
  const { document, Event } = dom.window;

  const plannerCheckbox = document.querySelector('[data-id="planner-role"] [data-role="select-card"]');
  const qaCheckbox = document.querySelector('[data-id="qa-role"] [data-role="select-card"]');
  plannerCheckbox.checked = true;
  plannerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  qaCheckbox.checked = true;
  qaCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  document.querySelector('#btnBatchAction').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#batchModalShell').hidden, false);
  assert.match(document.querySelector('#batchSelectedSummary').textContent, /2 selected jobs/i);

  document.querySelector('#batchStatusMode').value = 'replace';
  document.querySelector('#batchStatusMode').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchStatusValue').value = 'closed';
  document.querySelector('#batchStatusValue').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchOverviewMode').value = 'append';
  document.querySelector('#batchOverviewMode').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchOverviewValue').value = 'Urgent delivery note';
  document.querySelector('#batchOverviewValue').dispatchEvent(new Event('input', { bubbles: true }));
  await settle(dom.window);

  document.querySelector('#btnBatchReview').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#batchConfirmShell').hidden, false);
  assert.match(document.querySelector('#batchConfirmMessage').textContent, /status, overview/i);
  assert.match(document.querySelector('#batchConfirmDetails').textContent, /2 jobs affected/i);
  assert.match(document.querySelector('#batchConfirmDetails').textContent, /replace status with closed/i);
  assert.match(document.querySelector('#batchConfirmDetails').textContent, /append to overview/i);

  document.querySelector('#btnBatchConfirmSave').click();
  await settle(dom.window, 10);

  assert.equal(bulkCalls.length, 1);
  assert.deepEqual(Array.from(bulkCalls[0].ids).sort(), ['planner-role', 'qa-role']);
  assert.equal(bulkCalls[0].edits.status, 'closed');
  assert.equal(bulkCalls[0].edits.overview.mode, 'append');
  assert.equal(bulkCalls[0].edits.overview.value, 'Urgent delivery note');
  assert.equal(document.querySelector('#selectedCount').textContent.trim(), '0 selected');
  assert.equal(document.querySelector('#batchModalShell').hidden, true);
});

test('inline edits and admin view preferences persist locally', async () => {
  const { dom, saveCalls } = await createJobsDom();
  const { document, Event } = dom.window;

  document.querySelector('#densityToggle').click();
  document.querySelector('#toggleCategoryTools').click();
  document.querySelector('#filterType').value = 'contract';
  document.querySelector('#filterType').dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  const prefs = JSON.parse(dom.window.localStorage.getItem('hmj.jobs.admin.preferences:v1'));
  assert.equal(prefs.denseCards, true);
  assert.equal(prefs.categoryToolsExpanded, true);
  assert.equal(prefs.filters.type, 'contract');

  const statusSelect = document.querySelector('[data-inline="status"]');
  statusSelect.value = 'closed';
  statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window, 8);

  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].status, 'closed');
});
