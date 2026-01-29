const { tspFetch } = require("./_lib/tsp");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.chargecodes)) return payload.chargecodes;
  if (payload && Array.isArray(payload.chargeCodes)) return payload.chargeCodes;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

const normalizeChargeCode = (code) => ({
  code: code.code || code.chargeCode || code.id,
  description: code.description || code.name || "—",
  status: code.status || code.state || "—",
});

exports.handler = async (event) => {
  const pageParam = parseInt(event.queryStringParameters?.page, 10);
  const pageSizeParam = parseInt(event.queryStringParameters?.pageSize, 10);
  const page = Number.isFinite(pageParam) ? Math.max(pageParam, 1) : DEFAULT_PAGE;
  const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(pageSizeParam, 1), 200) : DEFAULT_PAGE_SIZE;

  let result = await tspFetch("/v2/chargecodes", { query: { page, pageSize } });
  let endpoint = "/v2/chargecodes";
  let fallbackUsed = false;

  if (!result.ok) {
    fallbackUsed = true;
    endpoint = "/chargecodes";
    result = await tspFetch(endpoint, { query: { page, pageSize } });
  }

  const items = extractArray(result.data);
  const chargecodes = items.map(normalizeChargeCode);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      chargecodes,
      count: chargecodes.length,
      page,
      pageSize,
      ms: result.ms,
      raw: result.data ?? null,
      meta: {
        endpoint,
        fallbackUsed,
      },
    }),
  };
};
