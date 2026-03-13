const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { createCandidateRunMatchBaseHandler } = require('../../lib/admin-candidate-match-function.js');

exports.handler = withAdminCors(createCandidateRunMatchBaseHandler({ getContextImpl: getContext }));
