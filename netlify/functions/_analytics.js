'use strict';

const { createHash } = require('node:crypto');
const { isMissingTableError } = require('./_jobs-helpers.js');

const ANALYTICS_EVENTS_TABLE = 'analytics_events';
const EVENT_ID_MAX = 120;
const TEXT_MAX = 500;
const MAX_BATCH_EVENTS = 40;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 120;
const MAX_EVENT_ROWS = 20000;
const PAGE_SIZE = 1000;
const RECENT_LIMIT = 80;

const EVENT_TYPE_RE = /^[a-z0-9_]{2,80}$/;
const VALID_DEVICE_TYPES = new Set(['desktop', 'mobile', 'tablet']);
const VALID_SITE_AREAS = new Set(['public', 'admin']);
const INTERNAL_BASE_URL = 'https://hmj-global.local';
const DASHBOARD_FIELDS = [
  'occurred_at',
  'visitor_id',
  'session_id',
  'page_visit_id',
  'event_type',
  'site_area',
  'page_path',
  'full_url',
  'page_title',
  'referrer',
  'referrer_domain',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'link_url',
  'link_text',
  'event_label',
  'event_value',
  'duration_seconds',
  'path_from',
  'path_to',
  'device_type',
  'payload',
];
const REQUIRED_DASHBOARD_FIELDS = new Set([
  'occurred_at',
  'visitor_id',
  'session_id',
  'event_type',
  'site_area',
  'page_path',
]);

function header(event, name) {
  if (!event || !event.headers) return '';
  const wanted = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (String(key || '').toLowerCase() === wanted) return String(value || '');
  }
  return '';
}

function trimString(value, maxLength = TEXT_MAX) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return Number.isInteger(maxLength) && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toSlug(value) {
  return trimString(value, 120).toLowerCase();
}

function buildStableEventId(input = {}) {
  const provided = trimString(input.event_id || input.eventId, EVENT_ID_MAX);
  if (provided) return provided;
  const parts = [
    trimString(input.session_id || input.sessionId, 120),
    trimString(input.visitor_id || input.visitorId, 120),
    trimString(input.page_visit_id || input.pageVisitId, 120),
    trimString(input.event_type || input.eventType, 80),
    trimString(input.occurred_at || input.occurredAt, 80),
    trimString(input.page_path || input.pagePath || input.path, 180),
    trimString(input.event_label || input.eventLabel || input.label, 180),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, EVENT_ID_MAX);
}

function parseUrl(value) {
  const text = trimString(value, TEXT_MAX);
  if (!text) return null;
  try {
    return new URL(text, INTERNAL_BASE_URL);
  } catch {
    return null;
  }
}

function normalisePath(value) {
  const text = trimString(value, 280);
  if (!text) return '';
  const parsed = parseUrl(text);
  if (parsed) {
    const pathname = trimString(parsed.pathname, 240) || '/';
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }
  const stripped = text.split('?')[0].split('#')[0].trim();
  if (!stripped) return '';
  if (stripped.startsWith('/')) return stripped;
  if (/^[a-z0-9][a-z0-9/_\-.]*$/i.test(stripped)) return `/${stripped}`;
  return '';
}

function normaliseIsoTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normaliseDeviceType(explicit, viewportWidth, userAgent) {
  const preset = trimString(explicit, 20).toLowerCase();
  if (VALID_DEVICE_TYPES.has(preset)) return preset;

  const width = clampInteger(viewportWidth, 0, 10000);
  const ua = trimString(userAgent, 320).toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobi|iphone|android.+mobile/.test(ua)) return 'mobile';
  if (Number.isFinite(width)) {
    if (width <= 767) return 'mobile';
    if (width <= 1024) return 'tablet';
  }
  return 'desktop';
}

function normaliseSiteArea(explicit, pagePath) {
  const area = trimString(explicit, 20).toLowerCase();
  if (VALID_SITE_AREAS.has(area)) return area;
  return normalisePath(pagePath).startsWith('/admin') ? 'admin' : 'public';
}

function extractReferrerDomain(referrer) {
  const parsed = parseUrl(referrer);
  if (!parsed || !parsed.hostname) return '';
  return parsed.hostname.replace(/^www\./i, '').slice(0, 160);
}

function cleanPayloadValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 3) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return trimString(value, 320);
  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map((entry) => cleanPayloadValue(entry, depth + 1))
      .filter((entry) => entry !== null && entry !== '');
  }
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 24).forEach(([key, entry]) => {
      const safeKey = trimString(key, 80);
      if (!safeKey) return;
      const safeValue = cleanPayloadValue(entry, depth + 1);
      if (safeValue !== null && safeValue !== '') {
        out[safeKey] = safeValue;
      }
    });
    return out;
  }
  return null;
}

function extractRequestIp(event) {
  const forwarded = trimString(
    header(event, 'x-nf-client-connection-ip')
      || header(event, 'client-ip')
      || header(event, 'x-forwarded-for'),
    200
  );
  if (!forwarded) return '';
  return forwarded.split(',')[0].trim().slice(0, 120);
}

function hashIpAddress(ipAddress, salt = '') {
  const safeIp = trimString(ipAddress, 120);
  if (!safeIp) return '';
  return createHash('sha256')
    .update(`${trimString(salt, 240)}|${safeIp}`)
    .digest('hex');
}

function extractCountry(event) {
  return trimString(
    header(event, 'x-country')
      || header(event, 'x-nf-geo-country')
      || header(event, 'x-vercel-ip-country'),
    64
  );
}

