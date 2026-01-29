// netlify/functions/contractor-profile.js
const { getContext } = require('./_timesheet-helpers.js');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'GET') return respond(405, { error: 'Method Not Allowed' });

    // Auth disabled; returns null contractor/assignment when unavailable.
    const { contractor, assignment } = await getContext(context);

    return respond(200, { contractor, assignment });
  } catch (e) {
    const msg = e?.message || 'contractor_unavailable';
    const status = 500;
    console.error('contractor-profile error:', e);
    return respond(status, { error: msg });
  }
};
