const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { createCandidateRunMatchBackgroundBaseHandler } = require('../../lib/admin-candidate-match-function.js');

exports.handler = withAdminCors(createCandidateRunMatchBackgroundBaseHandler({ getContextImpl: getContext }));
