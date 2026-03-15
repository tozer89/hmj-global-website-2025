const { slugify, toJob } = require('./_jobs-helpers.js');

const ALLOWED_STATUSES = new Set(['live', 'interviewing', 'closed']);
const ALLOWED_TYPES = new Set(['permanent', 'contract', 'fixed-term']);
const ALLOWED_PAY_TYPES = new Set(['day_rate', 'salary_range', 'hourly_range', 'competitive', 'negotiable']);
const ALLOWED_TAG_MODES = new Set(['append', 'replace', 'remove', 'clear']);
const ALLOWED_LIST_MODES = new Set(['append', 'replace', 'remove', 'clear']);
const ALLOWED_TEXT_MODES = new Set(['replace', 'clear']);
const ALLOWED_LONG_TEXT_MODES = new Set(['replace', 'prepend', 'append', 'clear']);

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

function toNullableNumber(value, label = 'value') {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`Bulk edit requires a valid ${label}`);
  }
  return parsed;
}

function normaliseListValues(value) {
  const items = Array.isArray(value)
    ? value
    : cleanString(value)
      ? String(value).split(/\r?\n|\u2022|,/)
      : [];
  const seen = new Set();
  const list = [];
  items.forEach((item) => {
    const entry = cleanString(item).replace(/^[-*•\s]+/, '').trim();
    if (!entry) return;
    const key = entry.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(entry);
  });
  return list;
}

function normaliseTagValues(value) {
  return normaliseListValues(value);
}

function applyListOperation(existing, operation = {}) {
  const current = normaliseListValues(existing);
  const mode = ALLOWED_LIST_MODES.has(cleanString(operation.mode).toLowerCase())
    ? cleanString(operation.mode).toLowerCase()
    : 'replace';
  const values = normaliseListValues(operation.values);
  const currentMap = new Map(current.map((item) => [item.toLowerCase(), item]));

  if (mode === 'clear') {
    return [];
  }

  if (mode === 'append') {
    values.forEach((item) => {
      const key = item.toLowerCase();
      if (!currentMap.has(key)) {
        currentMap.set(key, item);
      }
    });
    return Array.from(currentMap.values());
  }

  if (mode === 'remove') {
    values.forEach((item) => currentMap.delete(item.toLowerCase()));
    return Array.from(currentMap.values());
  }

  return values;
}

function applyTagOperation(existing, operation = {}) {
  return applyListOperation(existing, operation);
}

function normaliseTextOperation(input, options = {}) {
  const {
    label = 'field',
    allowedModes = ALLOWED_TEXT_MODES,
  } = options;

  const payload = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : { mode: 'replace', value: input };
  const rawMode = cleanString(payload.mode).toLowerCase() || 'replace';
  const mode = allowedModes.has(rawMode) ? rawMode : null;
  if (!mode) {
    throw new Error(`Bulk edit requires a valid ${label} action`);
  }
  if (mode === 'clear') {
    return { mode: 'clear', value: '' };
  }

  const value = cleanString(payload.value);
  if (!value) {
    throw new Error(`Bulk edit requires a ${label} value`);
  }
  return { mode, value };
}

function normaliseListOperation(input, options = {}) {
  const { label = 'list', allowedModes = ALLOWED_LIST_MODES } = options;
  const payload = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : { mode: 'replace', values: input };
  const rawMode = cleanString(payload.mode).toLowerCase() || 'replace';
  const mode = allowedModes.has(rawMode) ? rawMode : null;
  if (!mode) {
    throw new Error(`Bulk edit requires a valid ${label} action`);
  }

  if (mode === 'clear') {
    return { mode: 'clear', values: [] };
  }

  const values = normaliseListValues(payload.values);
  if ((mode === 'append' || mode === 'remove') && !values.length) {
    throw new Error(`Bulk ${label} updates need at least one value when using ${mode}`);
  }
  if (mode === 'replace' && !values.length) {
    return { mode: 'clear', values: [] };
  }
  return { mode, values };
}

