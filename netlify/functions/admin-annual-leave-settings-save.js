'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { saveSettings } = require('./_settings-helpers.js');
const { readAnnualLeaveSettings, roundHalf, toNumber, trimString } = (() => {
  const helpers = require('./_annual-leave.js');
  return {
    readAnnualLeaveSettings: helpers.readAnnualLeaveSettings,
    roundHalf: helpers.roundHalf,
    trimString: helpers.trimString,
    toNumber(value, fallback = 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
})();

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function parseBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

module.exports.handler = withAdminCors(async (event, context) => {
  const { roles } = await getContext(event, context, { requireAdmin: true });
  if (!Array.isArray(roles) || !roles.includes('owner')) {
    return {
      statusCode: 403,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        code: 'owner_required',
        message: 'Only Netlify owner-role users can edit annual leave owner controls.',
      }),
    };
  }

  const existing = await readAnnualLeaveSettings(event);
  const body = parseBody(event);
  const entitlementOverrides = Object.fromEntries(
    Object.entries(body.entitlementOverrides && typeof body.entitlementOverrides === 'object' ? body.entitlementOverrides : {})
      .map(([key, value]) => [trimString(key, 320), roundHalf(Math.max(0, toNumber(value, 0)))])
      .filter(([key]) => key)
  );

  const next = {
    ...existing,
    remindersEnabled: body.remindersEnabled !== false,
    overlapWarningThreshold: Math.max(1, Number.parseInt(String(body.overlapWarningThreshold || existing.overlapWarningThreshold || 2), 10) || 2),
    reminderRunHourLocal: Math.max(0, Math.min(23, Number.parseInt(String(body.reminderRunHourLocal || existing.reminderRunHourLocal || 8), 10) || 8)),
    defaultEntitlementDays: roundHalf(Math.max(0, toNumber(body.defaultEntitlementDays, existing.defaultEntitlementDays || 28))),
    entitlementOverrides,
  };

  await saveSettings(event, {
    annual_leave_settings: next,
  });

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      settings: next,
      message: 'Annual leave owner settings saved.',
    }),
  };
});
