export function requireAdmin(context){
  const user = context?.clientContext?.user;
  const roles = (user?.app_metadata?.roles || user?.roles || []);
  if (!user) throw { status: 401, message: 'No identity token' };
  if (!roles.includes('admin')) throw { status: 403, message: 'Admin only' };
  return user;
}