function normaliseEventRow(input, options = {}) {
  const source = toSafeObject(input);
  const pagePath = normalisePath(source.page_path || source.pagePath || source.path || source.full_url || source.fullUrl || source.url);
  const fullUrl = trimString(source.full_url || source.fullUrl || source.url, TEXT_MAX);
  const referrer = trimString(source.referrer, TEXT_MAX);
  const eventType = toSlug(source.event_type || source.eventType);

  if (!EVENT_TYPE_RE.test(eventType)) {
    throw new Error('invalid_event_type');
  }

  const visitorId = trimString(source.visitor_id || source.visitorId, 120);
  const sessionId = trimString(source.session_id || source.sessionId, 120);
  if (!visitorId) throw new Error('visitor_id_missing');
  if (!sessionId) throw new Error('session_id_missing');

  const viewportWidth = clampInteger(source.viewport_width || source.viewportWidth || source.viewport?.width, 0, 10000);
  const viewportHeight = clampInteger(source.viewport_height || source.viewportHeight || source.viewport?.height, 0, 10000);
  const userAgent = trimString(source.user_agent || source.userAgent || options.userAgent, 320);
  const payload = cleanPayloadValue(source.payload || source.metadata || source.context || {}) || {};

  return {
    event_id: buildStableEventId(source),
    occurred_at: normaliseIsoTimestamp(source.occurred_at || source.occurredAt),
    visitor_id: visitorId,
    session_id: sessionId,
    page_visit_id: trimString(source.page_visit_id || source.pageVisitId, 120) || null,
    event_type: eventType,
    site_area: normaliseSiteArea(source.site_area || source.siteArea, pagePath),
    page_path: pagePath || null,
    full_url: fullUrl || null,
    page_title: trimString(source.page_title || source.pageTitle || source.title, 240) || null,
    referrer: referrer || null,
    referrer_domain: extractReferrerDomain(referrer) || null,
    utm_source: trimString(source.utm_source || source.utmSource || payload.utm_source || payload.utmSource, 120) || null,
    utm_medium: trimString(source.utm_medium || source.utmMedium || payload.utm_medium || payload.utmMedium, 120) || null,
    utm_campaign: trimString(source.utm_campaign || source.utmCampaign || payload.utm_campaign || payload.utmCampaign, 160) || null,
    utm_term: trimString(source.utm_term || source.utmTerm || payload.utm_term || payload.utmTerm, 160) || null,
    utm_content: trimString(source.utm_content || source.utmContent || payload.utm_content || payload.utmContent, 160) || null,
    link_url: trimString(source.link_url || source.linkUrl || payload.link_url || payload.linkUrl, TEXT_MAX) || null,
    link_text: trimString(source.link_text || source.linkText || payload.link_text || payload.linkText, 240) || null,
    event_label: trimString(source.event_label || source.eventLabel || source.label || payload.label, 240) || null,
    event_value: toFiniteNumber(source.event_value || source.eventValue || payload.value),
    duration_seconds: toFiniteNumber(source.duration_seconds || source.durationSeconds || payload.duration_seconds || payload.durationSeconds),
    path_from: normalisePath(source.path_from || source.pathFrom || source.previous_path || source.previousPath || payload.path_from || payload.pathFrom) || null,
    path_to: normalisePath(source.path_to || source.pathTo || source.target_path || source.targetPath || source.next_path || source.nextPath || payload.path_to || payload.pathTo) || null,
    device_type: normaliseDeviceType(source.device_type || source.deviceType, viewportWidth, userAgent),
    browser_language: trimString(source.browser_language || source.browserLanguage || payload.browser_language || payload.browserLanguage, 32) || null,
    viewport_width: viewportWidth,
    viewport_height: viewportHeight,
    timezone: trimString(source.timezone || payload.timezone, 80) || null,
    user_agent: userAgent || null,
    ip_hash: trimString(options.ipHash, 128) || null,
    country: trimString(options.country, 64) || null,
    payload,
  };
}

function parseIngestBody(eventBody) {
  let parsed = {};
  try {
    parsed = JSON.parse(eventBody || '{}');
  } catch {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(parsed.events) || !parsed.events.length) {
    const err = new Error('events_array_required');
    err.statusCode = 400;
    throw err;
  }
  if (parsed.events.length > MAX_BATCH_EVENTS) {
    const err = new Error('too_many_events');
    err.statusCode = 413;
    throw err;
  }
  return parsed;
}

function buildIngestRows(event, payload, options = {}) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const ipAddress = extractRequestIp(event);
  const country = extractCountry(event);
  const ipHash = hashIpAddress(ipAddress, options.ipSalt || process.env.ANALYTICS_IP_SALT || process.env.HMJ_ANALYTICS_IP_SALT || '');

  const rows = [];
  const rejected = [];

  events.forEach((entry, index) => {
    try {
      rows.push(normaliseEventRow(entry, {
        ipHash,
        country,
        userAgent: header(event, 'user-agent'),
      }));
    } catch (error) {
      rejected.push({
        index,
        reason: error?.message || 'invalid_event',
      });
    }
  });

  if (!rows.length) {
    const err = new Error('no_valid_events');
    err.statusCode = 400;
    err.details = rejected;
    throw err;
  }

  return {
    rows,
    rejected,
  };
}

function parseDateOnly(value) {
  const text = trimString(value, 24);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function toDateKey(value) {
  return normaliseIsoTimestamp(value).slice(0, 10);
}

function parseDashboardFilters(input = {}) {
  const today = new Date();
  const defaultTo = parseDateOnly(today.toISOString().slice(0, 10));
  const defaultFrom = addDays(defaultTo, -(DEFAULT_RANGE_DAYS - 1));
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  const rawFrom = requestedFrom || defaultFrom;
  const rawTo = requestedTo || defaultTo;
  const swapped = rawFrom > rawTo;
  const fromDate = swapped ? rawTo : rawFrom;
  const toDate = swapped ? rawFrom : rawTo;
  const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  const boundedFrom = diffDays > MAX_RANGE_DAYS ? addDays(toDate, -(MAX_RANGE_DAYS - 1)) : fromDate;
  const fromIso = boundedFrom.toISOString();
  const toExclusiveIso = addDays(toDate, 1).toISOString();

  return {
    from: boundedFrom.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    fromIso,
    toExclusiveIso,
    pagePath: trimString(input.pagePath || input.page_path || input.path, 180),
    eventType: toSlug(input.eventType || input.event_type),
    source: trimString(input.source || input.referrer || input.referrer_domain || input.referrerDomain || input.utm_source || input.utmSource, 160).toLowerCase(),
    deviceType: trimString(input.deviceType || input.device_type, 20).toLowerCase(),
    siteArea: (() => {
      const requestedScope = trimString(input.scope || input.siteArea || input.site_area, 20).toLowerCase();
      if (requestedScope === 'combined') return '';
      return requestedScope;
    })(),
    scope: (() => {
      const requestedScope = trimString(input.scope || input.siteArea || input.site_area, 20).toLowerCase();
      if (VALID_SITE_AREAS.has(requestedScope)) return requestedScope;
      return 'combined';
    })(),
  };
}

function countRangeDays(filters) {
  const fromDate = parseDateOnly(filters?.from);
  const toDate = parseDateOnly(filters?.to);
  if (!fromDate || !toDate) return DEFAULT_RANGE_DAYS;
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
}

function buildComparisonFilters(filters) {
  const spanDays = countRangeDays(filters);
  const currentFrom = parseDateOnly(filters?.from);
  if (!currentFrom) return parseDashboardFilters({});
  const previousTo = addDays(currentFrom, -1);
  const previousFrom = addDays(previousTo, -(spanDays - 1));
  return parseDashboardFilters({
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
    pagePath: filters?.pagePath,
    eventType: filters?.eventType,
    source: filters?.source,
    deviceType: filters?.deviceType,
    scope: filters?.scope || filters?.siteArea || 'combined',
  });
}

function applyDashboardFilters(query, filters) {
  let next = query
    .gte('occurred_at', filters.fromIso)
    .lt('occurred_at', filters.toExclusiveIso);

  if (filters.pagePath) {
    const path = filters.pagePath.replace(/\*/g, '').replace(/%/g, '');
    next = next.ilike('page_path', `%${path}%`);
  }
  if (filters.eventType && EVENT_TYPE_RE.test(filters.eventType)) {
    next = next.eq('event_type', filters.eventType);
  }
  if (VALID_DEVICE_TYPES.has(filters.deviceType)) {
    next = next.eq('device_type', filters.deviceType);
  }
  if (VALID_SITE_AREAS.has(filters.siteArea)) {
    next = next.eq('site_area', filters.siteArea);
  }
  return next;
}

function buildDashboardSelect(fields) {
  return (Array.isArray(fields) && fields.length ? fields : DASHBOARD_FIELDS).join(',');
}

function extractMissingAnalyticsColumn(error, tableName = ANALYTICS_EVENTS_TABLE) {
  const message = trimString(error?.message || error, 500);
  if (!message) return '';

  const escapedTable = String(tableName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`column\\s+${escapedTable}\\.([a-z0-9_]+)\\s+does not exist`, 'i'),
    /column\s+"?([a-z0-9_]+)"?\s+does not exist/i,
    new RegExp(`Could not find the ['"]?([a-z0-9_]+)['"]? column of ['"]?${escapedTable}['"]? in the schema cache`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match && match[1]) {
      return trimString(match[1], 80).replace(/^analytics_events\./i, '');
    }
  }
  return '';
}

