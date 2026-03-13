const { randomUUID } = require('node:crypto');
const { slugify, isMissingTableError } = require('./_jobs-helpers.js');

const NOTICEBOARD_TABLE = 'noticeboard_posts';
const NOTICEBOARD_BUCKET = 'noticeboard-images';
const DEFAULT_SORT_ORDER = 100;
const MAX_SLUG_LENGTH = 80;

const STATUS_SET = new Set(['draft', 'scheduled', 'published', 'archived']);
const PUBLIC_STATUS_SET = new Set(['scheduled', 'published']);

function asString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNullableString(value) {
  const stringValue = asString(value);
  return stringValue || null;
}

function asBoolean(value) {
  if (typeof value === 'string') {
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
  return !!value;
}

function asInteger(value, fallback = DEFAULT_SORT_ORDER) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestampToMillis(value) {
  const iso = toIsoTimestamp(value);
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'en-GB', { sensitivity: 'base' });
}

function compareNullableAsc(a, b, fallback = 0) {
  const left = a === null || a === undefined;
  const right = b === null || b === undefined;
  if (left && right) return fallback;
  if (left) return 1;
  if (right) return -1;
  return a < b ? -1 : a > b ? 1 : fallback;
}

function compareNullableDesc(a, b, fallback = 0) {
  const left = a === null || a === undefined;
  const right = b === null || b === undefined;
  if (left && right) return fallback;
  if (left) return 1;
  if (right) return -1;
  return a > b ? -1 : a < b ? 1 : fallback;
}

function deriveExcerpt(value, maxLength = 190) {
  const text = asString(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sanitiseUrl(value) {
  const raw = asString(value);
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  if (raw.startsWith('#')) return raw;
  try {
    const url = new URL(raw);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      return url.toString();
    }
  } catch {}
  return null;
}

function normaliseStatus(value) {
  const raw = asString(value).toLowerCase();
  return STATUS_SET.has(raw) ? raw : 'draft';
}

function normaliseSlug(value, title, fallbackPrefix = 'notice') {
  const base = slugify(asString(value) || asString(title)) || `${fallbackPrefix}-${Date.now()}`;
  return base.slice(0, MAX_SLUG_LENGTH);
}

function validationError(message) {
  const error = new Error(message);
  error.code = 400;
  return error;
}

function computeEffectiveStatus(row = {}, now = new Date()) {
  const status = normaliseStatus(row.status);
  const publishAt = timestampToMillis(row.publish_at || row.publishAt);
  const expiresAt = timestampToMillis(row.expires_at || row.expiresAt);
  const nowMs = timestampToMillis(now) || Date.now();

  if (expiresAt !== null && expiresAt <= nowMs) return 'archived';
  if (status === 'archived') return 'archived';
  if (status === 'draft') return 'draft';
  if (publishAt !== null && publishAt > nowMs) return 'scheduled';
  return 'published';
}

function isPubliclyVisible(row = {}, now = new Date()) {
  const status = normaliseStatus(row.status);
  if (!PUBLIC_STATUS_SET.has(status)) return false;

  const publishAt = timestampToMillis(row.publish_at || row.publishAt);
  const expiresAt = timestampToMillis(row.expires_at || row.expiresAt);
  const nowMs = timestampToMillis(now) || Date.now();

  if (publishAt !== null && publishAt > nowMs) return false;
  if (expiresAt !== null && expiresAt <= nowMs) return false;
  return true;
}

function resolveStatusAndSchedule(input = {}, now = new Date()) {
  let status = normaliseStatus(input.status);
  let publishAt = toIsoTimestamp(input.publish_at || input.publishAt);
  const expiresAt = toIsoTimestamp(input.expires_at || input.expiresAt);
  const nowMs = timestampToMillis(now) || Date.now();
  const publishMs = timestampToMillis(publishAt);
  const expiresMs = timestampToMillis(expiresAt);

  if (status === 'scheduled' && !publishAt) {
    throw validationError('Scheduled notices require a publish date and time.');
  }

  if (status === 'published' && publishMs !== null && publishMs > nowMs) {
    status = 'scheduled';
  }

  if (status === 'published' && !publishAt) {
    publishAt = toIsoTimestamp(now);
  }

  if (expiresMs !== null && publishMs !== null && expiresMs <= publishMs) {
    throw validationError('Expiry must be later than the publish date.');
  }

  return { status, publishAt, expiresAt };
}

function toDbPayload(input = {}, { now = new Date(), user } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Notice payload is required.');
  }

  const title = asString(input.title);
  const body = asString(input.body);

  if (!title) throw validationError('Title is required.');
  if (!body) throw validationError('Body content is required.');

  const { status, publishAt, expiresAt } = resolveStatusAndSchedule(input, now);
  const ctaUrl = sanitiseUrl(input.cta_url || input.ctaUrl);
  const summary = asString(input.summary) || deriveExcerpt(body);

  return {
    id: asNullableString(input.id),
    title,
    slug: normaliseSlug(input.slug, title),
    summary,
    body,
    image_url: asNullableString(input.image_url || input.imageUrl),
    image_storage_key: asNullableString(input.image_storage_key || input.imageStorageKey),
    image_alt_text: asNullableString(input.image_alt_text || input.imageAltText),
    status,
    publish_at: publishAt,
    expires_at: expiresAt,
    featured: asBoolean(input.featured),
    sort_order: asInteger(input.sort_order ?? input.sortOrder, DEFAULT_SORT_ORDER),
    cta_label: ctaUrl ? (asString(input.cta_label || input.ctaLabel) || 'Read more') : null,
    cta_url: ctaUrl,
    updated_at: toIsoTimestamp(now),
    updated_by_email: asNullableString(user?.email || input.updated_by_email || input.updatedByEmail),
  };
}

