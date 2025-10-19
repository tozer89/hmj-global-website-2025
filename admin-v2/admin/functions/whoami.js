import { requireAdmin } from './_guard.js';

export async function handler(event, context){
  try{
    const user = requireAdmin(context);
    return { statusCode: 200, body: JSON.stringify({ email: user.email, roles: user.app_metadata?.roles || [] }) };
  }catch(e){
    return { statusCode: e.status || 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
}
