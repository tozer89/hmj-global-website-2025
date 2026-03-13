const { slugify, toJob } = require('./_jobs-helpers.js');

const ALLOWED_STATUSES = new Set(['live', 'interviewing', 'closed']);
const ALLOWED_TYPES = new Set(['permanent', 'contract', 'fixed-term']);
const ALLOWED_TAG_MODES = new Set(['append', 'replace', 'remove']);

function cleanString(value) {
  return String(value ?? '').trim();
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalised = cleanString(value).toLowerCase();
  if (normalised === 'true') return true;
  if (normalised === 'false') return false;
  return !!value;
}

function normaliseTagValues(value) {
  const items = Array.isArray(value)
    ? value
    : cleanString(value)
      ? String(value).split(/\r?\n|,/)
      : [];
  const seen = new Set();
  const tags = [];
  items.forEach((item) => {
    const tag = cleanString(item);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function applyTagOperation(existing, operation = {}) {
  const current = normaliseTagValues(existing);
  const mode = ALLOWED_TAG_MODES.has(cleanString(operation.mode).toLowerCase())
    ? cleanString(operation.mode).toLowerCase()
    : 'replace';
  const values = normaliseTagValues(operation.values);
  const currentMap = new Map(current.map((tag) => [tag.toLowerCase(), tag]));

  if (mode === 'append') {
    values.forEach((tag) => {
      const key = tag.toLowerCase();
      if (!currentMap.has(key)) {
        currentMap.set(key, tag);
      }
    });
    return Array.from(currentMap.values());
  }

  if (mode === 'remove') {
    values.forEach((tag) => currentMap.delete(tag.toLowerCase()));
    return Array.from(currentMap.values());
  }

  return values;
}

function sanitiseBulkEdits(input = {}) {
  const edits = input && typeof input === 'object' ? input : {};
  const next = {};

  if (Object.prototype.hasOwnProperty.call(edits, 'status')) {
    const status = cleanString(edits.status).toLowerCase();
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error('Bulk edit requires a valid status');
    }
    next.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'published')) {
    next.published = toBoolean(edits.published);
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'section')) {
    const section = cleanString(edits.section);
    if (!section) {
      throw new Error('Bulk edit requires a category heading when section is enabled');
    }
    next.section = section;
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'discipline')) {
    next.discipline = cleanString(edits.discipline);
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'type')) {
    const type = cleanString(edits.type).toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error('Bulk edit requires a valid employment type');
    }
    next.type = type;
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'clientName')) {
    next.clientName = cleanString(edits.clientName);
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'customer')) {
    next.customer = cleanString(edits.customer);
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'locationText')) {
    next.locationText = cleanString(edits.locationText);
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'locationCode')) {
    next.locationCode = cleanString(edits.locationCode);
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'sortOrder')) {
    if (edits.sortOrder === null || edits.sortOrder === '') {
      next.sortOrder = null;
    } else {
      const parsed = Number(edits.sortOrder);
      if (!Number.isFinite(parsed)) {
        throw new Error('Bulk edit requires a valid sort weight');
      }
      next.sortOrder = parsed;
    }
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'tags')) {
    const rawTags = edits.tags && typeof edits.tags === 'object' && !Array.isArray(edits.tags)
      ? edits.tags
      : { mode: 'replace', values: edits.tags };
    const mode = ALLOWED_TAG_MODES.has(cleanString(rawTags.mode).toLowerCase())
      ? cleanString(rawTags.mode).toLowerCase()
      : 'replace';
    const values = normaliseTagValues(rawTags.values);
    if ((mode === 'append' || mode === 'remove') && !values.length) {
      throw new Error('Bulk tag updates need at least one tag when using append or remove');
    }
    next.tags = { mode, values };
  }

  return next;
}

function applyBulkEditsToJob(job, edits = {}) {
  const next = { ...toJob(job) };

  if (Object.prototype.hasOwnProperty.call(edits, 'status')) {
    next.status = edits.status;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'published')) {
    next.published = edits.published;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'section')) {
    next.section = edits.section;
    next.sectionLabel = edits.section;
    next.sectionKey = slugify(edits.section) || 'general';
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'discipline')) {
    next.discipline = edits.discipline;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'type')) {
    next.type = edits.type;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'clientName')) {
    next.clientName = edits.clientName;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'customer')) {
    next.customer = edits.customer;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'locationText')) {
    next.locationText = edits.locationText;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'locationCode')) {
    next.locationCode = edits.locationCode;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'sortOrder')) {
    next.sortOrder = edits.sortOrder;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'tags')) {
    const tags = applyTagOperation(next.tags, edits.tags);
    next.tags = tags;
    next.keywords = tags.join(', ');
  }

  return next;
}

function createDuplicateTitle(title, existingTitles = new Set()) {
  const nextTitles = existingTitles;
  const base = cleanString(title) || 'Untitled job';
  let candidate = `${base} (Copy)`;
  let suffix = 2;
  while (nextTitles.has(candidate.toLowerCase())) {
    candidate = `${base} (Copy ${suffix++})`;
  }
  nextTitles.add(candidate.toLowerCase());
  return candidate;
}

function createDuplicateId(source, existingIds = new Set()) {
  const nextIds = existingIds;
  const base = slugify(`${cleanString(source) || 'job'}-copy`) || `job-copy-${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  while (nextIds.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix++}`;
  }
  nextIds.add(candidate.toLowerCase());
  return candidate;
}

function createDuplicateJob(job, registries = {}) {
  const source = toJob(job);
  const ids = registries.ids || new Set();
  const titles = registries.titles || new Set();
  const duplicate = { ...source };
  duplicate.title = createDuplicateTitle(source.title, titles);
  duplicate.id = createDuplicateId(source.id || source.title || duplicate.title, ids);
  duplicate.published = false;
  duplicate.createdAt = null;
  duplicate.updatedAt = null;
  return duplicate;
}

module.exports = {
  ALLOWED_STATUSES,
  ALLOWED_TYPES,
  ALLOWED_TAG_MODES,
  normaliseTagValues,
  applyTagOperation,
  sanitiseBulkEdits,
  applyBulkEditsToJob,
  createDuplicateTitle,
  createDuplicateId,
  createDuplicateJob,
};
