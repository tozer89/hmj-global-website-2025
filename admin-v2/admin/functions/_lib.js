// _lib.js
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
export const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'docs';

export function supa() {
  return createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function ok(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? null) };
}
export function err(message, statusCode = 400) {
  return ok({ error: String(message) }, statusCode);
}

export function parseBody(event) {
  try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
}

/** Get Netlify Identity user & roles from function context */
export function getIdentity(context, event) {
  // Preferred: Netlify injects Identity info here if a valid bearer token is present
  const user = context?.clientContext?.user || null;
  const roles = (user?.app_metadata?.roles || user?.roles || []);
  return { user, roles };
}

export function requireAdmin(context, event) {
  const { user, roles } = getIdentity(context, event);
  if (!user) throw { status: 401, message: 'No identity token' };
  if (!roles.includes('admin')) throw { status: 403, message: 'Admin only' };
  return user;
}

/** Simple pagination helper */
export function qPaginate({ page=1, pageSize=20 }) {
  const from = Math.max(0, (Number(page)-1) * Number(pageSize));
  const to   = from + Number(pageSize) - 1;
  return { from, to };
}

/** Lightweight audit trail (optional) */
export async function auditLog({ entity, entity_id, action, actor_email, meta }) {
  const db = supa();
  await db.from('audit').insert([{ entity, entity_id, action, actor_email, meta }]).select();
}
