exports.handler = async () => {
  // Demo list so filters work
  return {
    statusCode: 200,
    body: JSON.stringify([
      { id: 1, name: "Smith & Nephew" },
      { id: 2, name: "Acme Data Centre" },
      { id: 3, name: "Winthrop Technologies" }
    ])
  };
};
