// netlify/functions/_settings-helpers.js
// Centralised admin settings helper with Supabase + fallback support.
const { hasSupabase, getSupabase, supabaseStatus } = require('./_supabase.js');

const DEFAULT_SETTINGS = {
  fiscal_week1_ending: '2025-11-02', // Week 1 ends Sunday 2nd November 2025 by default
  fiscal_week_day: 'sunday',
  timesheet_deadline_note: 'Submit approved timesheets by Monday 10:00 (UK time) to guarantee payroll.',
  timesheet_deadline_timezone: 'Europe/London',
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

function ensureDefaults(keys = Object.keys(DEFAULT_SETTINGS)) {
  const settings = {};
  keys.forEach((key) => {
    settings[key] = DEFAULT_SETTINGS[key];
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
        settings[key] = DEFAULT_SETTINGS[key];
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
