// netlify/functions/public-settings.js
// Exposes a read-only subset of configuration used by public pages (no auth).
const { fetchSettings, DEFAULT_SETTINGS } = require('./_settings-helpers.js');

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=300',
};

exports.handler = async (event) => {
  try {
    const keys = ['fiscal_week1_ending', 'timesheet_deadline_note', 'timesheet_deadline_timezone'];
    const { settings, source, supabase, error } = await fetchSettings(event, keys);

    const safe = {
      week1Ending: settings.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending,
      deadlineNote: settings.timesheet_deadline_note || DEFAULT_SETTINGS.timesheet_deadline_note,
      deadlineTimezone: settings.timesheet_deadline_timezone || DEFAULT_SETTINGS.timesheet_deadline_timezone,
    };

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, settings: safe, source, supabase, error }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: err?.message || 'settings_failed' }),
    };
  }
};
