// /.netlify/functions/admin-timesheets-remind
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');

module.exports.handler = withSupabase(async ({ event, supabase, trace }) => {
  let week_ending = null;
  let dryRun = true;

  if (event.httpMethod === 'POST' && event.body) {
    try {
      const b = JSON.parse(event.body || '{}');
      week_ending = b.week_ending || null;
      dryRun = (b.dryRun !== false); // default true
    } catch {}
  }

  // Default to last Saturday (UTC)
  if (!week_ending) {
    const d = new Date();
    const day = d.getUTCDay();         // 0..6 (Sun..Sat)
    const diff = (day + 1) % 7;         // days since Saturday
    d.setUTCDate(d.getUTCDate() - diff);
    week_ending = d.toISOString().slice(0, 10);
  }

  // Fetch rows from admin view for that week
  const { data, error } = await supabase
    .from('v_timesheets_admin')
    .select('id, status, week_ending, contractor_email, client_name, project_name')
    .eq('week_ending', week_ending);

  if (error) return jsonError(500, 'query_failed', error.message, { trace });

  // “Unsubmitted” = not submitted/approved
  const recipients = (data || [])
    .filter(r => !['submitted', 'approved'].includes(String(r.status || '').toLowerCase()))
    .map(r => ({
      email: r.contractor_email,
      week_ending: r.week_ending,
      client: r.client_name,
      project: r.project_name,
      timesheet_id: r.id
    }))
    .filter(r => !!r.email);

  if (dryRun) {
    return jsonOk({ ok: true, mode: 'dryRun', count: recipients.length, week_ending, recipients, trace });
  }

  // TODO: wire your mailer here, e.g. Resend/Postmark/SES/etc.

  // Audit (best-effort)
  await supabase.from('admin_audit_logs').insert({
    actor_email: (event.clientContext && event.clientContext.user && event.clientContext.user.email) || 'admin',
    action: 'timesheet_reminder_sent',
    target_type: 'bulk',
    target_id: week_ending,
    meta: { count: recipients.length }
  });

  return jsonOk({ ok: true, mode: 'live', count: recipients.length, week_ending, trace });
});
