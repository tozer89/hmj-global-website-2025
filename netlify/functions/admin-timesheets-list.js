exports.handler = async (event) => {
  // You can inspect filters here if you want:
  // const { status, client_id } = JSON.parse(event.body || "{}");

  const rows = [
    { id: "ts_1001", contractor_name: "Lee Guerin", client_name: "Smith & Nephew", project_name: "Hull Pharma Fitout",
      week_ending: "2025-10-19", total_hours: 45, status: "submitted" },
    { id: "ts_1002", contractor_name: "Noel Colman", client_name: "Acme Data Centre", project_name: "Eemshaven DC",
      week_ending: "2025-10-19", total_hours: 40, status: "draft" }
  ];
  return { statusCode: 200, body: JSON.stringify(rows) };
};