function toNotice(row = {}, options = {}) {
  const effectiveStatus = computeEffectiveStatus(row);
  const imageAltText = asString(row.image_alt_text || row.imageAltText);

  const notice = {
    id: asString(row.id),
    createdAt: toIsoTimestamp(row.created_at || row.createdAt),
    updatedAt: toIsoTimestamp(row.updated_at || row.updatedAt),
    title: asString(row.title),
    slug: asString(row.slug),
    summary: asString(row.summary) || deriveExcerpt(row.body),
    body: asString(row.body),
    imageUrl: asNullableString(row.image_url || row.imageUrl),
    imageStorageKey: asNullableString(row.image_storage_key || row.imageStorageKey),
    imageAltText: imageAltText || asString(row.title),
    status: normaliseStatus(row.status),
    effectiveStatus,
    publishAt: toIsoTimestamp(row.publish_at || row.publishAt),
    expiresAt: toIsoTimestamp(row.expires_at || row.expiresAt),
    featured: asBoolean(row.featured),
    sortOrder: asInteger(row.sort_order ?? row.sortOrder, DEFAULT_SORT_ORDER),
    ctaLabel: asNullableString(row.cta_label || row.ctaLabel),
    ctaUrl: sanitiseUrl(row.cta_url || row.ctaUrl),
    createdBy: asNullableString(row.created_by || row.createdBy),
    createdByEmail: asNullableString(row.created_by_email || row.createdByEmail),
    updatedByEmail: asNullableString(row.updated_by_email || row.updatedByEmail),
    isVisible: isPubliclyVisible(row),
  };

  if (options.public) {
    return {
      id: notice.id,
      slug: notice.slug,
      title: notice.title,
      summary: notice.summary,
      body: notice.body,
      imageUrl: notice.imageUrl,
      imageAltText: notice.imageAltText,
      publishAt: notice.publishAt,
      expiresAt: notice.expiresAt,
      featured: notice.featured,
      ctaLabel: notice.ctaLabel,
      ctaUrl: notice.ctaUrl,
    };
  }

  return notice;
}

function toPublicNotice(row = {}) {
  if (!isPubliclyVisible(row)) return null;
  return toNotice(row, { public: true });
}

function compareNoticeRecords(left, right) {
  const featuredDiff = Number(asBoolean(right.featured)) - Number(asBoolean(left.featured));
  if (featuredDiff) return featuredDiff;

  const sortDiff = compareNullableAsc(
    asInteger(left.sortOrder ?? left.sort_order, DEFAULT_SORT_ORDER),
    asInteger(right.sortOrder ?? right.sort_order, DEFAULT_SORT_ORDER)
  );
  if (sortDiff) return sortDiff;

  const publishDiff = compareNullableDesc(
    timestampToMillis(left.publishAt || left.publish_at || left.createdAt || left.created_at),
    timestampToMillis(right.publishAt || right.publish_at || right.createdAt || right.created_at)
  );
  if (publishDiff) return publishDiff;

  const updateDiff = compareNullableDesc(
    timestampToMillis(left.updatedAt || left.updated_at),
    timestampToMillis(right.updatedAt || right.updated_at)
  );
  if (updateDiff) return updateDiff;

  return compareText(left.title, right.title);
}

function sortNoticeCollection(items = []) {
  return items.slice().sort(compareNoticeRecords);
}

async function ensureUniqueSlug(supabase, desiredSlug, currentId) {
  const baseSlug = normaliseSlug(desiredSlug, '', `notice-${randomUUID().slice(0, 8)}`);
  let candidate = baseSlug;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data, error } = await supabase
      .from(NOTICEBOARD_TABLE)
      .select('id')
      .eq('slug', candidate)
      .limit(5);

    if (error) throw error;

    const conflict = Array.isArray(data)
      && data.some((row) => asString(row.id) && asString(row.id) !== asString(currentId));

    if (!conflict) {
      return candidate;
    }

    const suffix = `-${attempt + 2}`;
    candidate = `${baseSlug.slice(0, Math.max(1, MAX_SLUG_LENGTH - suffix.length))}${suffix}`;
  }

  throw validationError('Unable to generate a unique slug for this notice.');
}

module.exports = {
  NOTICEBOARD_TABLE,
  NOTICEBOARD_BUCKET,
  DEFAULT_SORT_ORDER,
  STATUS_SET,
  asString,
  asNullableString,
  asBoolean,
  asInteger,
  toIsoTimestamp,
  deriveExcerpt,
  sanitiseUrl,
  normaliseStatus,
  normaliseSlug,
  validationError,
  computeEffectiveStatus,
  isPubliclyVisible,
  toDbPayload,
  toNotice,
  toPublicNotice,
  sortNoticeCollection,
  ensureUniqueSlug,
  isMissingTableError,
};
