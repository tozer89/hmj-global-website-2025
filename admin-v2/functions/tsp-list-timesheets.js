const { tspFetch } = require("./_lib/tsp");

const DEFAULT_DAYS = 14;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

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

const normalizeTimesheet = (timesheet) => ({
  timesheetId: timesheet.timesheetId || timesheet.id || timesheet.guid || timesheet.timesheetGuid || "—",
  employeeName:
    timesheet.employeeName ||
    timesheet.employeeFullName ||
    timesheet.employee?.name ||
    `${timesheet.employeeFirstName || ""} ${timesheet.employeeLastName || ""}`.trim() ||
    "—",
  clientName: timesheet.clientName || timesheet.client || timesheet.companyName || timesheet.company || "—",
  date: toDateString(timesheet.date || timesheet.timesheetDate || timesheet.startDate || timesheet.endDate) || "—",
  status: timesheet.status || timesheet.state || "—",
  hours: Number(timesheet.hours || timesheet.totalHours || timesheet.quantity || 0),
  chargeRate: Number(timesheet.chargeRate || timesheet.rate || timesheet.payRate || 0),
  totalCharge: Number(timesheet.totalCharge || timesheet.charge || timesheet.total || 0),
});

exports.handler = async (event) => {
  const daysParam = parseInt(event.queryStringParameters?.days, 10);
  const pageParam = parseInt(event.queryStringParameters?.page, 10);
  const pageSizeParam = parseInt(event.queryStringParameters?.pageSize, 10);
  const days = Number.isFinite(daysParam) ? Math.max(daysParam, 1) : DEFAULT_DAYS;
  const page = Number.isFinite(pageParam) ? Math.max(pageParam, 1) : DEFAULT_PAGE;
  const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(pageSizeParam, 1), 200) : DEFAULT_PAGE_SIZE;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const query = {
    page,
    pageSize,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
  };

  const result = await tspFetch("/v2/rec/timesheets", { query });
  const items = extractArray(result.data);
  const timesheets = items.map(normalizeTimesheet);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      timesheets,
      count: timesheets.length,
      page,
      pageSize,
      days,
      range: {
        startDate: query.startDate,
        endDate: query.endDate,
      },
      ms: result.ms,
      raw: result.data ?? null,
      meta: {
        endpoint: "/v2/rec/timesheets",
      },
    }),
  };
};
