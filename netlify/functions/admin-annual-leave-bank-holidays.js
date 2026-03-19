'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { DEFAULT_REGION, getBankHolidays, normaliseRegion, readAnnualLeaveSettings } = require('./_annual-leave.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function parseYear(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
  return new Date().getUTCFullYear();
}

module.exports.handler = withAdminCors(async (event, context) => {
  await getContext(event, context, { requireAdmin: true });
  const query = event?.queryStringParameters || {};
  const settings = await readAnnualLeaveSettings(event);
  const region = normaliseRegion(query.region || settings.defaultRegion || DEFAULT_REGION);
  const year = parseYear(query.year);
  const bundle = await getBankHolidays(event, {
    supabase: getSupabase(event),
    region,
    year,
    settings,
    forceRefresh: String(query.refresh || '').trim() === '1',
  });

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      region,
      year,
      source: bundle.source,
      fetchedAt: bundle.fetchedAt || '',
      warning: bundle.warning || '',
      rows: bundle.holidays || [],
    }),
  };
});
