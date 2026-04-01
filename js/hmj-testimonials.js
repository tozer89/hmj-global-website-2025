(function () {
  'use strict';

  const PLACEHOLDER_TEXT = '[Recommendation pending — Nick to copy full text from LinkedIn]';
  const testimonials = Array.from({ length: 6 }, (_, index) => ({
    text: PLACEHOLDER_TEXT,
    name: `LinkedIn recommender ${String(index + 1).padStart(2, '0')}`,
    title: 'Job title pending',
    company: 'Company pending',
    source: 'LinkedIn Recommendation',
  }));

  function asPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function buildRoleLine(entry) {
    return [entry.title, entry.company].filter(Boolean).join(', ');
  }

  function buildCard(entry, options) {
    const theme = options && options.theme === 'light' ? 'light' : 'dark';
    const card = document.createElement('article');
    card.className = `card testimonial-card${theme === 'light' ? ' light' : ''}`;
    card.setAttribute('role', 'listitem');

    const mark = document.createElement('span');
    mark.className = 'testimonial-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '“';

    const text = document.createElement('p');
    text.className = 'testimonial-text';
    text.textContent = entry.text;

    const meta = document.createElement('div');
    meta.className = 'testimonial-meta';

    const name = document.createElement('strong');
    name.className = 'testimonial-name';
    name.textContent = entry.name;

    const title = document.createElement('span');
    title.className = 'testimonial-title';
    title.textContent = buildRoleLine(entry);

    const badge = document.createElement('span');
    badge.className = 'linkedin-badge';
    badge.textContent = entry.source === 'LinkedIn Recommendation'
      ? 'via LinkedIn'
      : `via ${entry.source || 'LinkedIn'}`;

    meta.append(name, title, badge);
    card.append(mark, text, meta);
    return card;
  }

  function renderGrid(grid) {
    if (!grid) return;
    const limit = asPositiveInt(grid.getAttribute('data-testimonials-limit'), testimonials.length);
    const theme = grid.getAttribute('data-testimonials-theme') === 'light' ? 'light' : 'dark';
    const items = testimonials.slice(0, limit);
    grid.setAttribute('role', 'list');
    grid.replaceChildren(...items.map((entry) => buildCard(entry, { theme })));
  }

  function renderTrack(track) {
    if (!track) return;
    const limit = asPositiveInt(track.getAttribute('data-testimonials-limit'), testimonials.length);
    const theme = track.getAttribute('data-testimonials-theme') === 'light' ? 'light' : 'dark';
    const items = testimonials.slice(0, limit);
    const primary = items.map((entry) => buildCard(entry, { theme }));
    const clones = items.map((entry) => {
      const card = buildCard(entry, { theme });
      card.setAttribute('aria-hidden', 'true');
      return card;
    });
    track.setAttribute('role', 'list');
    track.replaceChildren(...primary, ...clones);
  }

  function init() {
    document.querySelectorAll('[data-testimonials-grid]').forEach(renderGrid);
    document.querySelectorAll('[data-testimonials-track]').forEach(renderTrack);
  }

  window.HMJTestimonials = { testimonials };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
