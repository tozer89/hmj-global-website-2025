exports.handler = async (event) => {
  const { id } = JSON.parse(event.body || "{}");
  if (!id) return { statusCode: 400, body: "Missing id" };

  // Demo payload; replace with DB lookup later
  const demo = {
    id,
    contractor_name: id === "ts_1001" ? "Lee Guerin" : "Noel Colman",
    client_name: id === "ts_1001" ? "Smith & Nephew" : "Acme Data Centre",
    project_name: id === "ts_1001" ? "Hull Pharma Fitout" : "Eemshaven DC",
    week_ending: "2025-10-19",
    status: id === "ts_1001" ? "submitted" : "draft",
    entries: {
      Sun:{std:0,ot:0,note:""},
      Mon:{std:9.5,ot:0,note:""},
      Tue:{std:9.5,ot:0,note:""},
      Wed:{std:9.5,ot:0,note:""},
      Thu:{std:9.5,ot:0,note:""},
      Fri:{std:9.5,ot:0,note:""},
      Sat:{std:6,ot:0,note:""}
    }
  };

  return { statusCode: 200, body: JSON.stringify(demo) };
};
