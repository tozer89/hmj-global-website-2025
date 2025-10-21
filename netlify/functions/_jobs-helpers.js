// netlify/functions/_jobs-helpers.js
function cleanArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|\u2022/g)
      .map(v => v.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function asString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toJob(row = {}) {
  return {
    id: asString(row.id),
    title: asString(row.title),
    status: asString(row.status) || 'live',
    section: asString(row.section) || 'dc',
    discipline: asString(row.discipline),
    type: asString(row.type) || 'permanent',
    locationText: asString(row.location_text || row.locationText),
    locationCode: asString(row.location_code || row.locationCode),
    overview: asString(row.overview),
    responsibilities: cleanArray(row.responsibilities),
    requirements: cleanArray(row.requirements),
    keywords: asString(row.keywords),
    applyUrl: asString(row.apply_url || row.applyUrl),
    published: !!row.published,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : Number.isFinite(row.sortOrder) ? row.sortOrder : null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function toDbPayload(job = {}) {
  const j = toJob(job);
  return {
    id: asString(j.id),
    title: asString(j.title),
    status: asString(j.status) || 'live',
    section: asString(j.section) || 'dc',
    discipline: asString(j.discipline),
    type: asString(j.type) || 'permanent',
    location_text: asString(j.locationText),
    location_code: asString(j.locationCode),
    overview: asString(j.overview),
    responsibilities: cleanArray(job.responsibilities || job.responsibilitiesText),
    requirements: cleanArray(job.requirements || job.requirementsText),
    keywords: asString(j.keywords),
    apply_url: asString(j.applyUrl),
    published: !!job.published,
    sort_order: Number.isFinite(job.sortOrder) ? job.sortOrder : Number.isFinite(job.sort_order) ? job.sort_order : null,
  };
}

module.exports = {
  toJob,
  toDbPayload,
  cleanArray,
};
