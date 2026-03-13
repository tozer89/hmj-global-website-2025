(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const doc = document;
  const state = {
    helpers: null,
    notices: [],
    enabled: true,
    readOnly: true,
    setupRequired: false,
    source: 'loading',
    error: '',
    user: null,
    loading: false,
    filters: {
      query: '',
      status: 'all',
      presentation: 'all',
    },
    editor: null,
  };

  const els = {};

  function byId(id) {
    return doc.getElementById(id);
  }

  function cacheElements() {
    [
      'welcomeMeta', 'heroSummary', 'heroVisibilityLabel',
      'noticeboardEnabled', 'toggleStateChip', 'toggleStateLabel', 'saveVisibilityBtn',
      'metricPublished', 'metricScheduled', 'metricDraft', 'metricFeatured',
      'metricPublishedLabel', 'metricScheduledLabel', 'metricDraftLabel', 'metricFeaturedLabel',
      'searchInput', 'statusFilter', 'presentationFilter', 'refreshBtn', 'newNoticeBtn',
      'resultMeta', 'noticeGrid', 'emptyState', 'emptyStateCopy', 'noticeBanner',
      'noticeBannerTitle', 'noticeBannerBody', 'boardSourceChip', 'editor', 'editorTitle',
      'editorStatusPill', 'editorMeta', 'closeEditorBtn', 'noticeForm', 'fieldTitle', 'fieldSlug',
      'fieldStatus', 'fieldSummary', 'fieldBody', 'fieldPublishAt', 'fieldExpiresAt',
      'fieldSortOrder', 'fieldCtaLabel', 'fieldCtaUrl', 'fieldFeatured', 'fieldImageAlt',
      'imageFrame', 'imagePreview', 'imageMeta', 'imageInput', 'uploadImageBtn', 'removeImageBtn',
      'previewCard', 'publishHint', 'deleteNoticeBtn', 'saveDraftBtn', 'scheduleBtn',
      'archiveBtn', 'publishBtn', 'saveNoticeBtn'
    ].forEach((id) => {
      els[id] = byId(id);
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asString(value) {
    if (typeof value === 'string') return value.trim();
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function createAutoSlug(value) {
    return asString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function deriveSummary(value) {
    const summary = asString(value);
    if (summary) return summary;
    return asString(els.fieldBody?.value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 190)
      .replace(/\s+\S*$/, '')
      || 'Add a summary to sharpen the public card hierarchy.';
  }

  function formatDateTime(value) {
    if (!value) return 'Not set';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function toLocalInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ];
    const time = [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
    ];
    return `${parts.join('-')}T${time.join(':')}`;
  }

  function fromLocalInput(value) {
    const raw = asString(value);
    if (!raw) return '';
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function computeEffectiveStatus(notice) {
    const status = asString(notice?.status || 'draft').toLowerCase() || 'draft';
    const now = Date.now();
    const publishAt = notice?.publishAt ? Date.parse(notice.publishAt) : null;
    const expiresAt = notice?.expiresAt ? Date.parse(notice.expiresAt) : null;

    if (Number.isFinite(expiresAt) && expiresAt <= now) return 'archived';
    if (status === 'archived') return 'archived';
    if (status === 'draft') return 'draft';
    if (Number.isFinite(publishAt) && publishAt > now) return 'scheduled';
    return 'published';
  }

  function statusLabel(status) {
    switch (status) {
      case 'published': return 'Published';
      case 'scheduled': return 'Scheduled';
      case 'archived': return 'Archived';
      default: return 'Draft';
    }
  }

  function formatPublishWindow(notice) {
    const publishAt = notice.publishAt ? formatDateTime(notice.publishAt) : 'Immediate when published';
    if (notice.expiresAt) {
      return `${publishAt} to ${formatDateTime(notice.expiresAt)}`;
    }
    return publishAt;
  }

  function buildPresentationMeta(notice) {
    const bits = [];
    if (notice.featured) bits.push('Featured');
    if (notice.imageUrl) bits.push('Image');
    if (notice.ctaUrl) bits.push('CTA');
    if (!bits.length) bits.push('Text-first');
    return bits;
  }

  function cloneNotice(seed = {}) {
    return {
      id: '',
      title: '',
      slug: '',
      summary: '',
      body: '',
      status: 'draft',
      publishAt: '',
      expiresAt: '',
      imageUrl: '',
      imageStorageKey: '',
      imageAltText: '',
      featured: false,
      sortOrder: 100,
      ctaLabel: '',
      ctaUrl: '',
      createdAt: '',
      updatedAt: '',
      effectiveStatus: 'draft',
      ...seed,
    };
  }

  function countByEffectiveStatus() {
    const counts = { published: 0, scheduled: 0, draft: 0, archived: 0, featured: 0 };
    state.notices.forEach((notice) => {
      const effectiveStatus = computeEffectiveStatus(notice);
      counts[effectiveStatus] += 1;
      if (notice.featured) counts.featured += 1;
    });
    return counts;
  }

  function applyFilters() {
    const query = state.filters.query.toLowerCase();
    return state.notices.filter((notice) => {
      const effectiveStatus = computeEffectiveStatus(notice);
      if (state.filters.status !== 'all' && effectiveStatus !== state.filters.status) {
        return false;
      }
      if (state.filters.presentation === 'featured' && !notice.featured) return false;
      if (state.filters.presentation === 'with-image' && !notice.imageUrl) return false;
      if (state.filters.presentation === 'cta' && !notice.ctaUrl) return false;

      if (!query) return true;
      const haystack = [
        notice.title,
        notice.summary,
        notice.body,
        notice.slug,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderOverview() {
    const counts = countByEffectiveStatus();
    els.metricPublished.textContent = String(counts.published);
    els.metricScheduled.textContent = String(counts.scheduled);
    els.metricDraft.textContent = String(counts.draft);
    els.metricFeatured.textContent = String(counts.featured);

    const liveLabel = state.enabled ? 'Public section live' : 'Public section hidden';
    els.heroVisibilityLabel.textContent = liveLabel;
    els.toggleStateChip.textContent = state.enabled ? 'About Us noticeboard is live' : 'About Us noticeboard is hidden';
    els.toggleStateLabel.textContent = state.enabled ? 'Public on' : 'Public off';
    els.noticeboardEnabled.checked = !!state.enabled;
    els.noticeboardEnabled.disabled = !!state.readOnly;
    els.saveVisibilityBtn.disabled = !!state.readOnly;
    els.newNoticeBtn.disabled = !!state.readOnly;
    els.heroSummary.textContent = state.readOnly
      ? (state.setupRequired
        ? 'The module is ready, but this environment still needs the noticeboard SQL/storage setup before content can be saved.'
        : 'The noticeboard is currently read-only because the live data source is unavailable.')
      : (state.enabled
        ? 'Published notices can flow straight into the About Us noticeboard once saved or scheduled.'
        : 'All posts remain safely stored, but the About Us noticeboard is currently switched off.');

    els.toggleStateChip.className = `chip ${state.enabled ? 'status-pill--published' : 'status-pill--archived'}`;
    els.boardSourceChip.textContent = state.setupRequired
      ? 'Setup required'
      : (state.source === 'supabase' ? 'Live source' : 'Read-only preview');

    const bannerVisible = !!state.error || !!state.setupRequired || !!state.readOnly;
    els.noticeBanner.hidden = !bannerVisible;
    if (bannerVisible) {
      els.noticeBanner.style.display = 'grid';
      els.noticeBanner.dataset.tone = state.setupRequired ? 'warn' : 'info';
      els.noticeBannerTitle.textContent = state.setupRequired
        ? 'Noticeboard setup still needs to be applied'
        : (state.readOnly ? 'Noticeboard is currently read-only' : 'Noticeboard information');
      els.noticeBannerBody.textContent = state.setupRequired
        ? 'Run the noticeboard SQL and storage setup before testing create/edit/delete flows in this environment.'
        : (state.error || 'The page has loaded in a safe read-only mode.');
    } else {
      els.noticeBanner.style.display = 'none';
    }
  }

  function renderEmptyState(filtered) {
    const hasFilters = state.filters.query || state.filters.status !== 'all' || state.filters.presentation !== 'all';
    els.emptyState.hidden = filtered.length > 0;
    els.noticeGrid.hidden = filtered.length === 0;
    if (!filtered.length) {
      els.emptyStateCopy.textContent = hasFilters
        ? 'No notices match the current search or filters.'
        : 'Create the first notice to populate the About Us noticeboard.';
    }
  }

  function renderNoticeCard(notice) {
    const effectiveStatus = computeEffectiveStatus(notice);
    const actionLabel = effectiveStatus === 'published' ? 'Hide' : 'Publish now';
    const actionName = effectiveStatus === 'published' ? 'archive' : 'publish';
    const metaBits = buildPresentationMeta(notice)
      .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
      .join('');

    const imageMarkup = notice.imageUrl
      ? `<img src="${escapeHtml(notice.imageUrl)}" alt="${escapeHtml(notice.imageAltText || notice.title)}"/>`
      : '<div class="notice-card__placeholder">No image</div>';

    return `
      <article class="notice-card">
        <div class="notice-card__media">${imageMarkup}</div>
        <div class="notice-card__body">
          <div class="notice-card__header">
            <div>
              <h3>${escapeHtml(notice.title)}</h3>
              <div class="notice-card__meta">
                <span>${escapeHtml(formatPublishWindow(notice))}</span>
              </div>
            </div>
            <span class="status-pill status-pill--${escapeHtml(effectiveStatus)}">${escapeHtml(statusLabel(effectiveStatus))}</span>
          </div>
          <p class="notice-card__summary">${escapeHtml(notice.summary || 'No summary added yet.')}</p>
          <div class="notice-card__meta">${metaBits}</div>
          <div class="notice-card__actions">
            <button class="btn soft small" type="button" data-action="edit" data-id="${escapeHtml(notice.id)}">Edit</button>
            <button class="btn ghost small" type="button" data-action="duplicate" data-id="${escapeHtml(notice.id)}">Duplicate</button>
            <button class="btn soft small" type="button" data-action="${escapeHtml(actionName)}" data-id="${escapeHtml(notice.id)}">${escapeHtml(actionLabel)}</button>
            <button class="btn danger small" type="button" data-action="delete" data-id="${escapeHtml(notice.id)}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderNoticeList() {
    const filtered = applyFilters();
    const total = state.notices.length;
    els.resultMeta.textContent = total
      ? `Showing ${filtered.length} of ${total} notice${total === 1 ? '' : 's'}.`
      : 'No notices loaded yet.';
    renderEmptyState(filtered);
    if (!filtered.length) {
      els.noticeGrid.innerHTML = '';
      return;
    }
    els.noticeGrid.innerHTML = filtered.map(renderNoticeCard).join('');
  }

  function setEditorOpen(open) {
    els.editor.classList.toggle('is-open', open);
    els.editor.setAttribute('aria-hidden', String(!open));
  }

  async function cleanupTransientImage() {
    if (!state.editor) return;
    const currentKey = asString(state.editor.draft.imageStorageKey);
    const originalKey = asString(state.editor.original?.imageStorageKey);
    if (!currentKey || currentKey === originalKey) return;
    try {
      await state.helpers.api('admin-noticeboard-image-delete', 'POST', { storageKey: currentKey });
    } catch (error) {
      console.warn('[noticeboard] transient image cleanup failed', error);
    }
  }

  async function closeEditor(options = {}) {
    const cleanupTransient = options.cleanupTransient === true;
    if (cleanupTransient) {
      await cleanupTransientImage();
    }
    state.editor = null;
    setEditorOpen(false);
  }

  function updateImagePreview() {
    const draft = state.editor?.draft;
    if (!draft) return;
    if (draft.imageUrl) {
      els.imageFrame.classList.add('has-image');
      els.imagePreview.src = draft.imageUrl;
      els.imagePreview.alt = draft.imageAltText || draft.title || 'Notice image';
      els.imageMeta.textContent = 'Image uploaded and ready for the public noticeboard.';
    } else {
      els.imageFrame.classList.remove('has-image');
      els.imagePreview.removeAttribute('src');
      els.imagePreview.alt = '';
      els.imageMeta.textContent = 'JPG, PNG, WebP, or AVIF up to 6MB. Images are cropped responsively for the public cards.';
    }
  }

  function updatePublishHint() {
    if (!state.editor) return;
    const draft = state.editor.draft;
    const effectiveStatus = computeEffectiveStatus(draft);
    const publishWindow = draft.publishAt ? formatDateTime(draft.publishAt) : 'immediately';
    const hints = {
      draft: 'Draft notices remain visible only in admin until you publish or schedule them.',
      scheduled: `This notice is set to go live at ${publishWindow}.`,
      published: `This notice is ready for the public About Us page ${draft.publishAt ? `from ${publishWindow}` : 'immediately'}.`,
      archived: 'Archived notices stay in admin for reuse but remain hidden publicly.',
    };
    let message = hints[effectiveStatus] || hints.draft;
    if (draft.expiresAt) {
      message += ` It will switch off on ${formatDateTime(draft.expiresAt)}.`;
    }
    els.publishHint.textContent = message;
  }

  function renderPreviewCard() {
    if (!state.editor) return;
    const draft = state.editor.draft;
    const effectiveStatus = computeEffectiveStatus(draft);
    const summary = deriveSummary(draft.summary);
    const imageMarkup = draft.imageUrl
      ? `<img src="${escapeHtml(draft.imageUrl)}" alt="${escapeHtml(draft.imageAltText || draft.title || 'Notice image')}"/>`
      : '<span>Image treatment preview</span>';
    const ctaMarkup = draft.ctaUrl
      ? `<span class="preview-card__cta">${escapeHtml(draft.ctaLabel || 'Read more')}</span>`
      : '';
    const metaMarkup = [
      `<span class="preview-card__tag">${escapeHtml(statusLabel(effectiveStatus))}</span>`,
      `<span class="preview-card__tag">${escapeHtml(draft.publishAt ? formatDateTime(draft.publishAt) : 'Immediate')}</span>`,
      draft.featured ? '<span class="preview-card__tag">Featured</span>' : '',
    ].filter(Boolean).join('');

    els.previewCard.innerHTML = `
      <div class="preview-card__media">${imageMarkup}</div>
      <div class="preview-card__meta">${metaMarkup}</div>
      <h3 class="preview-card__title">${escapeHtml(draft.title || 'Notice title')}</h3>
      <p class="preview-card__summary">${escapeHtml(summary)}</p>
      <p class="preview-card__body">${escapeHtml((draft.body || 'Full notice content appears in the public dialog when someone opens the card.').slice(0, 220))}</p>
      ${ctaMarkup}
    `;
    els.editorStatusPill.textContent = statusLabel(effectiveStatus);
    els.editorStatusPill.className = `status-pill status-pill--${effectiveStatus}`;
    updatePublishHint();
  }

  function syncFormFromDraft() {
    if (!state.editor) return;
    const draft = state.editor.draft;
    els.fieldTitle.value = draft.title || '';
    els.fieldSlug.value = draft.slug || '';
    els.fieldSummary.value = draft.summary || '';
    els.fieldBody.value = draft.body || '';
    els.fieldStatus.value = draft.status || 'draft';
    els.fieldPublishAt.value = toLocalInputValue(draft.publishAt);
    els.fieldExpiresAt.value = toLocalInputValue(draft.expiresAt);
    els.fieldSortOrder.value = Number.isFinite(Number(draft.sortOrder)) ? String(draft.sortOrder) : '100';
    els.fieldCtaLabel.value = draft.ctaLabel || '';
    els.fieldCtaUrl.value = draft.ctaUrl || '';
    els.fieldFeatured.checked = !!draft.featured;
    els.fieldImageAlt.value = draft.imageAltText || '';

    const effectiveStatus = computeEffectiveStatus(draft);
    els.editorTitle.textContent = draft.id ? 'Edit notice' : 'New notice';
    els.editorMeta.textContent = draft.id
      ? `Updated ${formatDateTime(draft.updatedAt || draft.createdAt || nowIso())}`
      : 'New notice';
    els.deleteNoticeBtn.disabled = !draft.id || !!state.readOnly;
    els.saveDraftBtn.disabled = !!state.readOnly;
    els.scheduleBtn.disabled = !!state.readOnly;
    els.archiveBtn.disabled = !!state.readOnly;
    els.publishBtn.disabled = !!state.readOnly;
    els.saveNoticeBtn.disabled = !!state.readOnly;
    els.uploadImageBtn.disabled = !!state.readOnly;
    els.removeImageBtn.disabled = !!state.readOnly;
    els.fieldTitle.disabled = !!state.readOnly;
    els.fieldSlug.disabled = !!state.readOnly;
    els.fieldSummary.disabled = !!state.readOnly;
    els.fieldBody.disabled = !!state.readOnly;
    els.fieldStatus.disabled = !!state.readOnly;
    els.fieldPublishAt.disabled = !!state.readOnly;
    els.fieldExpiresAt.disabled = !!state.readOnly;
    els.fieldSortOrder.disabled = !!state.readOnly;
    els.fieldCtaLabel.disabled = !!state.readOnly;
    els.fieldCtaUrl.disabled = !!state.readOnly;
    els.fieldFeatured.disabled = !!state.readOnly;
    els.fieldImageAlt.disabled = !!state.readOnly;
    els.editorStatusPill.textContent = statusLabel(effectiveStatus);
    els.editorStatusPill.className = `status-pill status-pill--${effectiveStatus}`;

    updateImagePreview();
    renderPreviewCard();
  }

  function readDraftFromForm() {
    return {
      ...state.editor.draft,
      title: asString(els.fieldTitle.value),
      slug: asString(els.fieldSlug.value),
      summary: asString(els.fieldSummary.value),
      body: asString(els.fieldBody.value),
      status: asString(els.fieldStatus.value) || 'draft',
      publishAt: fromLocalInput(els.fieldPublishAt.value),
      expiresAt: fromLocalInput(els.fieldExpiresAt.value),
      sortOrder: Number.parseInt(els.fieldSortOrder.value || '100', 10) || 100,
      ctaLabel: asString(els.fieldCtaLabel.value),
      ctaUrl: asString(els.fieldCtaUrl.value),
      featured: !!els.fieldFeatured.checked,
      imageAltText: asString(els.fieldImageAlt.value),
    };
  }

  function openEditor(notice, options = {}) {
    const duplicate = options.duplicate === true;
    const seed = notice ? cloneNotice(notice) : cloneNotice();
    const draft = duplicate
      ? cloneNotice({
        ...seed,
        id: '',
        title: seed.title ? `${seed.title} (Copy)` : '',
        slug: '',
        status: 'draft',
        publishAt: '',
        expiresAt: '',
        featured: false,
        imageUrl: '',
        imageStorageKey: '',
        imageAltText: '',
        createdAt: '',
        updatedAt: '',
      })
      : seed;

    state.editor = {
      original: duplicate ? null : (notice ? cloneNotice(notice) : null),
      draft,
      removedImageKeys: new Set(),
      slugTouched: !!draft.slug,
    };

    syncFormFromDraft();
    setEditorOpen(true);
  }

  function findNotice(id) {
    return state.notices.find((notice) => notice.id === id) || null;
  }

  async function uploadImage(file) {
    if (!file || !state.editor || state.readOnly) return;

    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error(`Unable to read ${file.name}.`));
          return;
        }
        const bytes = new Uint8Array(result);
        const chunkSize = 0x8000;
        let binary = '';
        for (let index = 0; index < bytes.length; index += chunkSize) {
          const chunk = bytes.subarray(index, index + chunkSize);
          let segment = '';
          for (let cursor = 0; cursor < chunk.length; cursor += 1) {
            segment += String.fromCharCode(chunk[cursor]);
          }
          binary += segment;
        }
        resolve(window.btoa(binary));
      };
      reader.readAsArrayBuffer(file);
    });

    const currentKey = asString(state.editor.draft.imageStorageKey);
    const originalKey = asString(state.editor.original?.imageStorageKey);
    const replaceStorageKey = currentKey && currentKey !== originalKey ? currentKey : '';
    const response = await state.helpers.api('admin-noticeboard-image-upload', 'POST', {
      name: file.name,
      contentType: file.type,
      data: base64,
      replaceStorageKey,
    });

    if (originalKey && originalKey !== response.imageStorageKey) {
      state.editor.removedImageKeys.add(originalKey);
    }

    state.editor.draft.imageUrl = response.imageUrl || '';
    state.editor.draft.imageStorageKey = response.imageStorageKey || '';
    if (!state.editor.draft.imageAltText) {
      state.editor.draft.imageAltText = state.editor.draft.title || file.name.replace(/\.[^.]+$/, '');
    }

    syncFormFromDraft();
    state.helpers.toast.ok('Image uploaded');
  }

  async function removeImage() {
    if (!state.editor) return;
    const currentKey = asString(state.editor.draft.imageStorageKey);
    const originalKey = asString(state.editor.original?.imageStorageKey);

    if (currentKey && currentKey !== originalKey) {
      await state.helpers.api('admin-noticeboard-image-delete', 'POST', { storageKey: currentKey });
    }
    if (originalKey) {
      state.editor.removedImageKeys.add(originalKey);
    }

    state.editor.draft.imageUrl = '';
    state.editor.draft.imageStorageKey = '';
    state.editor.draft.imageAltText = '';
    syncFormFromDraft();
  }

  async function loadNotices(options = {}) {
    if (state.loading && !options.force) return;
    state.loading = true;
    try {
      const response = await state.helpers.api('admin-noticeboard-list', 'POST', {});
      state.notices = Array.isArray(response.notices) ? response.notices : [];
      state.enabled = response.enabled !== false;
      state.readOnly = !!response.readOnly;
      state.setupRequired = !!response.schema;
      state.source = response.source || 'unknown';
      state.error = response.error || '';
    } catch (error) {
      state.notices = [];
      state.readOnly = true;
      state.setupRequired = false;
      state.source = 'unavailable';
      state.error = error?.message || 'Unable to load notices';
      state.helpers.toast.err(state.error, 4200);
    } finally {
      state.loading = false;
      renderOverview();
      renderNoticeList();
    }
  }

  async function saveVisibility() {
    if (state.readOnly) return;
    const enabled = !!els.noticeboardEnabled.checked;
    try {
      await state.helpers.api('admin-settings-save', 'POST', {
        noticeboard_enabled: enabled,
      });
      state.enabled = enabled;
      renderOverview();
      state.helpers.toast.ok('Public visibility updated');
    } catch (error) {
      els.noticeboardEnabled.checked = state.enabled;
      renderOverview();
      state.helpers.toast.err(error?.message || 'Unable to save visibility', 4200);
    }
  }

  function buildSavePayload(mode) {
    const draft = readDraftFromForm();
    if (!draft.slug && draft.title) {
      draft.slug = createAutoSlug(draft.title);
      els.fieldSlug.value = draft.slug;
    }

    if (mode === 'draft') {
      draft.status = 'draft';
    } else if (mode === 'schedule') {
      draft.status = 'scheduled';
    } else if (mode === 'publish') {
      draft.status = 'published';
      draft.publishAt = nowIso();
    } else if (mode === 'archive') {
      draft.status = 'archived';
    }

    state.editor.draft = draft;
    return draft;
  }

  async function saveNotice(mode) {
    if (!state.editor || state.readOnly) return;

    const draft = buildSavePayload(mode);
    const originalKey = asString(state.editor.original?.imageStorageKey);
    const removedImageKeys = Array.from(state.editor.removedImageKeys);

    try {
      const response = await state.helpers.api('admin-noticeboard-save', 'POST', {
        notice: draft,
        previousImageStorageKey: originalKey && originalKey !== draft.imageStorageKey ? originalKey : '',
        removedImageKeys,
      });
      state.helpers.toast.ok('Notice saved');
      await loadNotices({ force: true });
      await closeEditor();
      if (mode === 'publish') {
        state.helpers.toast.ok('Notice published');
      }
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to save notice', 4800);
    }
  }

  async function deleteNotice(id, options = {}) {
    if (!id || state.readOnly) return;
    const notice = findNotice(id);
    const title = notice?.title || 'this notice';
    if (!window.confirm(`Delete ${title}? This cannot be undone.`)) {
      return;
    }
    try {
      await state.helpers.api('admin-noticeboard-delete', 'POST', { id });
      state.helpers.toast.ok('Notice deleted');
      await loadNotices({ force: true });
      if (options.closeEditor) {
        await closeEditor();
      }
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to delete notice', 4800);
    }
  }

  async function quickStateChange(id, action) {
    const notice = findNotice(id);
    if (!notice) return;
    const next = cloneNotice(notice);
    if (action === 'publish') {
      next.status = 'published';
      next.publishAt = nowIso();
    } else if (action === 'archive') {
      next.status = 'archived';
    } else {
      return;
    }

    try {
      await state.helpers.api('admin-noticeboard-save', 'POST', {
        notice: next,
        previousImageStorageKey: '',
        removedImageKeys: [],
      });
      state.helpers.toast.ok(action === 'publish' ? 'Notice published' : 'Notice hidden');
      await loadNotices({ force: true });
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to update notice', 4200);
    }
  }

  function bindEvents() {
    els.searchInput.addEventListener('input', (event) => {
      state.filters.query = asString(event.target.value);
      renderNoticeList();
    });
    els.statusFilter.addEventListener('change', (event) => {
      state.filters.status = asString(event.target.value) || 'all';
      renderNoticeList();
    });
    els.presentationFilter.addEventListener('change', (event) => {
      state.filters.presentation = asString(event.target.value) || 'all';
      renderNoticeList();
    });
    els.refreshBtn.addEventListener('click', () => loadNotices({ force: true }));
    els.newNoticeBtn.addEventListener('click', () => openEditor(null));
    els.saveVisibilityBtn.addEventListener('click', saveVisibility);
    els.closeEditorBtn.addEventListener('click', () => closeEditor({ cleanupTransient: true }));
    els.uploadImageBtn.addEventListener('click', () => {
      if (!state.readOnly) {
        els.imageInput.click();
      }
    });
    els.imageInput.addEventListener('change', async (event) => {
      const [file] = event.target.files || [];
      event.target.value = '';
      if (!file) return;
      try {
        await uploadImage(file);
      } catch (error) {
        state.helpers.toast.err(error?.message || 'Image upload failed', 4600);
      }
    });
    els.removeImageBtn.addEventListener('click', async () => {
      try {
        await removeImage();
      } catch (error) {
        state.helpers.toast.err(error?.message || 'Unable to remove image', 4200);
      }
    });

    [
      'fieldTitle', 'fieldSlug', 'fieldSummary', 'fieldBody', 'fieldStatus',
      'fieldPublishAt', 'fieldExpiresAt', 'fieldSortOrder', 'fieldCtaLabel',
      'fieldCtaUrl', 'fieldFeatured', 'fieldImageAlt'
    ].forEach((id) => {
      els[id].addEventListener('input', (event) => {
        if (!state.editor) return;
        if (event.target === els.fieldTitle) {
          const slugValue = asString(els.fieldSlug.value);
          if (!state.editor.slugTouched || !slugValue) {
            els.fieldSlug.value = createAutoSlug(event.target.value);
          }
        }
        if (event.target === els.fieldSlug) {
          state.editor.slugTouched = !!asString(event.target.value);
        }
        state.editor.draft = readDraftFromForm();
        renderPreviewCard();
      });
      els[id].addEventListener('change', () => {
        if (!state.editor) return;
        state.editor.draft = readDraftFromForm();
        renderPreviewCard();
      });
    });

    els.deleteNoticeBtn.addEventListener('click', () => {
      const id = state.editor?.draft?.id;
      if (id) {
        deleteNotice(id, { closeEditor: true });
      }
    });
    els.saveDraftBtn.addEventListener('click', () => saveNotice('draft'));
    els.scheduleBtn.addEventListener('click', () => saveNotice('schedule'));
    els.archiveBtn.addEventListener('click', () => saveNotice('archive'));
    els.publishBtn.addEventListener('click', () => saveNotice('publish'));
    els.saveNoticeBtn.addEventListener('click', () => saveNotice('save'));

    els.noticeGrid.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action][data-id]');
      if (!button) return;
      const action = button.getAttribute('data-action');
      const id = button.getAttribute('data-id');
      const notice = findNotice(id);
      if (!notice) return;

      if (action === 'edit') {
        openEditor(notice);
      } else if (action === 'duplicate') {
        openEditor(notice, { duplicate: true });
      } else if (action === 'delete') {
        deleteNotice(id);
      } else if (action === 'publish' || action === 'archive') {
        quickStateChange(id, action);
      }
    });

    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.editor) {
        closeEditor({ cleanupTransient: true });
      }
    });
  }

  function init() {
    cacheElements();
    bindEvents();

    window.Admin.bootAdmin(async (helpers) => {
      state.helpers = helpers;
      state.user = await helpers.identity('admin');
      els.welcomeMeta.textContent = `Signed in as ${state.user?.email || 'admin user'}`;
      renderOverview();
      renderNoticeList();
      await loadNotices({ force: true });
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