function isMissingConflictConstraintError(error) {
  const message = trimString(error?.message || error, 500).toLowerCase();
  return message.includes('there is no unique or exclusion constraint matching the on conflict specification');
}

function isAnalyticsSchemaError(error) {
  return !!(
    isMissingAnalyticsTableError(error)
    || extractMissingAnalyticsColumn(error)
    || isMissingConflictConstraintError(error)
  );
}

function classifyAnalyticsSchemaIssue(error) {
  if (isMissingAnalyticsTableError(error)) {
    return {
      type: 'missing_table',
      message: trimString(error?.message || error, 500) || 'analytics_table_missing',
      missingColumn: '',
    };
  }

  const missingColumn = extractMissingAnalyticsColumn(error);
  if (missingColumn) {
    return {
      type: 'missing_column',
      message: trimString(error?.message || error, 500) || 'analytics_column_missing',
      missingColumn,
    };
  }

  if (isMissingConflictConstraintError(error)) {
    return {
      type: 'missing_conflict_constraint',
      message: trimString(error?.message || error, 500) || 'analytics_event_id_constraint_missing',
      missingColumn: '',
    };
  }

  return {
    type: 'unknown_schema_issue',
    message: trimString(error?.message || error, 500) || 'analytics_schema_issue',
    missingColumn: '',
  };
}

function isMissingAnalyticsTableError(error) {
  return isMissingTableError(error, ANALYTICS_EVENTS_TABLE);
}

function diffDashboardFields(fields) {
  return DASHBOARD_FIELDS.filter((field) => !fields.includes(field));
}

function stripFieldFromRows(rows, fieldName) {
  const items = Array.isArray(rows) ? rows : [];
  return items.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const next = { ...row };
    delete next[fieldName];
    return next;
  });
}

async function runAnalyticsSelectWithCompatibility(buildQuery) {
  let fields = DASHBOARD_FIELDS.slice();
  let lastError = null;

  while (fields.length) {
    const { data, error } = await buildQuery(buildDashboardSelect(fields));
    if (!error) {
      return {
        rows: Array.isArray(data) ? data : [],
        omittedFields: diffDashboardFields(fields),
      };
    }

    const missingColumn = extractMissingAnalyticsColumn(error, ANALYTICS_EVENTS_TABLE);
    if (!missingColumn || !fields.includes(missingColumn) || REQUIRED_DASHBOARD_FIELDS.has(missingColumn)) {
      throw error;
    }

    fields = fields.filter((field) => field !== missingColumn);
    lastError = error;
  }

  throw lastError || new Error('analytics_dashboard_select_unavailable');
}

async function writeAnalyticsRowsWithCompatibility(supabase, rows) {
  const primaryResult = await supabase
    .from(ANALYTICS_EVENTS_TABLE)
    .upsert(rows, {
      onConflict: 'event_id',
      ignoreDuplicates: true,
    });

  if (!primaryResult.error) {
    return {
      mode: 'upsert',
      schemaWarnings: [],
    };
  }

  if (!isAnalyticsSchemaError(primaryResult.error)) {
    throw primaryResult.error;
  }

  const issue = classifyAnalyticsSchemaIssue(primaryResult.error);

  if (issue.type === 'missing_column' && issue.missingColumn === 'event_id') {
    const { error } = await supabase
      .from(ANALYTICS_EVENTS_TABLE)
      .insert(stripFieldFromRows(rows, 'event_id'));
    if (error) throw error;

    return {
      mode: 'legacy_insert',
      schemaWarnings: ['event_id'],
    };
  }

  if (issue.type === 'missing_conflict_constraint') {
    const { error } = await supabase
      .from(ANALYTICS_EVENTS_TABLE)
      .insert(rows);
    if (error) throw error;

    return {
      mode: 'insert_without_conflict',
      schemaWarnings: ['event_id_conflict'],
    };
  }

  throw primaryResult.error;
}

async function fetchAnalyticsRows(supabase, filters, options = {}) {
  const maxRows = Number.isInteger(options.maxRows) ? options.maxRows : MAX_EVENT_ROWS;
  const rows = [];
  let page = 0;
  let truncated = false;
  let omittedFields = [];

  while (rows.length < maxRows) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const result = await runAnalyticsSelectWithCompatibility((selectClause) => {
      let query = supabase
        .from(ANALYTICS_EVENTS_TABLE)
        .select(selectClause)
        .order('occurred_at', { ascending: true })
        .range(from, to);

      query = applyDashboardFilters(query, filters);
      return query;
    });

    omittedFields = Array.from(new Set(omittedFields.concat(result.omittedFields || [])));
    const batch = result.rows;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
    if (rows.length >= maxRows) {
      truncated = true;
      rows.length = maxRows;
      break;
    }
  }

  return { rows, truncated, omittedFields };
}

