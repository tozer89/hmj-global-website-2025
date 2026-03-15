const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function buildPublicJobsHtml() {
  const file = path.join(process.cwd(), 'jobs.html');
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/g, '');
}

async function settle(window, passes = 8) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

test('public jobs page renders published Supabase jobs with pay, tags, and location safely', async () => {
  const html = buildPublicJobsHtml();
  const dom = new JSDOM(html, {
    url: 'https://example.com/jobs.html',
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
      window.IntersectionObserver = class IntersectionObserver {
        observe(target) {
          target.classList.add('revealed');
        }
        unobserve() {}
        disconnect() {}
      };
      window.scrollTo = () => {};
      window.fetch = async (url) => {
        if (String(url).includes('/.netlify/functions/jobs-list')) {
          return {
            ok: true,
            json: async () => ({
              jobs: [
                {
                  id: 'published-role',
                  title: 'Senior Planner',
                  status: 'live',
                  published: true,
                  section: 'Critical Infrastructure',
                  sectionLabel: 'Critical Infrastructure',
                  discipline: 'Planning',
                  type: 'permanent',
                  locationText: 'Frankfurt, Germany',
                  locationCode: 'frankfurt',
                  customer: 'Hyperscale client',
                  overview: 'Lead a major programme.',
                  tags: ['HV', 'P6'],
                  benefits: ['Travel support'],
                  pay_type: 'salary_range',
                  salary_min: 65000,
                  salary_max: 80000,
                  currency: 'GBP',
                  apply_url: 'contact.html?role=Senior%20Planner',
                },
                {
                  id: 'draft-role',
                  title: 'Hidden Draft',
                  status: 'live',
                  published: false,
                  section: 'Commercial',
                },
              ],
              source: 'supabase',
            }),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };
      window.HMJAnalytics = { track() {} };
      window.navigator.clipboard = { writeText: async () => {} };
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    },
  });

  await settle(dom.window);

  const { document } = dom.window;
  const cards = document.querySelectorAll('.job');
  assert.equal(cards.length, 1);

  const cardText = cards[0].textContent.replace(/\s+/g, ' ');
  assert.match(cardText, /Senior Planner/);
  assert.match(cardText, /Frankfurt, Germany/);
  assert.match(cardText, /£65,000 - £80,000 per year/);
  assert.match(cardText, /HV/);
  assert.match(cardText, /P6/);
  assert.match(document.querySelector('#dataSourceIndicator').textContent, /live/i);
});
