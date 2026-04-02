// netlify/functions/public-settings.js
// Exposes a read-only subset of configuration used by public pages (no auth).
const { fetchSettings, DEFAULT_SETTINGS } = require('./_settings-helpers.js');
const { publicWidgetSettings, normaliseSettings } = require('../../lib/credit-limit-checker.js');

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=60',
};

const TESTIMONIAL_PLACEHOLDER_PATTERNS = [
  /recommendation pending/i,
  /nick to copy/i,
  /job title pending/i,
  /company pending/i,
  /^linkedin recommender\b/i,
];

function trimText(value, maxLength = 4000) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  return text.slice(0, maxLength);
}

function containsPlaceholderText(value) {
  const text = trimText(value, 400).toLowerCase();
  return !!text && TESTIMONIAL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitisePublicTestimonials(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const items = Array.isArray(input.items) ? input.items : [];

  return {
    enabled: input.enabled !== false,
    items: items
      .map((item, index) => ({
        id: trimText(item?.id, 120) || `testimonial-${index + 1}`,
        text: trimText(item?.text, 4000),
        name: trimText(item?.name, 160),
        title: trimText(item?.title, 160),
        company: trimText(item?.company, 160),
        linkedinUrl: trimText(item?.linkedinUrl, 2000),
        imageUrl: trimText(item?.imageUrl, 2000),
        imageStorageKey: trimText(item?.imageStorageKey, 500),
        imageAltText: trimText(item?.imageAltText, 160),
        source: trimText(item?.source, 120) || 'LinkedIn Recommendation',
      }))
      .filter((item) => item.text && item.name)
      .filter((item) => ![item.text, item.name, item.title, item.company].some(containsPlaceholderText)),
  };
}

exports.handler = async (event) => {
  try {
    const keys = [
      'fiscal_week1_ending',
      'timesheet_deadline_note',
      'timesheet_deadline_timezone',
      'linkedin_testimonials',
      'credit_checker_settings',
    ];
    const { settings, source, supabase, error } = await fetchSettings(event, keys);
    const creditCheckerSettings = normaliseSettings(
      settings.credit_checker_settings || DEFAULT_SETTINGS.credit_checker_settings
    );

    const safe = {
      week1Ending: settings.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending,
      deadlineNote: settings.timesheet_deadline_note || DEFAULT_SETTINGS.timesheet_deadline_note,
      deadlineTimezone: settings.timesheet_deadline_timezone || DEFAULT_SETTINGS.timesheet_deadline_timezone,
      linkedinTestimonials: sanitisePublicTestimonials(
        settings.linkedin_testimonials || DEFAULT_SETTINGS.linkedin_testimonials
      ),
      creditChecker: publicWidgetSettings(creditCheckerSettings),
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
