(function () {
  'use strict';

  const SETTINGS_ENDPOINT = '/.netlify/functions/public-settings';
  const PLACEHOLDER_PATTERNS = [
    /recommendation pending/i,
    /nick to copy/i,
    /job title pending/i,
    /company pending/i,
    /^linkedin recommender\b/i,
  ];

  function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function asPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function sanitiseUrl(value) {
    const raw = asString(value);
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.origin);
      return /^https?:$/i.test(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function buildInitials(name) {
    const parts = asString(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return 'HM';
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
  }

  function createDefaultSettings() {
    return {
      enabled: true,
      items: [],
    };
  }

  function buildSettingsUrl() {
    const url = new URL(SETTINGS_ENDPOINT, window.location.origin);
    url.searchParams.set('v', String(Date.now()));
    return url.toString();
  }

  function containsPlaceholderText(value) {
    const text = asString(value).toLowerCase();
    return !!text && PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
  }

  function safeOptionalText(value) {
    const text = asString(value);
    return containsPlaceholderText(text) ? '' : text;
  }

  function normaliseEntry(entry, index) {
    const order = index + 1;
    const name = asString(entry?.name);
    return {
      id: asString(entry?.id) || `testimonial-${String(order).padStart(2, '0')}`,
      text: asString(entry?.text),
      name,
      title: safeOptionalText(entry?.title),
      company: safeOptionalText(entry?.company),
      linkedinUrl: sanitiseUrl(entry?.linkedinUrl),
      imageUrl: sanitiseUrl(entry?.imageUrl),
      imageStorageKey: asString(entry?.imageStorageKey),
      imageAltText: asString(entry?.imageAltText) || (name ? `Portrait of ${name}` : 'HMJ recommendation'),
      source: asString(entry?.source) || 'LinkedIn Recommendation',
    };
  }

  function isRenderableEntry(entry) {
    if (!entry || !entry.text || !entry.name) return false;
    return ![entry.text, entry.name].some(containsPlaceholderText);
  }

  function normaliseSettings(raw) {
    const fallback = createDefaultSettings();
    const sourceItems = Array.isArray(raw?.items) ? raw.items : fallback.items;
    return {
      enabled: raw?.enabled !== false,
      items: sourceItems.map(normaliseEntry).filter(isRenderableEntry),
    };
  }

  function buildRoleLine(entry) {
    return [entry.title, entry.company].filter(Boolean).join(', ');
  }

  function createAvatar(entry) {
    const avatar = document.createElement(entry.linkedinUrl ? 'a' : 'span');
    avatar.className = 'testimonial-avatar';
    if (entry.linkedinUrl) {
      avatar.href = entry.linkedinUrl;
      avatar.target = '_blank';
      avatar.rel = 'noopener noreferrer';
      avatar.setAttribute('aria-label', `Open ${entry.name} on LinkedIn`);
    }

    if (entry.imageUrl) {
      const image = document.createElement('img');
      image.src = entry.imageUrl;
      image.alt = entry.imageAltText;
      image.loading = 'lazy';
      image.decoding = 'async';
      avatar.appendChild(image);
    } else {
      avatar.textContent = buildInitials(entry.name);
    }

    return avatar;
  }

  function createName(entry) {
    const name = document.createElement(entry.linkedinUrl ? 'a' : 'strong');
    name.className = 'testimonial-name';
    name.textContent = entry.name;
    if (entry.linkedinUrl) {
      name.href = entry.linkedinUrl;
      name.target = '_blank';
      name.rel = 'noopener noreferrer';
      name.setAttribute('aria-label', `Open ${entry.name} on LinkedIn`);
    }
    return name;
  }

  function createProfileLink(entry) {
    if (!entry.linkedinUrl) return null;
    const link = document.createElement('a');
    link.className = 'testimonial-profile-link';
    link.href = entry.linkedinUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View profile';
    link.setAttribute('aria-label', `View ${entry.name}'s LinkedIn profile`);
    return link;
  }

  function muteFocusable(card) {
    card.querySelectorAll('a, button, input, select, textarea').forEach((node) => {
      node.tabIndex = -1;
      node.setAttribute('aria-hidden', 'true');
    });
  }

  function buildCard(entry, options) {
    const theme = options?.theme === 'light' ? 'light' : 'dark';
    const card = document.createElement('article');
    card.className = `card testimonial-card${theme === 'light' ? ' light' : ''}`;
    card.setAttribute('role', 'listitem');

    const mark = document.createElement('span');
    mark.className = 'testimonial-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '“';

    const header = document.createElement('div');
    header.className = 'testimonial-header';

    const avatar = createAvatar(entry);
    const person = document.createElement('div');
    person.className = 'testimonial-person';
    person.append(createName(entry));

    const title = document.createElement('span');
    title.className = 'testimonial-title';
    title.textContent = buildRoleLine(entry);
    person.appendChild(title);

    header.append(avatar, person);
    const profileLink = createProfileLink(entry);
    if (profileLink) header.appendChild(profileLink);

    const text = document.createElement('p');
    text.className = 'testimonial-text';
    text.textContent = entry.text;

    const footer = document.createElement('div');
    footer.className = 'testimonial-footer';

    const badge = document.createElement('span');
    badge.className = 'linkedin-badge';
    badge.textContent = entry.source === 'LinkedIn Recommendation'
      ? 'via LinkedIn'
      : `via ${entry.source || 'LinkedIn'}`;

    footer.appendChild(badge);
    card.append(mark, header, text, footer);

    if (options?.isClone) {
      card.setAttribute('aria-hidden', 'true');
      muteFocusable(card);
    }

    return card;
  }

  function renderGrid(grid, settings) {
    if (!grid) return;
    const limit = asPositiveInt(grid.getAttribute('data-testimonials-limit'), settings.items.length);
    const theme = grid.getAttribute('data-testimonials-theme') === 'light' ? 'light' : 'dark';
    const items = settings.items.slice(0, limit);
    grid.setAttribute('role', 'list');
    grid.replaceChildren(...items.map((entry) => buildCard(entry, { theme })));
  }

  function renderTrack(track, settings) {
    if (!track) return;
    const limit = asPositiveInt(track.getAttribute('data-testimonials-limit'), settings.items.length);
    const theme = track.getAttribute('data-testimonials-theme') === 'light' ? 'light' : 'dark';
    const items = settings.items.slice(0, limit);
    const cards = items.map((entry) => buildCard(entry, { theme }));
    const clones = items.length > 1
      ? items.map((entry) => buildCard(entry, { theme, isClone: true }))
      : [];
    track.classList.toggle('feed-track--static', items.length <= 1);
    track.setAttribute('role', 'list');
    track.replaceChildren(...cards, ...clones);
  }

  function syncSectionVisibility(settings) {
    const visible = settings.enabled && settings.items.length > 0;
    document.querySelectorAll('[data-testimonials-section]').forEach((section) => {
      section.hidden = !visible;
    });
  }

  async function loadSettings() {
    try {
      const response = await fetch(buildSettingsUrl(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`settings_${response.status}`);
      const payload = await response.json();
      return normaliseSettings(payload?.settings?.linkedinTestimonials);
    } catch (error) {
      console.warn('[HMJ]', 'testimonial settings fallback', error);
      return createDefaultSettings();
    }
  }

  async function init() {
    const settings = await loadSettings();
    syncSectionVisibility(settings);
    document.querySelectorAll('[data-testimonials-grid]').forEach((grid) => renderGrid(grid, settings));
    document.querySelectorAll('[data-testimonials-track]').forEach((track) => renderTrack(track, settings));
    window.HMJTestimonials = {
      settings,
      reload: init,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
