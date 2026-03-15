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
  assert.equal(document.getElementById('loading').style.display, 'none');
  assert.equal(document.getElementById('error').style.display, 'none');
  assert.equal(document.getElementById('specPage').style.display, 'grid');
  assert.equal(document.getElementById('title').textContent, 'Senior Planning Engineer');
  assert.equal(document.getElementById('overview').textContent, 'Polished HMJ share-spec overview for candidates and print output.');
  assert.equal(document.getElementById('printCopyMode').textContent, 'AI-polished share copy');
  assert.match(document.getElementById('meta').textContent, /AI-polished share copy active/);
  assert.match(document.getElementById('printApplyLink').href, /\/contact\.html\?role=Senior%20Planning%20Engineer$/);

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
