exports.handler = async () => {
  // Static demo payload so the page renders
  return {
    statusCode: 200,
    body: JSON.stringify({
      contractor: { id: 1, name: "Demo Contractor", email: "demo@hmj-global.com" },
      assignment: {
        id: 11, project_name: "Hull Pharma Fitout", client_name: "Smith & Nephew",
        rate_std: 25, rate_ot: 35
      },
      week_ending: "2025-10-19",
      status: "draft",
      entries: {
        Mon:{std:8,ot:0,note:""}, Tue:{std:8,ot:0,note:""}, Wed:{std:8,ot:0,note:""},
        Thu:{std:8,ot:0,note:""}, Fri:{std:8,ot:0,note:""}, Sat:{std:0,ot:0,note:""},
        Sun:{std:0,ot:0,note:""}
      }
    })
  };
};
