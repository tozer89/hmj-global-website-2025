const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;
const DEFAULT_PLACEMENTS_PATH = "/placements";
const FALLBACK_PLACEMENTS_PATHS = ["/assignments", "/clientassignments"];

let resolvedPlacementsEndpoint = null;

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

const normalizeEndpoint = (endpoint) => {
  if (!endpoint) return null;
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
};

const buildEndpointCandidates = (primary) => {
  const normalizedPrimary = normalizeEndpoint(primary) || DEFAULT_PLACEMENTS_PATH;
  const candidates = [normalizedPrimary, ...FALLBACK_PLACEMENTS_PATHS];
  return Array.from(new Set(candidates.map((value) => normalizeEndpoint(value)))).filter(Boolean);
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const statusParam = event.queryStringParameters?.status;
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const configuredPath = (process.env.TSP_PLACEMENTS_PATH || DEFAULT_PLACEMENTS_PATH).trim() || DEFAULT_PLACEMENTS_PATH;

  const candidates = buildEndpointCandidates(configuredPath);
  const endpointsToTry = resolvedPlacementsEndpoint
    ? [resolvedPlacementsEndpoint, ...candidates.filter((item) => item !== resolvedPlacementsEndpoint)]
    : candidates;

  const attempted = [];
  let lastResult = null;

  for (const endpoint of endpointsToTry) {
    attempted.push(endpoint);
    const result = await tspFetch(endpoint, { query: { limit, status: statusParam } });
    if (result.ok) {
      resolvedPlacementsEndpoint = endpoint;
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
          resolved_endpoint: endpoint,
          attempted_endpoints: attempted,
          placements: normalized.map(({ raw, ...placement }) => placement),
        }),
      };
    }

    lastResult = result;

    if (result.status !== 404) {
      break;
    }
  }

  return {
    statusCode: lastResult?.status || 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: false,
      mode: lastResult?.mode,
      auth_mode: lastResult?.auth_mode,
      status: lastResult?.status,
      error: lastResult?.error || "Placements endpoint not found",
      details: lastResult?.details,
      upstream: lastResult?.upstream,
      debug: lastResult?.debug,
      resolved_endpoint: resolvedPlacementsEndpoint,
      attempted_endpoints: attempted,
    }),
  };
};
