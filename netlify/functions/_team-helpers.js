const { randomUUID } = require('node:crypto');
const { slugify, isMissingTableError } = require('./_jobs-helpers.js');

const TEAM_TABLE = 'team_members';
const TEAM_BUCKET = 'team-images';
const DEFAULT_DISPLAY_ORDER = 100;
const MAX_SLUG_LENGTH = 80;
const TEAM_SEED = require('./_data/team.seed.json');

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

function asInteger(value, fallback = DEFAULT_DISPLAY_ORDER) {
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

function normaliseSlug(value, fullName, fallbackPrefix = 'team') {
  const base = slugify(asString(value) || asString(fullName)) || `${fallbackPrefix}-${Date.now()}`;
  return base.slice(0, MAX_SLUG_LENGTH);
}

function deriveFirstName(fullName) {
  const parts = asString(fullName).split(/\s+/).filter(Boolean);
  return parts[0] || 'HMJ';
}

function validationError(message) {
  const error = new Error(message);
  error.code = 400;
  return error;
}

function computeStatus(row = {}) {
  if (row.archived_at || row.archivedAt) return 'archived';
  return asBoolean(row.is_published ?? row.isPublished) ? 'published' : 'draft';
}

function isPubliclyVisible(row = {}) {
  return computeStatus(row) === 'published'
    && !!asString(row.full_name || row.fullName)
    && !!asString(row.role_title || row.roleTitle)
    && !!asString(row.short_caption || row.shortCaption);
}

function getDefaultImageAlt(fullName) {
  const name = asString(fullName);
  return name ? `Portrait of ${name}` : 'HMJ team member';
}

function toDbPayload(input = {}, { now = new Date(), user } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Team member payload is required.');
  }

  const fullName = asString(input.full_name || input.fullName);
  const roleTitle = asString(input.role_title || input.roleTitle);
  const shortCaption = asString(input.short_caption || input.shortCaption);
  const fullBio = asString(input.full_bio || input.fullBio);
  const archivedAt = toIsoTimestamp(input.archived_at || input.archivedAt);
  const isPublished = archivedAt ? false : asBoolean(input.is_published ?? input.isPublished);
  const existingPublishedAt = toIsoTimestamp(input.published_at || input.publishedAt);
  const publishedAt = isPublished
    ? (existingPublishedAt || toIsoTimestamp(now))
    : existingPublishedAt;
  const imageUrl = asNullableString(input.image_url || input.imageUrl);
  const imageAltText = asNullableString(input.image_alt_text || input.imageAltText)
    || (imageUrl ? getDefaultImageAlt(fullName) : null);
  const linkedinUrl = sanitiseUrl(input.linkedin_url || input.linkedinUrl);
  const email = asNullableString(input.email);

  if (isPublished) {
    if (!fullName) throw validationError('Full name is required before publishing.');
    if (!roleTitle) throw validationError('Role title is required before publishing.');
    if (!shortCaption) throw validationError('Short summary is required before publishing.');
  }

  return {
    id: asNullableString(input.id),
    full_name: fullName,
    slug: normaliseSlug(input.slug, fullName, `team-${randomUUID().slice(0, 8)}`),
    role_title: roleTitle,
    short_caption: shortCaption,
    full_bio: fullBio,
    image_url: imageUrl,
    image_storage_key: asNullableString(input.image_storage_key || input.imageStorageKey),
    image_alt_text: imageAltText,
    linkedin_url: linkedinUrl,
    email,
    display_order: Math.max(0, asInteger(input.display_order ?? input.displayOrder, DEFAULT_DISPLAY_ORDER)),
    is_published: isPublished,
    published_at: publishedAt,
    archived_at: archivedAt,
    updated_at: toIsoTimestamp(now),
    updated_by_email: asNullableString(user?.email || input.updated_by_email || input.updatedByEmail),
  };
}

