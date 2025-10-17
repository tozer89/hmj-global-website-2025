exports.handler = async (event) => {
  const { id } = JSON.parse(event.body || "{}");
  if (!id) return { statusCode: 400, body: "Missing id" };
  return { statusCode: 200, body: JSON.stringify({ ok: true, id, status: "approved" }) };
};
