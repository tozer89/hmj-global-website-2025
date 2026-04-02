const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(process.cwd(), 'js', 'hmj-testimonials.js'), 'utf8');

function createDom(settings) {
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <section data-testimonials-section>
          <div data-testimonials-grid data-testimonials-theme="light" data-testimonials-limit="2"></div>
        </section>
      </body>
    </html>
  `, {
    runScripts: 'outside-only',
    url: 'https://www.hmj-global.com/'
  });

  dom.window.fetch = async () => ({
    ok: true,
    json: async () => ({ settings: { linkedinTestimonials: settings } })
  });
  dom.window.console.warn = () => {};
  dom.window.eval(SCRIPT);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test('testimonial renderer outputs clickable LinkedIn profile cards', async () => {
  const dom = createDom({
    enabled: true,
    items: [
      {
        id: 'one',
        text: 'Outstanding delivery partner.',
        name: 'Jane Smith',
        title: 'Programme Director',
        company: 'Example Build',
        linkedinUrl: 'https://www.linkedin.com/in/jane-smith/',
        imageUrl: '',
        imageAltText: '',
        source: 'LinkedIn Recommendation'
      },
      {
        id: 'two',
        text: 'Strong communication and reliable follow-through.',
        name: 'Mark Lewis',
        title: 'Construction Lead',
        company: 'Critical Ops',
        linkedinUrl: 'https://www.linkedin.com/in/mark-lewis/',
        imageUrl: '',
        imageAltText: '',
        source: 'LinkedIn Recommendation'
      }
    ]
  });

  await settle();

  const document = dom.window.document;
  const cards = document.querySelectorAll('.testimonial-card');
  const section = document.querySelector('[data-testimonials-section]');
  const nameLink = document.querySelector('.testimonial-name[href]');
  const profileLink = document.querySelector('.testimonial-profile-link[href]');

  assert.equal(section.hidden, false);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].classList.contains('light'), true);
  assert.equal(nameLink?.getAttribute('target'), '_blank');
  assert.equal(nameLink?.getAttribute('rel'), 'noopener noreferrer');
  assert.match(profileLink?.getAttribute('href') || '', /linkedin\.com\/in\/jane-smith/i);
});

test('testimonial renderer hides public sections when disabled', async () => {
  const dom = createDom({
    enabled: false,
    items: [
      {
        id: 'one',
        text: 'Hidden card.',
        name: 'Jane Smith',
        title: 'Programme Director',
        company: 'Example Build',
        linkedinUrl: '',
        imageUrl: '',
        imageAltText: '',
        source: 'LinkedIn Recommendation'
      }
    ]
  });

  await settle();

  const section = dom.window.document.querySelector('[data-testimonials-section]');
  assert.equal(section.hidden, true);
});

test('testimonial renderer filters placeholder entries from public output', async () => {
  const dom = createDom({
    enabled: true,
    items: [
      {
        id: 'placeholder',
        text: '[Recommendation pending — Nick to copy full text from LinkedIn]',
        name: 'LinkedIn recommender 01',
        title: 'Job title pending',
        company: 'Company pending',
        linkedinUrl: '',
        imageUrl: '',
        imageAltText: '',
        source: 'LinkedIn Recommendation'
      },
      {
        id: 'real',
        text: 'HMJ kept communication clear and delivery practical throughout the programme.',
        name: 'Jane Smith',
        title: 'Programme Director',
        company: 'Example Build',
        linkedinUrl: 'https://www.linkedin.com/in/jane-smith/',
        imageUrl: '',
        imageAltText: '',
        source: 'LinkedIn Recommendation'
      }
    ]
  });

  await settle();

  const document = dom.window.document;
  const section = document.querySelector('[data-testimonials-section]');
  const cards = document.querySelectorAll('.testimonial-card');

  assert.equal(section.hidden, false);
  assert.equal(cards.length, 1);
  assert.doesNotMatch(document.body.textContent, /recommendation pending|job title pending|company pending|linkedin recommender/i);
});

test('testimonial renderer keeps real cards visible when only optional metadata is still placeholder text', async () => {
  const dom = createDom({
    enabled: true,
    items: [
      {
        id: 'real-but-partial',
        text: 'HMJ kept communication clear and delivery practical throughout the programme.',
        name: 'Lewis Fowler',
        title: 'Electrical Senior Authorised Person',
        company: 'Company pending',
        linkedinUrl: 'https://www.linkedin.com/in/lewis-fowler/',
        imageUrl: '',
        imageAltText: '',
        source: 'LinkedIn Recommendation'
      }
    ]
  });

  await settle();

  const document = dom.window.document;
  const section = document.querySelector('[data-testimonials-section]');
  const cards = document.querySelectorAll('.testimonial-card');

  assert.equal(section.hidden, false);
  assert.equal(cards.length, 1);
  assert.doesNotMatch(document.body.textContent, /company pending/i);
  assert.match(document.body.textContent, /Electrical Senior Authorised Person/i);
});
