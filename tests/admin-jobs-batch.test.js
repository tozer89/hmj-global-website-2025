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

function buildJobsHarnessHtml(options = {}) {
  const file = path.join(process.cwd(), 'admin/jobs.html');
  let html = fs
    .readFileSync(file, 'utf8')
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/g, '');

  if (options.staleBatchUi) {
    html = html
      .replace('<body data-auth-view="login">', '<body data-auth-view="login" class="modal-open">')
      .replace('id="batchModalShell" hidden inert aria-hidden="true" data-open="false"', 'id="batchModalShell" data-open="true" aria-hidden="false"')
      .replace('id="batchConfirmShell" hidden inert aria-hidden="true" data-open="false"', 'id="batchConfirmShell" data-open="true" aria-hidden="false"')
      .replace('<div id="toast"></div>', '<div id="toast"><div class="notice">Choose at least one batch change first</div></div>');
  }

  return html;
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

async function createJobsDom(width = 390, options = {}) {
  const html = buildJobsHarnessHtml(options);
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
        bootAdmin: async (mainFn) => {
          if (options.delayBootMs) {
            await new Promise((resolve) => window.setTimeout(resolve, options.delayBootMs));
          }
          return mainFn({
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
          });
        },
      };
    },
  });

  await settle(dom.window, options.settlePasses || 6);
  return { dom, saveCalls, bulkCalls };
}

function assertBatchUiClosed(document) {
  assert.equal(document.body.classList.contains('modal-open'), false);
  assert.equal(document.querySelector('#batchModalShell').hidden, true);
  assert.equal(document.querySelector('#batchConfirmShell').hidden, true);
  assert.equal(document.querySelector('#batchModalShell').dataset.open, 'false');
  assert.equal(document.querySelector('#batchConfirmShell').dataset.open, 'false');
  assert.equal(document.querySelector('#batchModalShell').getAttribute('aria-hidden'), 'true');
  assert.equal(document.querySelector('#batchConfirmShell').getAttribute('aria-hidden'), 'true');
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

test('stale batch overlays and warning toasts are cleared on page boot', async () => {
  const { dom } = await createJobsDom(390, { staleBatchUi: true });
  const { document } = dom.window;

  assertBatchUiClosed(document);
  assert.equal(document.querySelector('#toast').textContent.trim(), '');
  assert.equal(document.querySelector('#selectedCount').textContent.trim(), '0 selected');
});

test('stale batch overlays are cleared before admin boot finishes', async () => {
  const { dom } = await createJobsDom(390, { staleBatchUi: true, delayBootMs: 120, settlePasses: 1 });
  const { document } = dom.window;

  assertBatchUiClosed(document);
});

test('batch confirm cannot open without a valid batch payload', async () => {
  const { dom } = await createJobsDom();
  const { document, Event, KeyboardEvent } = dom.window;

  const plannerCheckbox = document.querySelector('[data-id="planner-role"] [data-role="select-card"]');
  plannerCheckbox.checked = true;
  plannerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  document.querySelector('#btnBatchAction').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#batchModalShell').hidden, false);
  assert.equal(document.querySelector('#batchConfirmShell').hidden, true);
  assert.equal(document.querySelector('#btnBatchReview').disabled, true);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  await settle(dom.window);

  assert.equal(document.querySelector('#batchModalShell').hidden, false);
  assert.equal(document.querySelector('#batchConfirmShell').hidden, true);
  assert.equal(document.querySelector('#batchConfirmShell').dataset.open, 'false');
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
  assert.equal(document.querySelector('#btnBatchReview').disabled, true);

  document.querySelector('#batchStatusMode').value = 'replace';
  document.querySelector('#batchStatusMode').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchStatusValue').value = 'closed';
  document.querySelector('#batchStatusValue').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchOverviewMode').value = 'append';
  document.querySelector('#batchOverviewMode').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchOverviewValue').value = 'Urgent delivery note';
  document.querySelector('#batchOverviewValue').dispatchEvent(new Event('input', { bubbles: true }));
  await settle(dom.window);

  assert.equal(document.querySelector('#btnBatchReview').disabled, false);

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

test('closing batch modal removes the blocking layer and body lock', async () => {
  const { dom } = await createJobsDom();
  const { document, Event } = dom.window;

  const plannerCheckbox = document.querySelector('[data-id="planner-role"] [data-role="select-card"]');
  plannerCheckbox.checked = true;
  plannerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  document.querySelector('#btnBatchAction').click();
  await settle(dom.window);

  assert.equal(document.body.classList.contains('modal-open'), true);
  assert.equal(document.querySelector('#batchModalShell').dataset.open, 'true');

  document.querySelector('#btnBatchCancel').click();
  await settle(dom.window);

  assertBatchUiClosed(document);
});

test('page restore clears batch workflow state before the console becomes usable again', async () => {
  const { dom } = await createJobsDom();
  const { document, Event } = dom.window;

  const plannerCheckbox = document.querySelector('[data-id="planner-role"] [data-role="select-card"]');
  plannerCheckbox.checked = true;
  plannerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);

  document.querySelector('#btnBatchAction').click();
  await settle(dom.window);
  document.querySelector('#batchStatusMode').value = 'replace';
  document.querySelector('#batchStatusMode').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#batchStatusValue').value = 'closed';
  document.querySelector('#batchStatusValue').dispatchEvent(new Event('change', { bubbles: true }));
  await settle(dom.window);
  document.querySelector('#btnBatchReview').click();
  await settle(dom.window);

  assert.equal(document.querySelector('#batchConfirmShell').hidden, false);

  const restoreEvent = new dom.window.Event('pageshow');
  dom.window.dispatchEvent(restoreEvent);
  await settle(dom.window);

  assertBatchUiClosed(document);
  assert.equal(document.querySelector('#selectedCount').textContent.trim(), '0 selected');
});

test('jobs admin markup exposes only one batch modal, one confirm modal, and one backdrop each', async () => {
  const { dom } = await createJobsDom();
  const { document } = dom.window;

  assert.equal(document.querySelectorAll('#batchModalShell').length, 1);
  assert.equal(document.querySelectorAll('#batchConfirmShell').length, 1);
  assert.equal(document.querySelectorAll('#batchModal').length, 1);
  assert.equal(document.querySelectorAll('#batchConfirmDialog').length, 1);
  assert.equal(document.querySelectorAll('[data-batch-close]').length, 1);
  assert.equal(document.querySelectorAll('[data-batch-confirm-close]').length, 1);
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
