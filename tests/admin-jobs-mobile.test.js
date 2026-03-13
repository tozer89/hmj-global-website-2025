const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MOBILE_WIDTHS = [320, 375, 390, 393, 414, 430, 768];

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

async function settle(window, passes = 4) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

async function createJobsDom(width) {
  const html = buildJobsHarnessHtml();
  const saveCalls = [];
  const sampleJob = {
    id: 'planner-role',
    title: 'Senior Planner',
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
  };

  const dom = new JSDOM(html, {
    url: 'https://example.com/admin/jobs.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = createMatchMedia(width);
      window.scrollTo = () => {};
      window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
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
                jobs: [sampleJob],
                supabase: { ok: true },
                readOnly: false,
              };
            }

            if (endpoint === 'admin-jobs-save') {
              saveCalls.push(payload.job);
              return {
                job: {
                  ...sampleJob,
                  ...payload.job,
                  id: payload.job.id || sampleJob.id,
                  updatedAt: '2026-03-13T12:00:00Z',
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

test('mobile jobs editor groups long form fields into collapsible sections across target widths', async (t) => {
  for (const width of MOBILE_WIDTHS) {
    await t.test(`width ${width}`, async () => {
      const { dom, saveCalls } = await createJobsDom(width);
      const { document, Event } = dom.window;

      document.querySelector('#btnNew').click();
      await settle(dom.window);

      const basics = document.querySelector('[data-editor-section="basics"]');
      const content = document.querySelector('[data-editor-section="content"]');
      const placement = document.querySelector('[data-editor-section="placement"]');

      assert.equal(document.querySelector('#drawer').classList.contains('open'), true, 'editor drawer should open');
      assert.equal(basics.open, true, 'basic info should stay open by default on mobile');
      assert.equal(placement.open, false, 'secondary sections should start collapsed on mobile');

      document.querySelector('[data-editor-jump="content"]').click();
      await settle(dom.window);

      assert.equal(content.open, true, 'jump nav should open the requested section');
      assert.equal(basics.open, false, 'opening a later section should collapse the previous one');
      assert.equal(document.querySelector('[data-editor-jump="content"]').classList.contains('active'), true);

      document.querySelector('#edTitle').value = `Mobile Planner ${width}`;
      document.querySelector('#edTitle').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#edStatus').value = 'closed';
      document.querySelector('#edStatus').dispatchEvent(new Event('change', { bubbles: true }));

      assert.match(document.querySelector('#editorSummaryBasics').textContent, /Closed/i);

      document.querySelector('#btnSave').click();
      await settle(dom.window);

      assert.equal(saveCalls.at(-1).title, `Mobile Planner ${width}`);
      assert.equal(saveCalls.at(-1).status, 'closed');
    });
  }
});
