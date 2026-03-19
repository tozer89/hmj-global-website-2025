'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { listAdminUsers, trimString } = require('./_annual-leave.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const rows = await listAdminUsers(event, context, { currentUser: user });
  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      rows: rows.map((row) => ({
        userId: trimString(row.userId, 120),
        email: trimString(row.email, 320),
        displayName: trimString(row.displayName, 160) || trimString(row.email, 320),
        role: trimString(row.role, 40) || 'admin',
      })),
    }),
  };
});
