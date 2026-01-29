const { tspFetch } = require("./_lib/tsp");

const DEFAULT_DAYS = 14;
const MAX_PAGE_SIZE = 200;

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.timesheets)) return payload.timesheets;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

const toDateString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

exports.handler = async (event) => {
  const daysParam = parseInt(event.queryStringParameters?.days, 10);
  const days = Number.isFinite(daysParam) ? Math.max(daysParam, 1) : DEFAULT_DAYS;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const query = {
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
  };

  const result = await tspFetch("/v2/rec/timesheets", { query });
  const items = extractArray(result.data);

  const totalsByClient = items.reduce((acc, timesheet) => {
    const client =
      timesheet.clientName || timesheet.client || timesheet.companyName || timesheet.company || "Unknown Client";
    const charge = Number(timesheet.totalCharge || timesheet.charge || timesheet.total || 0);
    if (!acc[client]) {
      acc[client] = { client, count: 0, totalCharge: 0 };
    }
    acc[client].count += 1;
    acc[client].totalCharge += Number.isFinite(charge) ? charge : 0;
    return acc;
  }, {});

  const topClients = Object.values(totalsByClient)
    .sort((a, b) => b.totalCharge - a.totalCharge)
    .slice(0, 10);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      days,
      range: {
        startDate: query.startDate,
        endDate: query.endDate,
      },
      clients: topClients,
      ms: result.ms,
      meta: {
        endpoint: "/v2/rec/timesheets",
        pageSize: MAX_PAGE_SIZE,
      },
    }),
  };
};
