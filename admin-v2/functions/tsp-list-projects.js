const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;
const DEFAULT_PROJECTS_PATH = "/projects";

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizeProject = (project, index) => {
  const id = project.id || project.projectId || project.uuid || `project-${index + 1}`;
  const name = project.name || project.projectName || project.title || project.description || "Unknown Project";
  const clientName =
    project.clientName ||
    project.client ||
    project.client_name ||
    project.companyName ||
    project.employer ||
    "Unknown Client";
  const status = normalizeStatus(project.status || project.state || project.activeStatus || project.isActive);

  return { id, name, clientName, status, raw: project };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.projects)) return payload.projects;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const endpoint = (process.env.TSP_PROJECTS_PATH || DEFAULT_PROJECTS_PATH).trim() || DEFAULT_PROJECTS_PATH;

  const result = await tspFetch(endpoint, { query: { limit } });
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
  const normalized = items.map(normalizeProject).slice(0, limit);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: result.mode,
      auth_mode: result.auth_mode,
      limit,
      count: normalized.length,
      projects: normalized.map(({ raw, ...project }) => project),
    }),
  };
};