function normalisePayOperation(input) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const rawMode = cleanString(payload.mode).toLowerCase() || 'replace';
  if (!['replace', 'clear'].includes(rawMode)) {
    throw new Error('Bulk pay updates require a valid action');
  }
  if (rawMode === 'clear') {
    return { mode: 'clear' };
  }

  const payType = cleanString(payload.payType).toLowerCase();
  if (!ALLOWED_PAY_TYPES.has(payType)) {
    throw new Error('Bulk pay updates require a valid pay display');
  }

  const next = {
    mode: 'replace',
    payType,
    currency: cleanString(payload.currency).toUpperCase() || null,
    dayRateMin: null,
    dayRateMax: null,
    salaryMin: null,
    salaryMax: null,
    hourlyMin: null,
    hourlyMax: null,
  };

  if (payType === 'day_rate') {
    next.dayRateMin = toNullableNumber(payload.dayRateMin, 'day rate min');
    next.dayRateMax = toNullableNumber(payload.dayRateMax, 'day rate max');
  } else if (payType === 'salary_range') {
    next.salaryMin = toNullableNumber(payload.salaryMin, 'salary min');
    next.salaryMax = toNullableNumber(payload.salaryMax, 'salary max');
  } else if (payType === 'hourly_range') {
    next.hourlyMin = toNullableNumber(payload.hourlyMin, 'hourly min');
    next.hourlyMax = toNullableNumber(payload.hourlyMax, 'hourly max');
  }

  if (/_range$/.test(payType) || payType === 'day_rate') {
    next.currency = next.currency || 'GBP';
  }

  return next;
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

  if (Object.prototype.hasOwnProperty.call(edits, 'type')) {
    const type = cleanString(edits.type).toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error('Bulk edit requires a valid employment type');
    }
    next.type = type;
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'discipline')) {
    next.discipline = normaliseTextOperation(edits.discipline, { label: 'discipline' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'clientName')) {
    next.clientName = normaliseTextOperation(edits.clientName, { label: 'client name' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'customer')) {
    next.customer = normaliseTextOperation(edits.customer, { label: 'customer' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'locationText')) {
    next.locationText = normaliseTextOperation(edits.locationText, { label: 'location' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'locationCode')) {
    next.locationCode = normaliseTextOperation(edits.locationCode, { label: 'location code' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'applyUrl')) {
    next.applyUrl = normaliseTextOperation(edits.applyUrl, { label: 'apply URL' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'overview')) {
    next.overview = normaliseTextOperation(edits.overview, {
      label: 'overview',
      allowedModes: ALLOWED_LONG_TEXT_MODES,
    });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'sortOrder')) {
    if (edits.sortOrder === null || edits.sortOrder === '') {
      next.sortOrder = null;
    } else {
      next.sortOrder = toNullableNumber(edits.sortOrder, 'sort weight');
    }
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'tags')) {
    next.tags = normaliseListOperation(edits.tags, { label: 'tag' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'benefits')) {
    next.benefits = normaliseListOperation(edits.benefits, { label: 'benefit' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'responsibilities')) {
    next.responsibilities = normaliseListOperation(edits.responsibilities, { label: 'responsibility' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'requirements')) {
    next.requirements = normaliseListOperation(edits.requirements, { label: 'requirement' });
  }

  if (Object.prototype.hasOwnProperty.call(edits, 'pay')) {
    next.pay = normalisePayOperation(edits.pay);
  }

  return next;
}

function applyTextOperation(currentValue, operation = {}, options = {}) {
  const input = operation && typeof operation === 'object' && !Array.isArray(operation)
    ? operation
    : { mode: 'replace', value: operation };
  const value = cleanString(currentValue);
  const nextValue = cleanString(input.value);
  const joiner = options.joiner || '\n\n';

  if (input.mode === 'clear') {
    return '';
  }
  if (input.mode === 'prepend') {
    return [nextValue, value].filter(Boolean).join(joiner).trim();
  }
  if (input.mode === 'append') {
    return [value, nextValue].filter(Boolean).join(joiner).trim();
  }
  return nextValue;
}

function applyPayOperation(next, operation = {}) {
  if (operation.mode === 'clear') {
    next.payType = '';
    next.currency = '';
    next.dayRateMin = null;
    next.dayRateMax = null;
    next.salaryMin = null;
    next.salaryMax = null;
    next.hourlyMin = null;
    next.hourlyMax = null;
    next.payText = '';
    return next;
  }

  next.payType = operation.payType;
  next.currency = operation.currency || '';
  next.dayRateMin = operation.dayRateMin;
  next.dayRateMax = operation.dayRateMax;
  next.salaryMin = operation.salaryMin;
  next.salaryMax = operation.salaryMax;
  next.hourlyMin = operation.hourlyMin;
  next.hourlyMax = operation.hourlyMax;
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
    next.discipline = applyTextOperation(next.discipline, edits.discipline);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'type')) {
    next.type = edits.type;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'clientName')) {
    next.clientName = applyTextOperation(next.clientName, edits.clientName);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'customer')) {
    next.customer = applyTextOperation(next.customer, edits.customer);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'locationText')) {
    next.locationText = applyTextOperation(next.locationText, edits.locationText);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'locationCode')) {
    next.locationCode = applyTextOperation(next.locationCode, edits.locationCode);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'applyUrl')) {
    next.applyUrl = applyTextOperation(next.applyUrl, edits.applyUrl);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'overview')) {
    next.overview = applyTextOperation(next.overview, edits.overview, { joiner: '\n\n' });
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'sortOrder')) {
    next.sortOrder = edits.sortOrder;
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'tags')) {
    const tags = applyTagOperation(next.tags, edits.tags);
    next.tags = tags;
    next.keywords = tags.join(', ');
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'benefits')) {
    next.benefits = applyListOperation(next.benefits, edits.benefits);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'responsibilities')) {
    next.responsibilities = applyListOperation(next.responsibilities, edits.responsibilities);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'requirements')) {
    next.requirements = applyListOperation(next.requirements, edits.requirements);
  }
  if (Object.prototype.hasOwnProperty.call(edits, 'pay')) {
    applyPayOperation(next, edits.pay);
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
  ALLOWED_PAY_TYPES,
  ALLOWED_TAG_MODES,
  ALLOWED_LIST_MODES,
  normaliseTagValues,
  normaliseListValues,
  applyListOperation,
  applyTagOperation,
  sanitiseBulkEdits,
  applyBulkEditsToJob,
  createDuplicateTitle,
  createDuplicateId,
  createDuplicateJob,
};
