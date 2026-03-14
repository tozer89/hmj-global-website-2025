(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const doc = document;
  const state = {
    helpers: null,
    members: [],
    readOnly: true,
    setupRequired: false,
    source: 'loading',
    error: '',
    user: null,
    loading: false,
    filters: {
      query: '',
      status: 'all',
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
      'metricPublished', 'metricDraft', 'metricArchived', 'metricImage',
      'searchInput', 'statusFilter', 'refreshBtn', 'newMemberBtn',
      'resultMeta', 'memberGrid', 'emptyState', 'emptyStateTitle', 'emptyStateCopy',
      'teamBanner', 'teamBannerTitle', 'teamBannerBody', 'boardSourceChip',
      'editor', 'editorTitle', 'editorStatusPill', 'editorMeta', 'closeEditorBtn',
      'teamForm', 'fieldFullName', 'fieldSlug', 'fieldRoleTitle', 'fieldDisplayOrder',
      'fieldShortCaption', 'fieldFullBio', 'fieldLinkedinUrl', 'fieldPublished',
      'imageFrame', 'imagePreview', 'imageMeta', 'imageInput', 'uploadImageBtn', 'removeImageBtn',
      'fieldImageAlt', 'previewCard', 'publishHint',
      'archiveMemberBtn', 'duplicateMemberBtn', 'unpublishMemberBtn', 'publishMemberBtn', 'saveMemberBtn'
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

  function nowIso() {
    return new Date().toISOString();
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

  function deriveFirstName(fullName) {
    return asString(fullName).split(/\s+/).filter(Boolean)[0] || 'HMJ';
  }

  function computeStatus(member) {
    if (member?.archivedAt) return 'archived';
    return member?.isPublished ? 'published' : 'draft';
  }

  function statusLabel(status) {
    switch (status) {
      case 'published': return 'Published';
      case 'archived': return 'Archived';
      default: return 'Draft';
    }
  }

  function cloneMember(seed = {}) {
    return {
      id: '',
      createdAt: '',
      updatedAt: '',
      fullName: '',
      firstName: '',
      slug: '',
      roleTitle: '',
      shortCaption: '',
      fullBio: '',
      imageUrl: '',
      imageStorageKey: '',
      imageAltText: '',
      linkedinUrl: '',
      displayOrder: 100,
      isPublished: false,
      publishedAt: '',
      archivedAt: '',
      status: 'draft',
      ...seed,
    };
  }

  function sortMembers(items = []) {
    return items.slice().sort((left, right) => {
      const leftArchived = computeStatus(left) === 'archived';
      const rightArchived = computeStatus(right) === 'archived';
      if (leftArchived !== rightArchived) {
        return Number(leftArchived) - Number(rightArchived);
      }

      const leftOrder = Number.isFinite(Number(left.displayOrder)) ? Number(left.displayOrder) : 100;
      const rightOrder = Number.isFinite(Number(right.displayOrder)) ? Number(right.displayOrder) : 100;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCreated = Date.parse(left.createdAt || '') || Number.MAX_SAFE_INTEGER;
      const rightCreated = Date.parse(right.createdAt || '') || Number.MAX_SAFE_INTEGER;
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;

      return asString(left.fullName).localeCompare(asString(right.fullName), 'en-GB', { sensitivity: 'base' });
    });
  }

  function countByStatus() {
    const counts = { published: 0, draft: 0, archived: 0, withImage: 0 };
    state.members.forEach((member) => {
      counts[computeStatus(member)] += 1;
      if (member.imageUrl) counts.withImage += 1;
    });
    return counts;
  }

  function applyFilters() {
    const query = state.filters.query.toLowerCase();
    return sortMembers(state.members).filter((member) => {
      const status = computeStatus(member);
      if (state.filters.status !== 'all' && status !== state.filters.status) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        member.fullName,
        member.roleTitle,
        member.shortCaption,
        member.fullBio,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function getReorderContext(id) {
    const ordered = sortMembers(state.members).filter((member) => !member.archivedAt);
    const index = ordered.findIndex((member) => member.id === id);
    return {
      hasPrevious: index > 0,
      hasNext: index !== -1 && index < ordered.length - 1,
    };
  }

  function renderOverview() {
    const counts = countByStatus();
    els.metricPublished.textContent = String(counts.published);
    els.metricDraft.textContent = String(counts.draft);
    els.metricArchived.textContent = String(counts.archived);
    els.metricImage.textContent = String(counts.withImage);
    els.heroVisibilityLabel.textContent = counts.published ? 'About team cards live' : 'No published members';
    els.newMemberBtn.disabled = !!state.readOnly;

    if (state.setupRequired && !state.readOnly) {
      els.heroSummary.textContent = state.error
        || 'Team content is live, but image storage setup is still incomplete, so uploads and portrait replacements remain blocked.';
    } else if (state.readOnly && state.setupRequired) {
      els.heroSummary.textContent = 'This environment is still running the Team module in seeded preview mode until the Supabase SQL and storage setup are applied.';
    } else if (state.readOnly) {
      els.heroSummary.textContent = 'The Team module is currently in safe preview mode because the live data source is unavailable.';
    } else {
      els.heroSummary.textContent = counts.published
        ? 'Published members flow straight to the public About page and unpublished or archived profiles stay hidden.'
        : 'No members are currently published, so the About page team section will stay empty until you publish one.';
    }

    if (state.setupRequired && !state.readOnly) {
      els.boardSourceChip.textContent = 'Live source (setup incomplete)';
    } else {
      els.boardSourceChip.textContent = state.setupRequired
        ? 'Setup required'
        : (state.source === 'supabase' ? 'Live source' : 'Fallback preview');
    }

    const bannerVisible = !!state.error || !!state.setupRequired || !!state.readOnly;
    els.teamBanner.hidden = !bannerVisible;
    if (bannerVisible) {
      els.teamBanner.dataset.tone = state.setupRequired ? 'warn' : 'info';
      if (state.setupRequired && state.readOnly) {
        els.teamBannerTitle.textContent = 'Team setup still needs to be applied';
        els.teamBannerBody.textContent = state.error
          || 'Run the Team SQL script in Supabase to create the team_members table and team-images bucket. Until then this page stays in seeded preview mode.';
      } else if (state.setupRequired) {
        els.teamBannerTitle.textContent = 'Team setup is incomplete';
        els.teamBannerBody.textContent = state.error
          || 'The Team table is live, but the team-images bucket is still missing, so uploads and image replacement are disabled until the full SQL is applied.';
      } else if (state.readOnly) {
        els.teamBannerTitle.textContent = 'Team module is currently read-only';
        els.teamBannerBody.textContent = state.error || 'The page has loaded in a safe read-only mode.';
      } else {
        els.teamBannerTitle.textContent = 'Team information';
        els.teamBannerBody.textContent = state.error || 'The page has loaded successfully.';
      }
    } else {
      delete els.teamBanner.dataset.tone;
    }
  }

  function renderEmptyState(filtered) {
    const hasFilters = state.filters.query || state.filters.status !== 'all';
    els.emptyState.hidden = filtered.length > 0;
    els.memberGrid.hidden = filtered.length === 0;
    if (!filtered.length) {
      if (hasFilters) {
        els.emptyStateTitle.textContent = 'No matching team members';
        els.emptyStateCopy.textContent = 'No team members match the current search or status filter.';
      } else if (state.setupRequired && state.readOnly) {
        els.emptyStateTitle.textContent = 'Team setup required';
        els.emptyStateCopy.textContent = state.error
          || 'Apply the Team Supabase SQL to move this module out of preview mode and enable live content management.';
      } else if (state.readOnly) {
        els.emptyStateTitle.textContent = 'Team preview unavailable';
        els.emptyStateCopy.textContent = 'The Team module could not load live data in this environment, so editing is temporarily disabled.';
      } else {
        els.emptyStateTitle.textContent = 'No team members yet';
        els.emptyStateCopy.textContent = 'Add the first team member to populate the About Us team section.';
      }
    }
  }

  function renderMemberCard(member, index, collection) {
    const status = computeStatus(member);
    const reorder = getReorderContext(member.id);
    const readOnlyAttr = state.readOnly ? 'disabled' : '';
    const quickLabel = status === 'published' ? 'Unpublish' : 'Publish';
    const quickAction = status === 'published' ? 'unpublish' : 'publish';
    const quickDisabled = state.readOnly || status === 'archived' ? 'disabled' : '';
    const imageMarkup = member.imageUrl
      ? `<img src="${escapeHtml(member.imageUrl)}" alt="${escapeHtml(member.imageAltText || member.fullName || 'Team member')}"/>`
      : '<div class="member-card__placeholder">No image</div>';
    const metaBits = [
      `<span>Order ${escapeHtml(member.displayOrder)}</span>`,
      status === 'published' && member.publishedAt
        ? `<span>Live since ${escapeHtml(formatDateTime(member.publishedAt))}</span>`
        : '',
      `<span>Updated ${escapeHtml(formatDateTime(member.updatedAt || member.createdAt || nowIso()))}</span>`,
      member.linkedinUrl ? '<span>LinkedIn linked</span>' : '<span>No LinkedIn link</span>',
    ].filter(Boolean);

    return `
      <article class="member-card">
        <div class="member-card__media">${imageMarkup}</div>
        <div class="member-card__body">
          <div class="member-card__header">
            <div>
              <h3>${escapeHtml(member.fullName || 'Untitled member')}</h3>
              <p class="member-card__role">${escapeHtml(member.roleTitle || 'Role title pending')}</p>
            </div>
            <span class="status-pill status-pill--${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
          </div>
          <p class="member-card__summary">${escapeHtml(member.shortCaption || 'Add a short summary to shape the public card reveal state.')}</p>
          <div class="member-card__meta">${metaBits.join('')}</div>
          <div class="member-card__actions">
            <div class="member-card__action-row">
              <button class="btn soft small" type="button" data-action="edit" data-id="${escapeHtml(member.id)}" ${readOnlyAttr}>Edit</button>
              <button class="btn ghost small" type="button" data-action="duplicate" data-id="${escapeHtml(member.id)}" ${readOnlyAttr}>Duplicate</button>
              <button class="btn soft small" type="button" data-action="${escapeHtml(quickAction)}" data-id="${escapeHtml(member.id)}" ${quickDisabled}>${escapeHtml(status === 'archived' ? 'Archived' : quickLabel)}</button>
            </div>
            <div class="member-card__action-row member-card__action-row--secondary">
              <button class="btn soft small" type="button" data-action="move-up" data-id="${escapeHtml(member.id)}" ${state.readOnly || status === 'archived' || !reorder.hasPrevious ? 'disabled' : ''}>Move up</button>
              <button class="btn soft small" type="button" data-action="move-down" data-id="${escapeHtml(member.id)}" ${state.readOnly || status === 'archived' || !reorder.hasNext ? 'disabled' : ''}>Move down</button>
              <button class="${status === 'archived' ? 'btn soft small' : 'btn danger small'}" type="button" data-action="${status === 'archived' ? 'restore' : 'archive'}" data-id="${escapeHtml(member.id)}" ${readOnlyAttr}>${status === 'archived' ? 'Restore' : 'Archive'}</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderMemberList() {
    const filtered = applyFilters();
    const total = state.members.length;
    if (total) {
      const sourceNote = state.setupRequired && !state.readOnly
        ? ' Image uploads are disabled until storage setup is finished.'
        : (state.readOnly
          ? ' This board is currently in preview mode.'
          : '');
      els.resultMeta.textContent = `Showing ${filtered.length} of ${total} team member${total === 1 ? '' : 's'}.${sourceNote}`;
    } else {
      els.resultMeta.textContent = state.setupRequired && state.readOnly
        ? 'Team is in setup preview mode until the Supabase script is applied.'
        : 'No team members loaded yet.';
    }
    renderEmptyState(filtered);
    if (!filtered.length) {
      els.memberGrid.innerHTML = '';
      return;
    }
    els.memberGrid.innerHTML = filtered.map((member, index, collection) => renderMemberCard(member, index, collection)).join('');
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
      await state.helpers.api('admin-team-image-delete', 'POST', { storageKey: currentKey });
    } catch (error) {
      console.warn('[team] transient image cleanup failed', error);
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
    const storageBlocked = state.setupRequired && !state.readOnly;
    if (draft.imageUrl) {
      els.imageFrame.classList.add('has-image');
      els.imagePreview.src = draft.imageUrl;
      els.imagePreview.alt = draft.imageAltText || draft.fullName || 'Team member image';
      els.imageMeta.textContent = storageBlocked
        ? 'This image is shown in preview, but uploads and replacements are disabled until the Team storage setup is completed.'
        : 'Image uploaded and ready for the public About page.';
    } else {
      els.imageFrame.classList.remove('has-image');
      els.imagePreview.removeAttribute('src');
      els.imagePreview.alt = '';
      els.imageMeta.textContent = storageBlocked
        ? 'Image uploads are disabled until the team-images bucket has been created in Supabase.'
        : 'JPG, PNG, WebP, or AVIF up to 6MB. Portrait crops work best for the public cards.';
    }
  }

  function requiredPublishFields(draft) {
    const missing = [];
    if (!asString(draft.fullName)) missing.push({ key: 'fullName', label: 'full name', el: els.fieldFullName });
    if (!asString(draft.roleTitle)) missing.push({ key: 'roleTitle', label: 'role title', el: els.fieldRoleTitle });
    if (!asString(draft.shortCaption)) missing.push({ key: 'shortCaption', label: 'short summary', el: els.fieldShortCaption });
    return missing;
  }

  function updatePublishHint() {
    if (!state.editor) return;
    const draft = state.editor.draft;
    const status = computeStatus(draft);
    const missing = requiredPublishFields(draft);
    let message = '';
    if (status === 'archived') {
      message = 'Archived members stay editable in admin but never render on the public About page.';
    } else if (draft.isPublished) {
      message = missing.length
        ? `This record cannot publish yet. Add ${missing.map((item) => item.label).join(', ')} first.`
        : 'This profile is ready for the public About page and will appear in display-order sequence.';
    } else {
      message = 'Draft members stay internal until you publish them.';
    }
    els.publishHint.textContent = message;
  }

  function renderPreviewCard() {
    if (!state.editor) return;
    const draft = state.editor.draft;
    const status = computeStatus(draft);
    const firstName = deriveFirstName(draft.fullName);
    const revealCopy = [draft.shortCaption, draft.fullBio]
      .map((item) => asString(item))
      .filter((item, index, list) => item && list.indexOf(item) === index);
    const imageMarkup = draft.imageUrl
      ? `<img src="${escapeHtml(draft.imageUrl)}" alt="${escapeHtml(draft.imageAltText || draft.fullName || 'Team member image')}"/>`
      : '<span>Portrait preview</span>';
    const metaMarkup = [
      `<span class="status-pill status-pill--${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`,
      `<span>Order ${escapeHtml(draft.displayOrder || 100)}</span>`,
    ].join('');
    const linkMarkup = draft.linkedinUrl
      ? `<a class="preview-team-card__link" href="${escapeHtml(draft.linkedinUrl)}" target="_blank" rel="noopener">LinkedIn profile</a>`
      : '';

    els.previewCard.innerHTML = `
      <div class="preview-team-card__media">${imageMarkup}</div>
      <div class="preview-team-card__meta">${metaMarkup}</div>
      <h3 class="preview-team-card__title">${escapeHtml(draft.fullName || 'Team member name')}</h3>
      <p class="preview-team-card__role">${escapeHtml(draft.roleTitle || 'Role title')}</p>
      <button type="button" class="preview-team-card__toggle" disabled>More about ${escapeHtml(firstName)}</button>
      <p class="preview-team-card__summary">${escapeHtml(revealCopy[0] || 'Short supporting summary appears here when the card opens.')}</p>
      ${revealCopy[1] ? `<p class="preview-team-card__bio">${escapeHtml(revealCopy[1])}</p>` : ''}
      ${linkMarkup}
    `;

    els.editorStatusPill.textContent = statusLabel(status);
    els.editorStatusPill.className = `status-pill status-pill--${status}`;
    updatePublishHint();
  }

  function syncFormFromDraft() {
    if (!state.editor) return;
    const draft = state.editor.draft;
    const status = computeStatus(draft);
    els.fieldFullName.value = draft.fullName || '';
    els.fieldSlug.value = draft.slug || '';
    els.fieldRoleTitle.value = draft.roleTitle || '';
    els.fieldDisplayOrder.value = Number.isFinite(Number(draft.displayOrder)) ? String(draft.displayOrder) : '100';
    els.fieldShortCaption.value = draft.shortCaption || '';
    els.fieldFullBio.value = draft.fullBio || '';
    els.fieldLinkedinUrl.value = draft.linkedinUrl || '';
    els.fieldPublished.checked = !!draft.isPublished;
    els.fieldImageAlt.value = draft.imageAltText || '';

    els.editorTitle.textContent = draft.id ? 'Edit team member' : 'New team member';
    els.editorMeta.textContent = draft.id
      ? `Updated ${formatDateTime(draft.updatedAt || draft.createdAt || nowIso())}`
      : 'New record';

    [
      'fieldFullName', 'fieldSlug', 'fieldRoleTitle', 'fieldDisplayOrder',
      'fieldShortCaption', 'fieldFullBio', 'fieldLinkedinUrl', 'fieldPublished',
      'fieldImageAlt', 'uploadImageBtn', 'removeImageBtn', 'saveMemberBtn',
      'publishMemberBtn', 'unpublishMemberBtn', 'archiveMemberBtn', 'duplicateMemberBtn'
        ].forEach((id) => {
      els[id].disabled = !!state.readOnly;
    });

    els.fieldPublished.disabled = !!state.readOnly || status === 'archived';
    els.publishMemberBtn.disabled = !!state.readOnly;
    els.unpublishMemberBtn.disabled = !!state.readOnly || status !== 'published';
    els.duplicateMemberBtn.disabled = !!state.readOnly || !draft.id;
    els.archiveMemberBtn.disabled = !!state.readOnly || (!draft.id && status !== 'archived');
    els.archiveMemberBtn.textContent = status === 'archived' ? 'Restore' : 'Archive';
    els.archiveMemberBtn.className = status === 'archived' ? 'btn soft' : 'btn danger';
    els.uploadImageBtn.disabled = !!state.readOnly || !!(state.setupRequired && !state.readOnly);
    els.removeImageBtn.disabled = !!state.readOnly || !!(state.setupRequired && !state.readOnly) || !draft.imageUrl;

    updateImagePreview();
    renderPreviewCard();
  }

  function readDraftFromForm() {
    const fullName = asString(els.fieldFullName.value);
    return {
      ...state.editor.draft,
      fullName,
      firstName: deriveFirstName(fullName),
      slug: asString(els.fieldSlug.value),
      roleTitle: asString(els.fieldRoleTitle.value),
      displayOrder: Math.max(0, Number.parseInt(els.fieldDisplayOrder.value || '100', 10) || 100),
      shortCaption: asString(els.fieldShortCaption.value),
      fullBio: asString(els.fieldFullBio.value),
      linkedinUrl: asString(els.fieldLinkedinUrl.value),
      isPublished: !!els.fieldPublished.checked,
      imageAltText: asString(els.fieldImageAlt.value),
    };
  }

  function openEditor(member, options = {}) {
    const duplicate = options.duplicate === true;
    const seed = member ? cloneMember(member) : cloneMember();
    const draft = duplicate
      ? cloneMember({
        ...seed,
        id: '',
        createdAt: '',
        updatedAt: '',
        publishedAt: '',
        slug: '',
        fullName: seed.fullName ? `${seed.fullName} (Copy)` : '',
        imageStorageKey: '',
        isPublished: false,
        archivedAt: '',
        status: 'draft',
      })
      : seed;

    state.editor = {
      original: duplicate ? null : (member ? cloneMember(member) : null),
      draft,
      removedImageKeys: new Set(),
      slugTouched: !!draft.slug,
    };

    syncFormFromDraft();
    setEditorOpen(true);
  }

  function findMember(id) {
    return state.members.find((member) => member.id === id) || null;
  }

  async function uploadImage(file) {
    if (!file || !state.editor || state.readOnly) return;

    els.imageMeta.textContent = 'Uploading image…';
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
    const response = await state.helpers.api('admin-team-image-upload', 'POST', {
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
      state.editor.draft.imageAltText = state.editor.draft.fullName
        ? `Portrait of ${state.editor.draft.fullName}`
        : file.name.replace(/\.[^.]+$/, '');
    }

    syncFormFromDraft();
    state.helpers.toast.ok('Image uploaded');
  }

  async function removeImage() {
    if (!state.editor) return;
    const currentKey = asString(state.editor.draft.imageStorageKey);
    const originalKey = asString(state.editor.original?.imageStorageKey);

    if (currentKey && currentKey !== originalKey) {
      await state.helpers.api('admin-team-image-delete', 'POST', { storageKey: currentKey });
    }
    if (originalKey) {
      state.editor.removedImageKeys.add(originalKey);
    }

    state.editor.draft.imageUrl = '';
    state.editor.draft.imageStorageKey = '';
    state.editor.draft.imageAltText = '';
    syncFormFromDraft();
  }

  async function loadMembers(options = {}) {
    if (state.loading && !options.force) return;
    state.loading = true;
    try {
      const response = await state.helpers.api('admin-team-list', 'POST', {});
      state.members = Array.isArray(response.members) ? response.members : [];
      state.readOnly = !!response.readOnly;
      state.setupRequired = !!response.schema;
      state.source = response.source || 'unknown';
      state.error = response.error || '';
    } catch (error) {
      state.members = [];
      state.readOnly = true;
      state.setupRequired = false;
      state.source = 'unavailable';
      state.error = error?.message || 'Unable to load team members';
      state.helpers.toast.err(state.error, 4200);
    } finally {
      state.loading = false;
      renderOverview();
      renderMemberList();
    }
  }

  function applyModeToDraft(draft, mode) {
    const next = { ...draft };
    if (mode === 'publish') {
      next.isPublished = true;
      next.archivedAt = '';
    } else if (mode === 'unpublish') {
      next.isPublished = false;
      next.archivedAt = '';
    } else if (mode === 'archive') {
      next.isPublished = false;
      next.archivedAt = nowIso();
    } else if (mode === 'restore') {
      next.archivedAt = '';
    }
    return next;
  }

  function buildSavePayload(mode) {
    let draft = readDraftFromForm();
    if (!draft.slug && draft.fullName) {
      draft.slug = createAutoSlug(draft.fullName);
      els.fieldSlug.value = draft.slug;
    }
    draft = applyModeToDraft(draft, mode);
    state.editor.draft = draft;
    return draft;
  }

  function assertCanPublish(draft) {
    const missing = requiredPublishFields(draft);
    if (!missing.length) return true;
    const message = `Add ${missing.map((item) => item.label).join(', ')} before publishing this member.`;
    state.helpers.toast.err(message, 4800);
    missing[0]?.el?.focus?.();
    return false;
  }

  async function saveMember(mode = 'save') {
    if (!state.editor || state.readOnly) return;

    const draft = buildSavePayload(mode);
    if ((mode === 'publish' || (mode === 'save' && draft.isPublished)) && !assertCanPublish(draft)) {
      syncFormFromDraft();
      return;
    }

    const originalKey = asString(state.editor.original?.imageStorageKey);
    const removedImageKeys = Array.from(state.editor.removedImageKeys);

    try {
      await state.helpers.api('admin-team-save', 'POST', {
        member: draft,
        previousImageStorageKey: originalKey && originalKey !== draft.imageStorageKey ? originalKey : '',
        removedImageKeys,
      });
      await loadMembers({ force: true });
      await closeEditor();
      const messages = {
        save: 'Team member saved',
        publish: 'Team member published',
        unpublish: 'Team member unpublished',
        archive: 'Team member archived',
        restore: 'Team member restored',
      };
      state.helpers.toast.ok(messages[mode] || 'Team member saved');
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to save team member', 4800);
    }
  }

  async function quickStateChange(id, action) {
    const member = findMember(id);
    if (!member || state.readOnly) return;
    const next = applyModeToDraft(cloneMember(member), action);

    if (action === 'publish' && !assertCanPublish(next)) {
      return;
    }

    try {
      await state.helpers.api('admin-team-save', 'POST', {
        member: next,
        previousImageStorageKey: '',
        removedImageKeys: [],
      });
      await loadMembers({ force: true });
      const messages = {
        publish: 'Team member published',
        unpublish: 'Team member unpublished',
        archive: 'Team member archived',
        restore: 'Team member restored',
      };
      state.helpers.toast.ok(messages[action] || 'Team member updated');
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to update team member', 4200);
    }
  }

  async function reorderMember(id, direction) {
    if (state.readOnly) return;
    const ordered = sortMembers(state.members).filter((member) => !member.archivedAt);
    const index = ordered.findIndex((member) => member.id === id);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;

    const current = cloneMember(ordered[index]);
    const other = cloneMember(ordered[targetIndex]);
    const currentOrder = current.displayOrder;
    current.displayOrder = other.displayOrder;
    other.displayOrder = currentOrder;

    try {
      await state.helpers.api('admin-team-save', 'POST', {
        member: current,
        previousImageStorageKey: '',
        removedImageKeys: [],
      });
      await state.helpers.api('admin-team-save', 'POST', {
        member: other,
        previousImageStorageKey: '',
        removedImageKeys: [],
      });
      await loadMembers({ force: true });
      state.helpers.toast.ok(`Moved ${current.fullName || 'member'} ${direction}`);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to reorder members', 4200);
    }
  }

  function bindEvents() {
    els.searchInput.addEventListener('input', (event) => {
      state.filters.query = asString(event.target.value);
      renderMemberList();
    });
    els.statusFilter.addEventListener('change', (event) => {
      state.filters.status = asString(event.target.value) || 'all';
      renderMemberList();
    });
    els.refreshBtn.addEventListener('click', () => loadMembers({ force: true }));
    els.newMemberBtn.addEventListener('click', () => {
      if (!state.readOnly) {
        openEditor(null);
      }
    });
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
      'fieldFullName', 'fieldSlug', 'fieldRoleTitle', 'fieldDisplayOrder',
      'fieldShortCaption', 'fieldFullBio', 'fieldLinkedinUrl', 'fieldPublished', 'fieldImageAlt'
    ].forEach((id) => {
      els[id].addEventListener('input', (event) => {
        if (!state.editor) return;
        if (event.target === els.fieldFullName) {
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

    els.archiveMemberBtn.addEventListener('click', () => {
      const status = computeStatus(state.editor?.draft);
      saveMember(status === 'archived' ? 'restore' : 'archive');
    });
    els.duplicateMemberBtn.addEventListener('click', () => {
      if (state.editor?.draft) {
        openEditor(state.editor.draft, { duplicate: true });
      }
    });
    els.unpublishMemberBtn.addEventListener('click', () => saveMember('unpublish'));
    els.publishMemberBtn.addEventListener('click', () => saveMember('publish'));
    els.saveMemberBtn.addEventListener('click', () => saveMember('save'));

    els.memberGrid.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action][data-id]');
      if (!button) return;
      const action = button.getAttribute('data-action');
      const id = button.getAttribute('data-id');
      const member = findMember(id);
      if (!member) return;

      if (action === 'edit') {
        openEditor(member);
      } else if (action === 'duplicate') {
        openEditor(member, { duplicate: true });
      } else if (action === 'publish' || action === 'unpublish' || action === 'archive' || action === 'restore') {
        quickStateChange(id, action);
      } else if (action === 'move-up') {
        reorderMember(id, 'up');
      } else if (action === 'move-down') {
        reorderMember(id, 'down');
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
      renderMemberList();
      await loadMembers({ force: true });
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
