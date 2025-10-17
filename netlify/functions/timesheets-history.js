exports.handler = async () => {
  const history = [
    { week_ending: "2025-10-12", project_name: "Hull Pharma Fitout", total_hours: 44, status: "approved" },
    { week_ending: "2025-10-05", project_name: "Hull Pharma Fitout", total_hours: 42, status: "approved" }
  ];
  return { statusCode: 200, body: JSON.stringify(history) };
};
