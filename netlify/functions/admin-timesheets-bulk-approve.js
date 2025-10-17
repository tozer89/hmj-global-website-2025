exports.handler = async (event) => {
  const { ids } = JSON.parse(event.body || "{}");
  return { statusCode: 200, body: JSON.stringify({ ok: true, count: (ids || []).length }) };
};
