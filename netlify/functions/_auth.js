// netlify/functions/_auth.js
exports.getUser = (context) => {
  const user = context?.clientContext?.user;
  if (!user) throw new Error('Unauthorized');
  return user;
};
