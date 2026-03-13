const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { createCandidateHistoryListBaseHandler } = require('../../lib/admin-candidate-match-function.js');

exports.handler = withAdminCors(createCandidateHistoryListBaseHandler({ getContextImpl: getContext }));
