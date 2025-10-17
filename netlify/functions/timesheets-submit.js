exports.handler = async (event) => {
  const payload = JSON.parse(event.body || "{}");
  console.log("SUBMIT", payload);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
