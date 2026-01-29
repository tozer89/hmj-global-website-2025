const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;
const DEFAULT_PLACEMENTS_PATH = "/placements";

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizePlacement = (placement, index) => {
  const id = placement.id || placement.placementId || placement.assignmentId || placement.uuid || `placement-${index + 1}`;
  const title = placement.title || placement.role || placement.position || placement.jobTitle || "Unknown Role";
  const clientName =
    placement.clientName ||
    placement.client ||
    placement.client_name ||
    placement.companyName ||
    placement.employer ||
    "Unknown Client";
  const startDate = placement.startDate || placement.start || placement.start_date || placement.startOn || null;
  const endDate = placement.endDate || placement.end || placement.end_date || placement.endOn || null;
  const status = normalizeStatus(placement.status || placement.state || placement.activeStatus || placement.isActive);

  return {
    id,
    title,
    clientName,
    startDate,
    endDate,
    status,
    raw: placement,
  };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.placements)) return payload.placements;
  if (payload && Array.isArray(payload.assignments)) return payload.assignments;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const statusParam = event.queryStringParameters?.status;
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const endpoint = (process.env.TSP_PLACEMENTS_PATH || DEFAULT_PLACEMENTS_PATH).trim() || DEFAULT_PLACEMENTS_PATH;

  const result = await tspFetch(endpoint, { query: { limit, status: statusParam } });
  if (!result.ok) {
    return {
      statusCode: result.status || 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        mode: result.mode,
        auth_mode: result.auth_mode,
        status: result.status,
        error: result.error,
        details: result.details,
        upstream: result.upstream,
        debug: result.debug,
      }),
    };
  }

  const items = extractArray(result.data);
  const normalized = items.map(normalizePlacement).slice(0, limit);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: result.mode,
      auth_mode: result.auth_mode,
      limit,
      status: statusParam || "all",
      count: normalized.length,
      placements: normalized.map(({ raw, ...placement }) => placement),
    }),
  };
};
