// netlify/functions/_audit.js
// Shared helper to record audit entries without crashing when optional columns are missing.

const { supabase } = require('./_supabase.js');

function normaliseTarget(targetId) {
  if (targetId === null || targetId === undefined) return null;
  if (typeof targetId === 'object') {
    if ('id' in targetId) return normaliseTarget(targetId.id);
    return JSON.stringify(targetId);
  }
  return String(targetId);
}

async function recordAudit({ actor, action, targetType, targetId, meta }) {
  try {
    if (!supabase || typeof supabase.from !== 'function') return;
    const payload = {
      actor_email: actor?.email || actor?.user_metadata?.email || null,
      actor_id: actor?.id || actor?.sub || actor?.user_metadata?.id || null,
      action: action || 'unknown',
      target_type: targetType || 'unknown',
      target_id: normaliseTarget(targetId),
      meta: meta || null,
    };
    await supabase.from('admin_audit_logs').insert(payload);
  } catch (err) {
    console.error('[audit] failed to record audit entry:', err?.message || err);
  }
}

module.exports = { recordAudit };
