// netlify/functions/_auth.js
function getUser(context) {
  const user = context?.clientContext?.user;
  if (!user) throw new Error('Unauthorized');
  return user;
}
module.exports = { getUser };
