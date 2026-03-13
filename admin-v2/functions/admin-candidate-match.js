const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { createCandidateMatchBaseHandler } = require('../../lib/admin-candidate-match-function.js');

exports.handler = withAdminCors(createCandidateMatchBaseHandler({ getContextImpl: getContext }));
