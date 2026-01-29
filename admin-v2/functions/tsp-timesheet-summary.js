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

  const totals = {
    count: items.length,
    totalHours: 0,
    totalCharge: 0,
    byStatus: {},
  };

  items.forEach((timesheet) => {
    const status = (timesheet.status || timesheet.state || "unknown").toLowerCase();
    const hours = Number(timesheet.hours || timesheet.totalHours || timesheet.quantity || 0);
    const charge = Number(timesheet.totalCharge || timesheet.charge || timesheet.total || 0);

    totals.totalHours += Number.isFinite(hours) ? hours : 0;
    totals.totalCharge += Number.isFinite(charge) ? charge : 0;
    totals.byStatus[status] = (totals.byStatus[status] || 0) + 1;
  });

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
      summary: totals,
      ms: result.ms,
      meta: {
        endpoint: "/v2/rec/timesheets",
        pageSize: MAX_PAGE_SIZE,
      },
    }),
  };
};
