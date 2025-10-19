// whoami.js — tiny diagnostic endpoint
const { requireAdmin } = require('./_guard.js');
const { ok, err } = require('./_lib.js');

exports.handler = async (event) => {
  try {
    const user = requireAdmin(event);
    return ok({ ok: true, who: { email: user.email, roles: user.roles } });
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
