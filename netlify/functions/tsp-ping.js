exports.handler = async () => {
  const responseBody = {
    ok: true,
    tsp_base_url_present: Boolean(process.env.TSP_BASE_URL),
    tsp_api_key_present: Boolean(process.env.TSP_API_KEY),
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(responseBody),
  };
};
