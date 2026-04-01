// netlify/functions/_settings-helpers.js
// Centralised admin settings helper with Supabase + fallback support.
const { hasSupabase, getSupabase, supabaseStatus } = require('./_supabase.js');
const { DEFAULT_CHATBOT_SETTINGS } = require('./_chatbot-config.js');
const { DEFAULT_CREDIT_CHECKER_SETTINGS } = require('../../lib/credit-limit-checker.js');

function createDefaultLinkedinTestimonials() {
  const placeholderText = '[Recommendation pending — Nick to copy full text from LinkedIn]';
  return {
    enabled: true,
    updatedAt: null,
    items: Array.from({ length: 6 }, (_, index) => ({
      id: `testimonial-${String(index + 1).padStart(2, '0')}`,
      text: placeholderText,
      name: `LinkedIn recommender ${String(index + 1).padStart(2, '0')}`,
      title: 'Job title pending',
      company: 'Company pending',
      linkedinUrl: '',
      imageUrl: '',
      imageStorageKey: '',
      imageAltText: '',
      source: 'LinkedIn Recommendation',
    })),
  };
}

const DEFAULT_SETTINGS = {
  fiscal_week1_ending: '2025-11-02', // Week 1 ends Sunday 2nd November 2025 by default
  fiscal_week_day: 'sunday',
  timesheet_deadline_note: 'Submit approved timesheets by Monday 10:00 (UK time) to guarantee payroll.',
  timesheet_deadline_timezone: 'Europe/London',
  noticeboard_enabled: true,
  linkedin_testimonials: createDefaultLinkedinTestimonials(),
  team_tasks_settings: {
    dueSoonDays: 3,
    collapseDoneByDefault: true,
    assignmentEmailNotifications: true,
    reminderRecipientMode: 'assignee_creator_watchers',
    activityRecipientMode: 'assignee_creator_watchers',
    activityEmailNotifications: true,
    mentionEmailNotifications: true,
    defaultPriority: 'medium',
  },
  team_tasks_calendar_settings: {
    enabled: false,
    provider: 'microsoft',
    tenantId: 'common',
    clientId: '',
    clientSecret: '',
    scopes: ['offline_access', 'openid', 'profile', 'User.Read', 'Calendars.Read'],
    showExternalEvents: true,
    showTeamConnections: true,
    syncEnabled: true,
    weekStartsOn: 'monday',
  },
  annual_leave_settings: {
    defaultRegion: 'england-and-wales',
    remindersEnabled: true,
    overlapWarningThreshold: 2,
    reminderRunHourLocal: 8,
    holidayCacheTtlHours: 168,
    defaultEntitlementDays: 28,
    entitlementOverrides: {},
  },
  chatbot_settings: DEFAULT_CHATBOT_SETTINGS,
  credit_checker_settings: DEFAULT_CREDIT_CHECKER_SETTINGS,
};

const MS_DAY = 86400000;

function parseIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const d = new Date(`${value.trim()}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fiscalWeekNumber(weekEnding, baseEnding = DEFAULT_SETTINGS.fiscal_week1_ending) {
  const target = parseIsoDate(weekEnding);
  const base = parseIsoDate(baseEnding);
  if (!target || !base) return null;
  const diffDays = Math.round((target.getTime() - base.getTime()) / MS_DAY);
  const offset = Math.floor(diffDays / 7);
  return offset + 1;
}

function mapRows(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row || !row.key) return;
    map.set(row.key, row.value !== undefined ? row.value : null);
  });
  return map;
}

function cloneSettingValue(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function ensureDefaults(keys = Object.keys(DEFAULT_SETTINGS)) {
  const settings = {};
  keys.forEach((key) => {
    settings[key] = cloneSettingValue(DEFAULT_SETTINGS[key]);
  });
  return settings;
}

async function fetchSettings(event, keys = Object.keys(DEFAULT_SETTINGS)) {
  const requested = Array.isArray(keys) && keys.length ? Array.from(new Set(keys)) : Object.keys(DEFAULT_SETTINGS);
  const fallback = ensureDefaults(requested);

  if (!hasSupabase()) {
    return { settings: fallback, source: 'fallback', supabase: supabaseStatus() };
  }

  try {
    const supabase = getSupabase(event);
    const { data, error } = await supabase
      .from('admin_settings')
      .select('key,value')
      .in('key', requested);

    if (error) throw error;
    const map = mapRows(data);
    const settings = {};
    const missing = [];
    requested.forEach((key) => {
      if (map.has(key)) settings[key] = map.get(key);
      else {
        settings[key] = cloneSettingValue(DEFAULT_SETTINGS[key]);
        missing.push(key);
      }
    });
    return { settings, source: 'supabase', missing, supabase: supabaseStatus() };
  } catch (err) {
    console.warn('[settings] fetch failed — falling back to defaults', err?.message || err);
    return { settings: fallback, source: 'fallback-error', error: err?.message || String(err), supabase: supabaseStatus() };
  }
}

async function saveSettings(event, entries = {}) {
  if (!hasSupabase()) {
    const err = new Error('Supabase client unavailable');
    err.code = 'supabase_unavailable';
    throw err;
  }
  const supabase = getSupabase(event);
  const rows = Object.entries(entries)
    .map(([key, value]) => ({ key, value }));
  if (!rows.length) return { data: [], supabase: supabaseStatus() };

  const { data, error } = await supabase
    .from('admin_settings')
    .upsert(rows, { onConflict: 'key' })
    .select('key,value,updated_at');

  if (error) throw error;
  return { data, supabase: supabaseStatus() };
}

function annotateWeeks(rows = [], baseEnding) {
  const base = baseEnding || DEFAULT_SETTINGS.fiscal_week1_ending;
  return rows.map((row) => ({
    ...row,
    week_no: fiscalWeekNumber(row.week_ending || row.weekEnding, base),
  }));
}

module.exports = {
  DEFAULT_SETTINGS,
  fetchSettings,
  saveSettings,
  fiscalWeekNumber,
  annotateWeeks,
  parseIsoDate,
};