async function fetchRecentAnalyticsRows(supabase, filters) {
  return runAnalyticsSelectWithCompatibility((selectClause) => {
    let query = supabase
      .from(ANALYTICS_EVENTS_TABLE)
      .select(selectClause)
      .order('occurred_at', { ascending: false })
      .range(0, 199);

    query = applyDashboardFilters(query, filters);
    return query;
  });
}

function applySourceFilter(rows, source) {
  const needle = trimString(source, 160).toLowerCase();
  if (!needle) return Array.isArray(rows) ? rows.slice() : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const hay = [
      row.referrer_domain,
      row.referrer,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
    ].map((value) => trimString(value, 200).toLowerCase()).filter(Boolean);
    return hay.some((value) => value.includes(needle));
  });
}

function createSeriesMap(filters) {
  const map = new Map();
  let current = parseDateOnly(filters.from);
  const last = parseDateOnly(filters.to);
  while (current && last && current <= last) {
    map.set(current.toISOString().slice(0, 10), {
      date: current.toISOString().slice(0, 10),
      pageViews: 0,
      sessions: 0,
      uniqueVisitors: new Set(),
      ctaClicks: 0,
    });
    current = addDays(current, 1);
  }
  return map;
}

function friendlyEventName(eventType) {
  return trimString(eventType, 80)
    .replace(/_/g, ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function eventCategory(eventType) {
  const safeType = trimString(eventType, 80).toLowerCase();
  if (isCtaEvent({ event_type: safeType })) return 'cta';
  if (safeType === 'page_view' || safeType === 'landing_page' || safeType === 'exit_page') return 'traffic';
  if (safeType.startsWith('session_')) return 'session';
  if (safeType === 'jobs_filter_used') return 'filter';
  if (safeType === 'time_on_page_seconds' || safeType === 'page_leave' || safeType === 'page_hidden' || safeType === 'page_visible') return 'engagement';
  return 'activity';
}

function displayEventLabel(eventType) {
  const safeType = trimString(eventType, 80).toLowerCase();
  const labels = {
    page_view: 'Page View',
    landing_page: 'Landing Page',
    exit_page: 'Exit Page',
    session_started: 'Session Started',
    session_ended: 'Session Ended',
    session_heartbeat: 'Session Heartbeat',
    time_on_page_seconds: 'Time on Page',
    page_leave: 'Page Leave',
    jobs_filter_used: 'Jobs Filter Used',
    jobs_card_clicked: 'Job Card Opened',
    job_apply_clicked: 'Apply Clicked',
    job_share_clicked: 'Share Clicked',
    contact_form_cta_clicked: 'Contact CTA Clicked',
    email_link_clicked: 'Email Link Clicked',
    phone_link_clicked: 'Phone Link Clicked',
    whatsapp_link_clicked: 'WhatsApp Link Clicked',
    spec_page_opened: 'Spec Page Opened',
  };
  return labels[safeType] || friendlyEventName(safeType);
}

function stripBrandSuffix(value) {
  return trimString(value, 240)
    .replace(/\s*\|\s*HMJ(?:\s+Global)?(?:\s+Admin)?\s*$/i, '')
    .trim();
}

function stripActionPrefix(value) {
  return trimString(value, 180)
    .replace(/^(open|show details for|show|apply for|apply now for|share|share role|speak to hmj about)\s+/i, '')
    .trim();
}

function isMeaningfulLabel(value) {
  const text = stripBrandSuffix(value);
  if (!text) return false;
  return !/^(job spec|role|jobs|home|index)$/i.test(text);
}

function parseUrlSearch(value) {
  const parsed = parseUrl(value);
  return parsed ? parsed.searchParams : null;
}

function sourceLabelForRow(row) {
  return trimString(row?.utm_source, 120)
    || trimString(row?.referrer_domain, 160)
    || 'Direct';
}

function siteAreaLabel(value) {
  const safe = trimString(value, 20).toLowerCase();
  if (safe === 'admin') return 'Admin portal';
  if (safe === 'public') return 'Public website';
  return 'Combined';
}

function createMixEntry(label) {
  return {
    label,
    pageViews: 0,
    sessions: 0,
    ctaClicks: 0,
    visitors: new Set(),
  };
}

function touchMix(map, label) {
  const key = trimString(label, 160) || 'Unknown';
  let entry = map.get(key);
  if (!entry) {
    entry = createMixEntry(key);
    map.set(key, entry);
  }
  return entry;
}

function toMixRows(map, limit) {
  return Array.from((map instanceof Map ? map : new Map()).values())
    .map((entry) => ({
      label: entry.label,
      pageViews: entry.pageViews,
      sessions: entry.sessions,
      ctaClicks: entry.ctaClicks,
      uniqueVisitors: entry.visitors.size,
    }))
    .sort((left, right) => (
      right.pageViews - left.pageViews
      || right.sessions - left.sessions
      || right.uniqueVisitors - left.uniqueVisitors
      || left.label.localeCompare(right.label)
    ))
    .slice(0, Number.isInteger(limit) ? limit : 12);
}

function buildMetricDelta(currentValue, previousValue) {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  const delta = current - previous;
  let deltaPercent = 0;
  if (previous === 0) {
    deltaPercent = current === 0 ? 0 : 100;
  } else {
    deltaPercent = (delta / previous) * 100;
  }
  return {
    current,
    previous,
    delta,
    deltaPercent: Number(deltaPercent.toFixed(1)),
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

function buildComparisonSummary(currentSummary, previousSummary, currentFilters, previousFilters) {
  const currentKpis = currentSummary?.kpis || {};
  const previousKpis = previousSummary?.kpis || {};

  return {
    enabled: true,
    currentPeriod: {
      from: currentFilters?.from || '',
      to: currentFilters?.to || '',
    },
    previousPeriod: {
      from: previousFilters?.from || '',
      to: previousFilters?.to || '',
    },
    kpis: {
      totalPageViews: buildMetricDelta(currentKpis.totalPageViews, previousKpis.totalPageViews),
      uniqueVisitors: buildMetricDelta(currentKpis.uniqueVisitors, previousKpis.uniqueVisitors),
      sessions: buildMetricDelta(currentKpis.sessions, previousKpis.sessions),
      avgSessionDurationSeconds: buildMetricDelta(currentKpis.avgSessionDurationSeconds, previousKpis.avgSessionDurationSeconds),
      avgTimeOnPageSeconds: buildMetricDelta(currentKpis.avgTimeOnPageSeconds, previousKpis.avgTimeOnPageSeconds),
      bounceRate: buildMetricDelta(currentKpis.bounceRate, previousKpis.bounceRate),
      ctaClicks: buildMetricDelta(currentKpis.ctaClicks, previousKpis.ctaClicks),
    },
  };
}

function buildEventDetail(row) {
  const payload = toSafeObject(row.payload);
  const duration = toFiniteNumber(row.duration_seconds);

  if (trimString(row.event_label, 240)) return trimString(row.event_label, 240);
  if (trimString(row.link_text, 240)) return trimString(row.link_text, 240);
  if (trimString(payload.job_title, 160)) return trimString(payload.job_title, 160);
  if (trimString(payload.filter_summary || payload.filter_name, 160)) {
    const filterName = trimString(payload.filter_summary || payload.filter_name, 160);
    const filterValue = trimString(payload.filter_value || payload.value, 160);
    return filterValue ? `${filterName}: ${filterValue}` : filterName;
  }
  if (row.event_type === 'time_on_page_seconds' && Number.isFinite(duration)) {
    return `${Math.round(duration)}s active`;
  }
  if (row.event_type === 'page_leave' && Number.isFinite(duration)) {
    return `${Math.round(duration)}s before leave`;
  }
  if (row.path_to) return `Next: ${row.path_to}`;
  return friendlyEventName(row.event_type);
}

function isCtaEvent(row) {
  const eventType = trimString(row?.event_type, 80).toLowerCase();
  return (
    eventType === 'cta_click'
    || eventType.endsWith('_clicked')
    || eventType === 'download_clicked'
  );
}

function isNoiseEvent(row) {
  const eventType = trimString(row?.event_type, 80).toLowerCase();
  return eventType === 'session_heartbeat' || eventType === 'page_visible' || eventType === 'page_hidden';
}

function deriveListingMeta(row) {
  const payload = toSafeObject(row?.payload);
  const params = parseUrlSearch(row?.full_url);
  const pagePath = trimString(row?.page_path, 240) || '/';
  const eventType = trimString(row?.event_type, 80).toLowerCase();

  const jobId = trimString(
    payload.job_id
      || payload.jobId
      || params?.get('job_id')
      || params?.get('id')
      || '',
    120
  );
  const slug = trimString(
    payload.share_slug
      || payload.slug
      || params?.get('slug')
      || params?.get('job_share_code')
      || '',
    120
  );
  const queryTitle = trimString(params?.get('job_title') || params?.get('role') || '', 180);
  const payloadTitle = trimString(payload.job_title || payload.title || '', 180);
  const pageTitle = stripBrandSuffix(row?.page_title);
  const labelTitle = stripActionPrefix(row?.event_label || row?.link_text);
  const title = payloadTitle
    || (isMeaningfulLabel(pageTitle) ? pageTitle : '')
    || (isMeaningfulLabel(labelTitle) ? labelTitle : '')
    || queryTitle;

  let kind = '';
  if (pagePath === '/jobs/spec.html' || eventType.startsWith('spec_')) {
    kind = 'spec';
  } else if (
    pagePath === '/jobs.html'
    || eventType.startsWith('jobs_')
    || eventType.startsWith('job_')
    || !!jobId
    || !!trimString(payload.detail_url || payload.detailUrl, 500)
  ) {
    kind = 'job';
  }

  const key = trimString(
    kind === 'spec'
      ? (jobId || slug || trimString(row?.full_url, 500) || title)
      : (jobId || slug || title || trimString(payload.detail_url || payload.detailUrl, 500)),
    500
  );

  if (!kind || !key) return null;

  return {
    kind,
    key,
    jobId,
    slug,
    title: title || (kind === 'spec' ? 'Untitled spec page' : 'Untitled job'),
    location: trimString(payload.job_location || payload.location || params?.get('job_location') || '', 160),
    status: trimString(payload.job_status || payload.status || '', 80),
    employmentType: trimString(payload.employment_type || payload.job_type || params?.get('job_type') || '', 80),
  };
}

function touchListing(map, meta, kind) {
  if (!meta || meta.kind !== kind || !meta.key) return null;
  let entry = map.get(meta.key);
  if (!entry) {
    entry = {
      key: meta.key,
      kind,
      title: meta.title || (kind === 'spec' ? 'Untitled spec page' : 'Untitled job'),
      jobId: meta.jobId || '',
      slug: meta.slug || '',
      location: meta.location || '',
      status: meta.status || '',
      employmentType: meta.employmentType || '',
      views: 0,
      detailOpens: 0,
      specViews: 0,
      applyClicks: 0,
      ctaClicks: 0,
      durations: [],
      visitors: new Set(),
      sessions: new Set(),
    };
    map.set(meta.key, entry);
  }

  if (
    meta.title
    && (
      !entry.title
      || /^untitled/i.test(entry.title)
      || !isMeaningfulLabel(entry.title)
      || meta.title.length > entry.title.length
    )
  ) {
    entry.title = meta.title;
  }
  if (meta.jobId && !entry.jobId) entry.jobId = meta.jobId;
  if (meta.slug && !entry.slug) entry.slug = meta.slug;
  if (meta.location && !entry.location) entry.location = meta.location;
  if (meta.status && !entry.status) entry.status = meta.status;
  if (meta.employmentType && !entry.employmentType) entry.employmentType = meta.employmentType;
  return entry;
}

function addListingSignal(entry, row, meta) {
  if (!entry) return;
  const eventType = trimString(row?.event_type, 80).toLowerCase();
  const pagePath = trimString(row?.page_path, 240) || '/';
  const visitorId = trimString(row?.visitor_id, 120);
  const sessionId = trimString(row?.session_id, 120);
  const duration = toFiniteNumber(row?.duration_seconds);

  if (visitorId) entry.visitors.add(visitorId);
  if (sessionId) entry.sessions.add(sessionId);
  if (meta?.title && meta.title.length >= entry.title.length) entry.title = meta.title;

  if (pagePath === '/jobs/spec.html' && eventType === 'page_view') {
    entry.views += 1;
    entry.specViews += 1;
  }
  if (pagePath === '/jobs/spec.html' && eventType === 'time_on_page_seconds' && Number.isFinite(duration) && duration >= 0) {
    entry.durations.push(duration);
  }
  if (eventType === 'jobs_card_clicked') {
    entry.views += 1;
    entry.detailOpens += 1;
  }
  if (eventType === 'job_apply_clicked') {
    entry.applyClicks += 1;
  }
  if (isCtaEvent(row)) {
    entry.ctaClicks += 1;
  }
}

function formatListingRows(map, sortKey) {
  return Array.from((map instanceof Map ? map : new Map()).values())
    .map((entry) => {
      const totalDuration = entry.durations.reduce((sum, value) => sum + value, 0);
      const avgTimeOnPageSeconds = entry.durations.length
        ? Math.round(totalDuration / entry.durations.length)
        : 0;
      const intentActions = entry.applyClicks + entry.ctaClicks;
      return {
        key: entry.key,
        kind: entry.kind,
        title: entry.title,
        jobId: entry.jobId,
        slug: entry.slug,
        location: entry.location,
        status: entry.status,
        employmentType: entry.employmentType,
        views: entry.views,
        detailOpens: entry.detailOpens,
        specViews: entry.specViews,
        applyClicks: entry.applyClicks,
        ctaClicks: entry.ctaClicks,
        uniqueVisitors: entry.visitors.size,
        sessions: entry.sessions.size,
        avgTimeOnPageSeconds,
        intentActions,
      };
    })
    .sort((left, right) => {
      if (sortKey === 'spec') {
        return (
          right.views - left.views
          || right.avgTimeOnPageSeconds - left.avgTimeOnPageSeconds
          || right.applyClicks - left.applyClicks
          || left.title.localeCompare(right.title)
        );
      }
      return (
        right.views - left.views
        || right.applyClicks - left.applyClicks
        || right.ctaClicks - left.ctaClicks
        || left.title.localeCompare(right.title)
      );
    });
}

function buildListingIntentRows(rows) {
  return Array.from((rows instanceof Map ? rows : new Map()).values())
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title))
    .slice(0, 12);
}

function summariseAnalytics(rows, filters, recentRows, truncated) {
  const allRows = Array.isArray(rows) ? rows.slice() : [];
  const sessions = new Map();
  const pages = new Map();
  const ctas = new Map();
  const landingPages = new Map();
  const exitPages = new Map();
  const topPaths = new Map();
  const transitions = new Map();
  const deviceTypes = new Set();
  const sources = new Set();
  const eventTypes = new Set();
  const pageOptions = new Set();
  const visitorsOverall = new Set();
  const series = createSeriesMap(filters);
  const sourceMix = new Map();
  const deviceMix = new Map();
  const siteAreaMix = new Map();
  const jobs = new Map();
  const specs = new Map();
  const listingIntent = new Map();

  allRows.forEach((row) => {
    const eventType = trimString(row.event_type, 80).toLowerCase();
    const pagePath = trimString(row.page_path, 240) || '/';
    const visitorId = trimString(row.visitor_id, 120);
    const sessionId = trimString(row.session_id, 120);
    const occurredAt = normaliseIsoTimestamp(row.occurred_at);
    const occurredMs = new Date(occurredAt).getTime();
    const dateKey = toDateKey(occurredAt);
    const pageTitle = trimString(row.page_title, 240);
    const duration = toFiniteNumber(row.duration_seconds);
    const deviceType = trimString(row.device_type, 20) || 'desktop';
    const sourceLabel = sourceLabelForRow(row);
    const siteArea = trimString(row.site_area, 20) || 'public';
    const listingMeta = deriveListingMeta(row);

    if (visitorId) visitorsOverall.add(visitorId);
    if (deviceType) deviceTypes.add(deviceType);
    if (sourceLabel) sources.add(sourceLabel);
    if (trimString(row.referrer_domain, 160)) sources.add(trimString(row.referrer_domain, 160));
    if (trimString(row.utm_source, 120)) sources.add(trimString(row.utm_source, 120));
    if (trimString(row.event_type, 80)) eventTypes.add(trimString(row.event_type, 80));
    if (pagePath) pageOptions.add(pagePath);

    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        visitorId,
        firstAt: occurredMs,
        lastAt: occurredMs,
        pageViews: [],
        sourceLabel,
        deviceType,
      };
      sessions.set(sessionId, session);
    } else {
      session.firstAt = Math.min(session.firstAt, occurredMs);
      session.lastAt = Math.max(session.lastAt, occurredMs);
      if (!session.sourceLabel && sourceLabel) session.sourceLabel = sourceLabel;
      if (!session.deviceType && deviceType) session.deviceType = deviceType;
    }

    if (eventType === 'page_view') {
      session.pageViews.push({ pagePath, pageTitle, occurredMs, visitorId, siteArea });
      const bucket = series.get(dateKey);
      if (bucket) {
        bucket.pageViews += 1;
        if (visitorId) bucket.uniqueVisitors.add(visitorId);
      }

      const sourceEntry = touchMix(sourceMix, sourceLabel);
      sourceEntry.pageViews += 1;
      if (visitorId) sourceEntry.visitors.add(visitorId);

      const deviceEntry = touchMix(deviceMix, deviceType);
      deviceEntry.pageViews += 1;
      if (visitorId) deviceEntry.visitors.add(visitorId);

      const areaEntry = touchMix(siteAreaMix, siteAreaLabel(siteArea));
      areaEntry.pageViews += 1;
      if (visitorId) areaEntry.visitors.add(visitorId);
    }

    if (isCtaEvent(row)) {
      const ctaKey = trimString(row.event_label || row.link_text, 240) || friendlyEventName(eventType);
      const pageKey = pagePath || '/';
      const entry = ctas.get(ctaKey) || { label: ctaKey, count: 0, pages: new Map() };
      entry.count += 1;
      entry.pages.set(pageKey, (entry.pages.get(pageKey) || 0) + 1);
      ctas.set(ctaKey, entry);

      const bucket = series.get(dateKey);
      if (bucket) bucket.ctaClicks += 1;

      touchMix(sourceMix, sourceLabel).ctaClicks += 1;
      touchMix(deviceMix, deviceType).ctaClicks += 1;
      touchMix(siteAreaMix, siteAreaLabel(siteArea)).ctaClicks += 1;
    }

    let page = pages.get(pagePath);
    if (!page) {
      page = {
        path: pagePath,
        title: pageTitle || pagePath,
        views: 0,
        visitors: new Set(),
        durations: [],
        exits: 0,
        ctaClicks: 0,
      };
      pages.set(pagePath, page);
    }
    if (pageTitle) page.title = pageTitle;
    if (visitorId) page.visitors.add(visitorId);
    if (eventType === 'page_view') page.views += 1;
    if (eventType === 'time_on_page_seconds' && Number.isFinite(duration) && duration >= 0) {
      page.durations.push(duration);
    }
    if (isCtaEvent(row)) {
      page.ctaClicks += 1;
    }

    if (listingMeta) {
      const jobEntry = touchListing(jobs, {
        ...listingMeta,
        kind: 'job',
      }, 'job');
      addListingSignal(jobEntry, row, listingMeta);

      if (listingMeta.kind === 'spec') {
        const specEntry = touchListing(specs, listingMeta, 'spec');
        addListingSignal(specEntry, row, listingMeta);
      }

      if (isCtaEvent(row)) {
        const actionKey = `${listingMeta.key}|${eventType}`;
        const current = listingIntent.get(actionKey) || {
          key: actionKey,
          title: listingMeta.title,
          kind: listingMeta.kind,
          action: displayEventLabel(eventType),
          count: 0,
        };
        current.count += 1;
        if (listingMeta.title && listingMeta.title.length >= current.title.length) current.title = listingMeta.title;
        listingIntent.set(actionKey, current);
      }
    }
  });

  const sessionDurations = [];
  let bouncedSessions = 0;

  sessions.forEach((session) => {
    session.pageViews.sort((a, b) => a.occurredMs - b.occurredMs);
    if (session.pageViews.length) {
      const first = session.pageViews[0];
      const last = session.pageViews[session.pageViews.length - 1];
      landingPages.set(first.pagePath, (landingPages.get(first.pagePath) || 0) + 1);
      exitPages.set(last.pagePath, (exitPages.get(last.pagePath) || 0) + 1);
      const exitPage = pages.get(last.pagePath);
      if (exitPage) exitPage.exits += 1;

      if (session.pageViews.length <= 1) bouncedSessions += 1;

      const pathKey = session.pageViews
        .slice(0, 5)
        .map((entry) => entry.pagePath)
        .join(' -> ');
      if (pathKey) {
        topPaths.set(pathKey, (topPaths.get(pathKey) || 0) + 1);
      }

      for (let index = 0; index < session.pageViews.length - 1; index += 1) {
        const from = session.pageViews[index].pagePath;
        const to = session.pageViews[index + 1].pagePath;
        const transitionKey = `${from} -> ${to}`;
        transitions.set(transitionKey, (transitions.get(transitionKey) || 0) + 1);
      }

      const sessionDateKey = toDateKey(session.firstAt);
      const bucket = series.get(sessionDateKey);
      if (bucket) bucket.sessions += 1;

      const sourceEntry = touchMix(sourceMix, session.sourceLabel || 'Direct');
      sourceEntry.sessions += 1;
      if (session.visitorId) sourceEntry.visitors.add(session.visitorId);

      const deviceEntry = touchMix(deviceMix, session.deviceType || 'desktop');
      deviceEntry.sessions += 1;
      if (session.visitorId) deviceEntry.visitors.add(session.visitorId);

      const primaryArea = session.pageViews[0]?.siteArea || 'public';
      const areaEntry = touchMix(siteAreaMix, siteAreaLabel(primaryArea));
      areaEntry.sessions += 1;
      if (session.visitorId) areaEntry.visitors.add(session.visitorId);
    }
    sessionDurations.push(Math.max(0, Math.round((session.lastAt - session.firstAt) / 1000)));
  });

  const pageRows = Array.from(pages.values())
    .map((page) => {
      const totalDuration = page.durations.reduce((sum, value) => sum + value, 0);
      const avgTime = page.durations.length ? totalDuration / page.durations.length : 0;
      const uniqueVisitors = page.visitors.size;
      const exitRate = page.views ? (page.exits / page.views) * 100 : 0;
      return {
        path: page.path,
        title: page.title,
        pageViews: page.views,
        uniqueVisitors,
        avgTimeOnPageSeconds: Math.round(avgTime),
        exits: page.exits,
        exitRate: Number(exitRate.toFixed(1)),
        ctaClicks: page.ctaClicks,
      };
    })
    .sort((left, right) => (
      right.pageViews - left.pageViews
      || right.uniqueVisitors - left.uniqueVisitors
      || left.path.localeCompare(right.path)
    ));

  const totalPageViews = pageRows.reduce((sum, page) => sum + page.pageViews, 0);
  const totalCtaClicks = pageRows.reduce((sum, page) => sum + page.ctaClicks, 0);
  const avgSessionDuration = sessionDurations.length
    ? Math.round(sessionDurations.reduce((sum, value) => sum + value, 0) / sessionDurations.length)
    : 0;
  const allDurations = pageRows.map((page) => page.avgTimeOnPageSeconds).filter((value) => Number.isFinite(value) && value > 0);
  const avgTimeOnPage = allDurations.length
    ? Math.round(allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length)
    : 0;
  const bounceRate = sessions.size ? Number(((bouncedSessions / sessions.size) * 100).toFixed(1)) : 0;

  const trend = Array.from(series.values()).map((entry) => ({
    date: entry.date,
    pageViews: entry.pageViews,
    sessions: entry.sessions,
    uniqueVisitors: entry.uniqueVisitors.size,
    ctaClicks: entry.ctaClicks,
  }));

  const topCtas = Array.from(ctas.values())
    .map((entry) => ({
      label: entry.label,
      clicks: entry.count,
      topPage: Array.from(entry.pages.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }))
    .sort((left, right) => right.clicks - left.clicks || left.label.localeCompare(right.label));

  const clicksByPage = pageRows
    .filter((page) => page.ctaClicks > 0)
    .map((page) => ({ path: page.path, clicks: page.ctaClicks }))
    .sort((left, right) => right.clicks - left.clicks || left.path.localeCompare(right.path));

  const jobsFilterUsage = allRows
    .filter((row) => row.event_type === 'jobs_filter_used')
    .map((row) => ({
      label: buildEventDetail(row),
      occurredAt: normaliseIsoTimestamp(row.occurred_at),
    }))
    .slice(-25)
    .reverse();

  const topJobRows = formatListingRows(jobs, 'job');
  const topSpecRows = formatListingRows(specs, 'spec');
  const mostEngagedListings = topSpecRows
    .concat(topJobRows.map((row) => ({ ...row, kind: 'job' })))
    .sort((left, right) => (
      (right.applyClicks + right.ctaClicks) - (left.applyClicks + left.ctaClicks)
      || right.views - left.views
      || right.avgTimeOnPageSeconds - left.avgTimeOnPageSeconds
      || left.title.localeCompare(right.title)
    ))
    .slice(0, 12);

  const recent = (Array.isArray(recentRows) ? recentRows : allRows.slice().reverse())
    .filter((row) => filters.eventType || !isNoiseEvent(row))
    .slice(0, RECENT_LIMIT)
    .map((row) => ({
      occurredAt: normaliseIsoTimestamp(row.occurred_at),
      pagePath: trimString(row.page_path, 240) || '/',
      pageTitle: trimString(row.page_title, 240),
      eventType: trimString(row.event_type, 80),
      eventLabel: displayEventLabel(row.event_type),
      category: eventCategory(row.event_type),
      detail: buildEventDetail(row),
      sessionIdShort: trimString(row.session_id, 120).slice(0, 8),
      source: sourceLabelForRow(row),
      deviceType: trimString(row.device_type, 20) || '',
      siteArea: trimString(row.site_area, 20) || '',
    }));

  return {
    source: 'supabase',
    truncated,
    definitions: {
      visitor_id: 'Anonymous browser-level identifier stored locally in the visitor browser.',
      session_id: 'Session identifier that rotates per browser tab session.',
      unique_visitor: 'Distinct visitor_id values among page_view events inside the selected range.',
      session: 'Distinct session_id values inside the selected range.',
      avg_session_duration: 'Average of last_event_at minus first_event_at for each session inside the selected range.',
      time_on_page: 'Average of time_on_page_seconds events, recorded from active time on page.',
      bounce_rate: 'Approximate percentage of sessions with exactly one page_view in the selected range.',
    },
    filters: {
      applied: {
        from: filters.from,
        to: filters.to,
        pagePath: filters.pagePath || '',
        eventType: filters.eventType || '',
        source: filters.source || '',
        deviceType: filters.deviceType || '',
        siteArea: filters.siteArea || '',
        scope: filters.scope || 'combined',
      },
      options: {
        pagePaths: Array.from(pageOptions).sort((a, b) => a.localeCompare(b)).slice(0, 120),
        eventTypes: Array.from(eventTypes).sort((a, b) => a.localeCompare(b)),
        referrers: Array.from(sources).sort((a, b) => a.localeCompare(b)).slice(0, 40),
        sources: Array.from(sources).sort((a, b) => a.localeCompare(b)).slice(0, 40),
        deviceTypes: Array.from(deviceTypes).sort((a, b) => a.localeCompare(b)),
        siteAreas: ['public', 'admin'],
      },
    },
    kpis: {
      totalPageViews,
      uniqueVisitors: visitorsOverall.size,
      sessions: sessions.size,
      avgSessionDurationSeconds: avgSessionDuration,
      avgTimeOnPageSeconds: avgTimeOnPage,
      bounceRate,
      ctaClicks: totalCtaClicks,
      topPage: pageRows[0]?.path || '',
    },
    trend,
    topPages: pageRows.slice(0, 25),
    recentActivity: recent,
    clickAnalytics: {
      topCtas: topCtas.slice(0, 20),
      clicksByPage: clicksByPage.slice(0, 20),
      clicksOverTime: trend.map((entry) => ({ date: entry.date, clicks: entry.ctaClicks })),
      jobsFilterUsage,
    },
    breakdowns: {
      sources: toMixRows(sourceMix, 8),
      devices: toMixRows(deviceMix, 6),
      siteAreas: toMixRows(siteAreaMix, 3),
    },
    listings: {
      summary: {
        jobViews: topJobRows.reduce((sum, row) => sum + row.views, 0),
        specViews: topSpecRows.reduce((sum, row) => sum + row.views, 0),
        applyClicks: topSpecRows.reduce((sum, row) => sum + row.applyClicks, 0) + topJobRows.reduce((sum, row) => sum + row.applyClicks, 0),
        avgListingTimeSeconds: (() => {
          const durations = topSpecRows.concat(topJobRows).map((row) => row.avgTimeOnPageSeconds).filter((value) => value > 0);
          return durations.length
            ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
            : 0;
        })(),
      },
      jobs: topJobRows.slice(0, 12),
      specs: topSpecRows.slice(0, 12),
      topIntentActions: buildListingIntentRows(listingIntent),
      mostEngaged: mostEngagedListings,
    },
    pathInsights: {
      landingPages: Array.from(landingPages.entries())
        .map(([path, count]) => ({ path, sessions: count }))
        .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
        .slice(0, 15),
      exitPages: Array.from(exitPages.entries())
        .map(([path, count]) => ({ path, sessions: count }))
        .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
        .slice(0, 15),
      topPaths: Array.from(topPaths.entries())
        .map(([path, sessionsCount]) => ({ path, sessions: sessionsCount }))
        .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
        .slice(0, 12),
      topTransitions: Array.from(transitions.entries())
        .map(([transition, count]) => {
          const splitAt = transition.indexOf(' -> ');
          return {
            from: transition.slice(0, splitAt),
            to: transition.slice(splitAt + 4),
            count,
          };
        })
        .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))
        .slice(0, 20),
    },
  };
}

