// netlify/functions/_jobs-helpers.js
const SECTION_PRESETS = new Map([
  ['commercial', 'Commercial'],
  ['dc', 'Data Centre Delivery'],
  ['data-centre-delivery', 'Data Centre Delivery'],
  ['substations', 'Substations & Energy'],
  ['substations-energy', 'Substations & Energy'],
  ['pharma', 'Life Sciences & Pharma'],
  ['life-sciences', 'Life Sciences & Pharma'],
  ['ict', 'ICT & Commissioning'],
  ['ict-commissioning', 'ICT & Commissioning'],
]);

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function startCase(value = '') {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function resolveSection(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    return { key: 'general', label: 'General' };
  }
  const preset = SECTION_PRESETS.get(input.toLowerCase());
  if (preset) {
    return { key: slugify(input) || input.toLowerCase(), label: preset };
  }
  const key = slugify(input) || input.toLowerCase() || 'general';
  const label = startCase(input) || 'General';
  return { key, label };
}

function cleanArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|\u2022|,/) // support bullets and comma lists
      .map((v) => v.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function asString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseTags(row = {}) {
  if (Array.isArray(row.tags)) {
    return row.tags.map((v) => asString(v)).filter(Boolean);
  }
  if (Array.isArray(row.keywords)) {
    return row.keywords.map((v) => asString(v)).filter(Boolean);
  }
  return cleanArray(row.keywords || row.tags || '');
}

function tagsToString(tags) {
  if (!tags) return '';
  if (Array.isArray(tags)) return tags.map((v) => asString(v)).filter(Boolean).join(', ');
  return asString(tags);
}

function toJob(row = {}) {
  const sectionInfo = resolveSection(row.section);
  return {
    id: asString(row.id),
    title: asString(row.title),
    status: asString(row.status) || 'live',
    section: asString(row.section) || sectionInfo.label,
    sectionLabel: sectionInfo.label,
    sectionKey: sectionInfo.key,
    discipline: asString(row.discipline),
    type: asString(row.type) || 'permanent',
    locationText: asString(row.location_text || row.locationText),
    locationCode: asString(row.location_code || row.locationCode),
    overview: asString(row.overview),
    responsibilities: cleanArray(row.responsibilities),
    requirements: cleanArray(row.requirements),
    keywords: asString(row.keywords),
    tags: parseTags(row),
    applyUrl: asString(row.apply_url || row.applyUrl),
    published: !!row.published,
    sortOrder: Number.isFinite(row.sort_order)
      ? Number(row.sort_order)
      : Number.isFinite(row.sortOrder)
        ? Number(row.sortOrder)
        : null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function toDbPayload(job = {}) {
  const j = toJob(job);
  const sectionSource = job.sectionLabel || job.section || job.sectionKey || j.sectionLabel;
  const tags = Array.isArray(job.tags) ? job.tags : j.tags;
  return {
    id: asString(j.id),
    title: asString(j.title),
    status: asString(j.status) || 'live',
    section: asString(sectionSource) || 'General',
    discipline: asString(j.discipline),
    type: asString(j.type) || 'permanent',
    location_text: asString(j.locationText),
    location_code: asString(j.locationCode),
    overview: asString(j.overview),
    responsibilities: cleanArray(job.responsibilities || job.responsibilitiesText || j.responsibilities),
    requirements: cleanArray(job.requirements || job.requirementsText || j.requirements),
    keywords: tagsToString(job.keywords || tags || j.keywords),
    apply_url: asString(j.applyUrl),
    published: !!job.published,
    sort_order: Number.isFinite(job.sortOrder)
      ? Number(job.sortOrder)
      : Number.isFinite(job.sort_order)
        ? Number(job.sort_order)
        : Number.isFinite(j.sortOrder)
          ? Number(j.sortOrder)
          : null,
  };
}

module.exports = {
  toJob,
  toDbPayload,
  cleanArray,
  slugify,
  resolveSection,
};
