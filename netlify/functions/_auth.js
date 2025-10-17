// Reads the Netlify Identity user from the function context
exports.getUser = (context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) throw new Error('Unauthorized');
  return user; // { email, sub, app_metadata, ... }
};
