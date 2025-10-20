// admin-v2/functions/admin-candidate-get.js
// Alias so frontend calls to /admin-candidate-get keep working.
module.exports.handler = async (event, context) => {
  const impl = require('./admin-candidates-get.js'); // note the plural file
  return impl.handler(event, context);
};
