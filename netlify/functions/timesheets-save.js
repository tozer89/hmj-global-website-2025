exports.handler = async (event) => {
  // Just echo back for now
  const payload = JSON.parse(event.body || "{}");
  console.log("SAVE draft", payload);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
