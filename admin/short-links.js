(function () {
  'use strict';

  const state = {
    helpers: null,
    who: null,
    items: [],
    busy: false,
    storageReady: true,
  };

  const els = {};

  function normaliseText(value = '') {
    return String(value || '').trim();
  }

  function slugify(value = '') {
    return normaliseText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 80);
  }

  function validateDestination(value = '') {
    const raw = normaliseText(value);
    if (!raw) return { ok: false, error: 'Paste a destination URL to continue.' };
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: 'Enter a full URL including http:// or https://.' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Only http:// and https:// destinations are supported.' };
    }
    if (!parsed.hostname) {
      return { ok: false, error: 'Enter a full destination URL with a hostname.' };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: 'Destination URLs cannot include embedded usernames or passwords.' };
    }
    return { ok: true, url: parsed.toString(), parsed };
  }

  function suggestSlug({ title = '', destinationUrl = '' } = {}) {
    const titleSlug = slugify(title);
    if (titleSlug) return titleSlug;
    const destination = validateDestination(destinationUrl);
    if (!destination.ok) return 'link';
    const segments = destination.parsed.pathname
      .split('/')
      .map((segment) => segment.replace(/\.[a-z0-9]+$/i, ''))
      .map(slugify)
      .filter(Boolean)
      .filter((segment) => !['go', 'index', 'home', 'link', 'links', 'share'].includes(segment));
    return segments[segments.length - 1] || slugify(destination.parsed.hostname.replace(/^www\./i, '').replace(/\./g, '-')) || 'link';
  }

  function formatDateTime(value) {
    if (!value) return 'just now';
    try {
      return new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return value;
    }
  }

  function setBusy(next) {
    state.busy = !!next;
    if (els.submit) els.submit.disabled = state.busy;
    if (els.refresh) els.refresh.disabled = state.busy;
    if (els.suggest) els.suggest.disabled = state.busy;
  }

  function setFeedback(message = '', tone = 'info') {
    if (!els.feedback) return;
    if (!message) {
      els.feedback.hidden = true;
      els.feedback.textContent = '';
      els.feedback.dataset.tone = '';
      return;
    }
    els.feedback.hidden = false;
    els.feedback.dataset.tone = tone;
    els.feedback.textContent = message;
  }

  function updatePreview() {
    if (!els.preview) return;
    const rawSlug = normaliseText(els.slug?.value || '');
    const cleanSlug = slugify(rawSlug);
    const destination = normaliseText(els.destination?.value || '');
    const title = normaliseText(els.title?.value || '');
    const suggested = cleanSlug || suggestSlug({ title, destinationUrl: destination });
    const preview = `${window.location.origin}/go/${suggested}`;
    els.preview.textContent = rawSlug
      ? `Short code will be saved as ${cleanSlug || 'link'} and published at ${preview}`
      : `Leave the short code blank to auto-generate one like ${preview}`;
  }

  function setResult(item) {
    if (!els.result || !els.output || !item) return;
    els.result.hidden = false;
    els.output.value = item.shortUrl || '';
    if (els.outputMeta) {
      const metaParts = [
        item.slug ? `Slug ${item.slug}` : '',
        item.createdAt ? `Created ${formatDateTime(item.createdAt)}` : '',
        item.createdByEmail || item.createdBy ? `By ${item.createdByEmail || item.createdBy}` : '',
      ].filter(Boolean);
      els.outputMeta.textContent = metaParts.join(' · ');
    }
    if (els.open) els.open.href = item.shortUrl || '#';
  }

  async function copyText(value, input) {
    if (!value) return false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    if (!input) return false;
    input.focus();
    input.select();
    const ok = document.execCommand('copy');
    input.blur();
    return ok;
  }

  function createActionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderHistory(items) {
    if (!els.list) return;
    els.list.innerHTML = '';

    if (!state.storageReady) {
      const empty = document.createElement('div');
      empty.className = 'shortlink-empty';
      empty.textContent = 'Short-link storage is not enabled yet. Run the SQL script, then refresh this card.';
      els.list.appendChild(empty);
      return;
    }

    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement('div');
      empty.className = 'shortlink-empty';
      empty.textContent = 'No short links yet. Create one here and it will appear for quick reuse.';
      els.list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'shortlink-item';

      const top = document.createElement('div');
      top.className = 'shortlink-item__top';

      const titleWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'shortlink-item__title';
      title.textContent = item.title || item.slug || 'Untitled link';
      const meta = document.createElement('p');
      meta.className = 'shortlink-item__meta';
      meta.textContent = [
        `Created ${formatDateTime(item.createdAt)}`,
        item.createdByEmail || item.createdBy ? `by ${item.createdByEmail || item.createdBy}` : '',
        Number.isFinite(item.clickCount) ? `${item.clickCount} clicks` : '',
      ].filter(Boolean).join(' · ');
      titleWrap.append(title, meta);

      const slug = document.createElement('span');
      slug.className = `shortlink-item__slug${item.isActive === false ? ' shortlink-item__slug--inactive' : ''}`;
      slug.textContent = item.isActive === false ? `${item.slug} · inactive` : item.slug;

      top.append(titleWrap, slug);

      const url = document.createElement('p');
      url.className = 'shortlink-item__url';
      url.textContent = item.shortUrl || '';

      const actions = document.createElement('div');
      actions.className = 'shortlink-item__actions';
      actions.append(
        createActionButton('Use', 'btn outline small', () => {
          if (els.title) els.title.value = item.title || '';
          if (els.destination) els.destination.value = item.destinationUrl || '';
          if (els.slug) els.slug.value = item.slug || '';
          setResult(item);
          updatePreview();
          setFeedback('Loaded into the generator for reuse.', 'info');
        }),
        createActionButton('Copy', 'btn outline small', async () => {
          try {
            const ok = await copyText(item.shortUrl || '', els.output);
            if (!ok) throw new Error('copy_failed');
            (window.hmjToast || state.helpers.toast)('Short link copied', 'ok', 1400);
          } catch {
            (window.hmjToast || state.helpers.toast)('Copy failed', 'error', 2200);
          }
        })
      );

      const open = document.createElement('a');
      open.className = 'btn small';
      open.href = item.shortUrl || '#';
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'Open';
      actions.append(open);

      card.append(top, url, actions);
      els.list.appendChild(card);
    });
  }

  async function loadHistory() {
    if (!state.helpers) return;
    try {
      const res = await state.helpers.api('/admin-short-links?limit=6', 'GET');
      state.items = Array.isArray(res?.items) ? res.items : [];
      state.storageReady = res?.storageReady !== false;
      renderHistory(state.items);
      if (res?.storageReady === false) {
        setFeedback(res?.message || 'Short-link storage needs its SQL setup before links can be saved.', 'info');
      }
    } catch (error) {
      state.storageReady = false;
      renderHistory([]);
      setFeedback(error?.message || 'Unable to load recent short links.', 'error');
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!state.helpers || state.busy) return;

    const destinationValue = normaliseText(els.destination?.value || '');
    const destination = validateDestination(destinationValue);
    if (!destination.ok) {
      setFeedback(destination.error, 'error');
      els.destination?.focus();
      return;
    }

    const rawSlug = normaliseText(els.slug?.value || '');
    const cleanSlug = slugify(rawSlug);
    if (rawSlug && !cleanSlug) {
      setFeedback('Use only letters, numbers, and hyphens for the short code.', 'error');
      els.slug?.focus();
      return;
    }

    if (rawSlug && cleanSlug !== rawSlug) {
      els.slug.value = cleanSlug;
    }

    setBusy(true);
    setFeedback('Creating short link…', 'info');

    try {
      const res = await state.helpers.api('/admin-short-links', 'POST', {
        title: normaliseText(els.title?.value || ''),
        destinationUrl: destination.url,
        slug: cleanSlug,
      });

      if (!res?.item) {
        throw new Error('Unexpected response from the short-link service.');
      }

      if (els.slug) els.slug.value = res.item.slug || cleanSlug;
      if (els.destination) els.destination.value = res.item.destinationUrl || destination.url;
      setResult(res.item);
      updatePreview();
      setFeedback('Short link ready to copy and share.', 'ok');
      (window.hmjToast || state.helpers.toast)('Short link created', 'ok', 1500);
      await loadHistory();
    } catch (error) {
      const details = error?.details || {};
      if (details?.code === 'slug_taken' && details?.suggestedSlug && els.slug) {
        els.slug.value = details.suggestedSlug;
        updatePreview();
        setFeedback(`That short code is already taken. Suggested code loaded: ${details.suggestedSlug}.`, 'error');
        els.slug.focus();
      } else {
        setFeedback(details?.error || error?.message || 'Unable to create the short link.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSuggest() {
    if (!els.slug) return;
    const suggestion = suggestSlug({
      title: normaliseText(els.title?.value || ''),
      destinationUrl: normaliseText(els.destination?.value || ''),
    });
    els.slug.value = suggestion;
    updatePreview();
    setFeedback(`Suggested short code loaded: ${suggestion}.`, 'info');
  }

  function bindEvents() {
    els.form?.addEventListener('submit', handleCreate);
    els.refresh?.addEventListener('click', () => {
      if (state.busy) return;
      loadHistory();
    });
    els.suggest?.addEventListener('click', handleSuggest);
    [els.title, els.destination, els.slug].forEach((node) => {
      node?.addEventListener('input', () => {
        if (els.feedback?.dataset?.tone === 'error') {
          setFeedback('');
        }
        updatePreview();
      });
    });
    els.copy?.addEventListener('click', async () => {
      try {
        const ok = await copyText(els.output?.value || '', els.output);
        if (!ok) throw new Error('copy_failed');
        setFeedback('Short link copied to the clipboard.', 'ok');
        (window.hmjToast || state.helpers.toast)('Copied', 'ok', 1200);
      } catch {
        setFeedback('Copy failed. Try selecting the short link manually.', 'error');
        (window.hmjToast || state.helpers.toast)('Copy failed', 'error', 2200);
      }
    });
  }

  function cacheEls() {
    els.form = document.getElementById('shortLinkForm');
    els.title = document.getElementById('shortLinkTitle');
    els.destination = document.getElementById('shortLinkDestination');
    els.slug = document.getElementById('shortLinkSlug');
    els.preview = document.getElementById('shortLinkPreview');
    els.feedback = document.getElementById('shortLinkFeedback');
    els.result = document.getElementById('shortLinkResult');
    els.output = document.getElementById('shortLinkOutput');
    els.outputMeta = document.getElementById('shortLinkMeta');
    els.copy = document.getElementById('btnCopyShortLink');
    els.open = document.getElementById('shortLinkOpen');
    els.refresh = document.getElementById('btnRefreshShortLinks');
    els.suggest = document.getElementById('btnSuggestShortLink');
    els.submit = document.getElementById('btnCreateShortLink');
    els.list = document.getElementById('shortLinkList');
  }

  function init({ helpers, who } = {}) {
    cacheEls();
    if (!els.form) return;
    state.helpers = helpers || null;
    state.who = who || null;
    bindEvents();
    updatePreview();
    loadHistory();
  }

  window.HMJShortLinks = { init };
})();
