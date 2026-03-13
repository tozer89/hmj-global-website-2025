const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { createCandidateMatchStatusBaseHandler } = require('../../lib/admin-candidate-match-function.js');

exports.handler = withAdminCors(createCandidateMatchStatusBaseHandler({ getContextImpl: getContext }));
