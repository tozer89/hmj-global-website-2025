// _guard.js — Netlify Identity admin guard (CommonJS)
const jwt = require('jsonwebtoken');

function readBearer(event) {
  const h = (event && (event.headers || {})) || {};
  const auth = h.authorization || h.Authorization || '';
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function requireAdmin(event) {
  const token = readBearer(event);
  if (!token) {
    const e = new Error('Missing token'); e.status = 401; throw e;
  }
  // We just decode to read roles; Netlify Identity (GoTrue) JWT
  const payload = jwt.decode(token) || {};
  const roles = (payload.app_metadata && payload.app_metadata.roles) || payload.roles || [];
  if (!Array.isArray(roles) || !roles.includes('admin')) {
    const e = new Error('Admin role required'); e.status = 403; throw e;
  }
  return {
    token,
    email: payload.email || '',
    sub: payload.sub || payload.user_id || '',
    roles
  };
}

module.exports = { requireAdmin };
