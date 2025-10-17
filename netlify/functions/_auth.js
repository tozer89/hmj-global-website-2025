// netlify/functions/_auth.js
// Simple, dependency-free helper.
// Netlify verifies the JWT and injects the user on context.clientContext.user.

function unauthorized(message = 'Unauthorized') {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
}

exports.getUser = (context) => {
  const user = context?.clientContext?.user;
  if (!user) throw unauthorized();
  // user.email, user.app_metadata, etc. are available here.
  return user;
};