function createCsv(rows) {
  const entries = Array.isArray(rows) ? rows : [];
  const headerRow = ['timestamp', 'page_path', 'page_title', 'event_type', 'detail', 'session_id', 'source', 'device_type'];
  const bodyRows = entries.map((row) => [
    row.occurredAt,
    row.pagePath,
    row.pageTitle,
    row.eventType,
    row.detail,
    row.sessionIdShort,
    row.source,
    row.deviceType,
  ]);
  return [headerRow, ...bodyRows]
    .map((row) => row.map((value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

module.exports = {
  ANALYTICS_EVENTS_TABLE,
  DEFAULT_RANGE_DAYS,
  MAX_BATCH_EVENTS,
  MAX_EVENT_ROWS,
  RECENT_LIMIT,
  header,
  trimString,
  normaliseEventRow,
  parseIngestBody,
  buildIngestRows,
  parseDashboardFilters,
  fetchAnalyticsRows,
  fetchRecentAnalyticsRows,
  writeAnalyticsRowsWithCompatibility,
  applySourceFilter,
  summariseAnalytics,
  createCsv,
  buildComparisonFilters,
  buildComparisonSummary,
  extractRequestIp,
  hashIpAddress,
  extractCountry,
  extractMissingAnalyticsColumn,
  classifyAnalyticsSchemaIssue,
  isAnalyticsSchemaError,
  isMissingAnalyticsTableError,
};
