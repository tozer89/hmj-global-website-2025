'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  deleteUserCalendarConnection,
  trimString,
} = require('./_team-task-calendar.js');

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }
    const { user } = await getContext(event, context, { requireAdmin: true });
    await deleteUserCalendarConnection(event, {
      userId: trimString(user?.id || user?.sub, 240),
      email: trimString(user?.email, 320),
    });
    return response(200, {
      ok: true,
      message: 'Your Microsoft calendar connection was removed.',
    });
  } catch (error) {
    return response(Number(error?.code) || 500, {
      ok: false,
      error: error?.message || 'Unable to disconnect Microsoft calendar.',
    });
  }
});
