const { tspFetch } = require("./_lib/tsp");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.costcentres)) return payload.costcentres;
  if (payload && Array.isArray(payload.costCenters)) return payload.costCenters;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

const normalizeCostCentre = (centre) => ({
  code: centre.code || centre.costCentreCode || centre.costCenterCode || centre.id,
  name: centre.name || centre.costCentreName || centre.costCenterName || "—",
  status: centre.status || centre.state || "—",
});

exports.handler = async (event) => {
  const pageParam = parseInt(event.queryStringParameters?.page, 10);
  const pageSizeParam = parseInt(event.queryStringParameters?.pageSize, 10);
  const page = Number.isFinite(pageParam) ? Math.max(pageParam, 1) : DEFAULT_PAGE;
  const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(pageSizeParam, 1), 200) : DEFAULT_PAGE_SIZE;

  const result = await tspFetch("/costcentres", { query: { page, pageSize } });
  const items = extractArray(result.data);
  const costcentres = items.map(normalizeCostCentre);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      costcentres,
      count: costcentres.length,
      page,
      pageSize,
      ms: result.ms,
      raw: result.data ?? null,
      meta: {
        endpoint: "/costcentres",
      },
    }),
  };
};