function toTeamMember(row = {}, options = {}) {
  const fullName = asString(row.full_name || row.fullName);
  const imageUrl = asNullableString(row.image_url || row.imageUrl);
  const member = {
    id: asString(row.id),
    createdAt: toIsoTimestamp(row.created_at || row.createdAt),
    updatedAt: toIsoTimestamp(row.updated_at || row.updatedAt),
    fullName,
    firstName: deriveFirstName(fullName),
    slug: asString(row.slug),
    roleTitle: asString(row.role_title || row.roleTitle),
    shortCaption: asString(row.short_caption || row.shortCaption),
    fullBio: asString(row.full_bio || row.fullBio),
    imageUrl,
    imageStorageKey: asNullableString(row.image_storage_key || row.imageStorageKey),
    imageAltText: asString(row.image_alt_text || row.imageAltText) || (imageUrl ? getDefaultImageAlt(fullName) : ''),
    linkedinUrl: sanitiseUrl(row.linkedin_url || row.linkedinUrl),
    email: asNullableString(row.email),
    displayOrder: Math.max(0, asInteger(row.display_order ?? row.displayOrder, DEFAULT_DISPLAY_ORDER)),
    isPublished: asBoolean(row.is_published ?? row.isPublished),
    publishedAt: toIsoTimestamp(row.published_at || row.publishedAt),
    archivedAt: toIsoTimestamp(row.archived_at || row.archivedAt),
    createdBy: asNullableString(row.created_by || row.createdBy),
    createdByEmail: asNullableString(row.created_by_email || row.createdByEmail),
    updatedByEmail: asNullableString(row.updated_by_email || row.updatedByEmail),
    status: computeStatus(row),
    isVisible: isPubliclyVisible(row),
  };

  if (options.public) {
    return {
      id: member.id,
      slug: member.slug,
      fullName: member.fullName,
      firstName: member.firstName,
      roleTitle: member.roleTitle,
      shortCaption: member.shortCaption,
      fullBio: member.fullBio,
      imageUrl: member.imageUrl,
      imageAltText: member.imageAltText || getDefaultImageAlt(member.fullName),
      linkedinUrl: member.linkedinUrl,
      displayOrder: member.displayOrder,
      publishedAt: member.publishedAt,
    };
  }

  return member;
}

function toPublicTeamMember(row = {}) {
  if (!isPubliclyVisible(row)) return null;
  return toTeamMember(row, { public: true });
}

function compareTeamRecords(left, right) {
  const leftStatus = computeStatus(left);
  const rightStatus = computeStatus(right);
  const leftArchived = leftStatus === 'archived';
  const rightArchived = rightStatus === 'archived';
  if (leftArchived !== rightArchived) {
    return Number(leftArchived) - Number(rightArchived);
  }

  const orderDiff = compareNullableAsc(
    asInteger(left.displayOrder ?? left.display_order, DEFAULT_DISPLAY_ORDER),
    asInteger(right.displayOrder ?? right.display_order, DEFAULT_DISPLAY_ORDER)
  );
  if (orderDiff) return orderDiff;

  const createdDiff = compareNullableAsc(
    timestampToMillis(left.createdAt || left.created_at),
    timestampToMillis(right.createdAt || right.created_at)
  );
  if (createdDiff) return createdDiff;

  const updatedDiff = compareNullableDesc(
    timestampToMillis(left.updatedAt || left.updated_at),
    timestampToMillis(right.updatedAt || right.updated_at)
  );
  if (updatedDiff) return updatedDiff;

  return compareText(left.fullName || left.full_name, right.fullName || right.full_name);
}

function sortTeamCollection(items = []) {
  return items.slice().sort(compareTeamRecords);
}

async function ensureUniqueSlug(supabase, desiredSlug, currentId) {
  const baseSlug = normaliseSlug(desiredSlug, '', `team-${randomUUID().slice(0, 8)}`);
  let candidate = baseSlug;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data, error } = await supabase
      .from(TEAM_TABLE)
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

  throw validationError('Unable to generate a unique slug for this team member.');
}

function getTeamSeedMembers() {
  return Array.isArray(TEAM_SEED)
    ? TEAM_SEED.map((member) => JSON.parse(JSON.stringify(member)))
    : [];
}

module.exports = {
  TEAM_TABLE,
  TEAM_BUCKET,
  DEFAULT_DISPLAY_ORDER,
  asString,
  asNullableString,
  asBoolean,
  asInteger,
  toIsoTimestamp,
  sanitiseUrl,
  normaliseSlug,
  deriveFirstName,
  validationError,
  computeStatus,
  isPubliclyVisible,
  toDbPayload,
  toTeamMember,
  toPublicTeamMember,
  sortTeamCollection,
  ensureUniqueSlug,
  getTeamSeedMembers,
  isMissingTableError,
};
