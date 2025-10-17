exports.handler = async () => {
  const csv = [
    "Contractor,Client,Project,WeekEnding,TotalHours,Status",
    "Lee Guerin,Smith & Nephew,Hull Pharma Fitout,2025-10-19,45,submitted",
    "Noel Colman,Acme Data Centre,Eemshaven DC,2025-10-19,40,draft"
  ].join("\n");
  return { statusCode: 200, body: JSON.stringify({ csv }) };
};
