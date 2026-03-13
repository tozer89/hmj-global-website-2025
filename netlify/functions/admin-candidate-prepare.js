const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { createCandidatePrepareBaseHandler } = require('../../lib/admin-candidate-match-function.js');

exports.handler = withAdminCors(createCandidatePrepareBaseHandler({ getContextImpl: getContext }));
