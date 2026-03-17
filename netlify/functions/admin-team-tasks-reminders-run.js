'use strict';

const { getSupabase } = require('./_supabase.js');
const {
  buildReminderEmail,
  trimString,
  lowerEmail,
} = require('./_team-tasks-helpers.js');
const { resolveTeamTaskEmailConfig, sendTeamTaskEmail } = require('./_team-task-email.js');

function header(event, name) {
  const headers = event?.headers || {};
  if (headers[name]) return headers[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function isScheduledInvocation(event) {
  const signal = String(
    header(event, 'x-netlify-event')
      || header(event, 'x-nf-event')
      || ''
  ).toLowerCase();
  return signal.includes('schedule');
}

function isAuthorisedManualInvocation(event) {
  const expected = trimString(process.env.TASK_REMINDER_CRON_SECRET, 320);
  if (!expected) return false;
  const provided = trimString(
    header(event, 'x-hmj-cron-secret')
      || event?.queryStringParameters?.secret
      || '',
    320
  );
  return !!provided && provided === expected;
}

async function loadDueReminders(supabase, limit) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('task_reminders')
    .select(`
      id,
      task_id,
      recipient_user_id,
      recipient_email,
      reminder_mode,
      send_at,
      sent_at,
      status,
      failure_reason,
      task_items (
        id,
        title,
        description,
        status,
        priority,
        due_at,
        assigned_to,
        assigned_to_email
      )
    `)
    .eq('status', 'pending')
    .is('sent_at', null)
    .lte('send_at', nowIso)
    .order('send_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function claimReminder(supabase, reminderId) {
  const { data, error } = await supabase
    .from('task_reminders')
    .update({
      status: 'processing',
      failure_reason: null,
    })
    .eq('id', reminderId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return !!data?.id;
}

async function markReminderSent(supabase, reminderId) {
  const { error } = await supabase
    .from('task_reminders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq('id', reminderId);

  if (error) throw error;
}

async function markReminderFailed(supabase, reminderId, reason) {
  const { error } = await supabase
    .from('task_reminders')
    .update({
      status: 'failed',
      failure_reason: trimString(reason, 500) || 'unknown_failure',
    })
    .eq('id', reminderId);

  if (error) throw error;
}

async function sendTaskReminderEmail({ event, emailConfig, reminder }) {
  const task = reminder?.task_items || {};
  const recipientEmail = lowerEmail(reminder?.recipient_email);
  if (!recipientEmail) {
    const error = new Error('Reminder recipient email is missing.');
    error.code = 'reminder_recipient_missing';
    throw error;
  }

  const message = buildReminderEmail({
    task: {
      ...task,
      taskPath: task?.id ? `/admin/team-tasks.html?task=${encodeURIComponent(task.id)}` : '',
    },
    recipient: {
      email: recipientEmail,
      displayName: recipientEmail,
    },
    siteUrl: emailConfig.siteUrl,
  });
  const sent = await sendTeamTaskEmail({
    event,
    emailConfig,
    toEmail: recipientEmail,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return {
    recipientEmail,
    delivery: sent.delivery,
  };
}

async function recordReminderAudit(supabase, reminder, metadata = {}) {
  try {
    await supabase.from('task_audit_log').insert({
      task_id: trimString(reminder?.task_id, 120) || null,
      action_type: 'reminder_email_sent',
      actor_user_id: 'system',
      actor_email: 'system@hmj-global.com',
      entity_type: 'reminder',
      entity_id: trimString(reminder?.id, 120) || null,
      source_action: 'admin-team-tasks-reminders-run',
      old_data: {},
      new_data: {},
      metadata,
    });
  } catch (error) {
    console.warn('[team-task-reminders] audit log write failed (%s)', error?.message || error);
  }
}

exports.handler = async (event = {}) => {
  const scheduled = isScheduledInvocation(event);
  const authorised = scheduled || isAuthorisedManualInvocation(event);

  if (!authorised) {
    return json(403, {
      ok: false,
      code: 'forbidden',
      message: 'Team Tasks reminder runner requires a scheduled invocation or cron secret.',
    });
  }

  let limit = 25;
  let dryRun = false;
  if (event.body) {
    try {
      const payload = JSON.parse(event.body || '{}');
      if (payload.limit) {
        limit = Math.max(1, Math.min(100, Number(payload.limit)));
      }
      dryRun = payload.dryRun === true;
    } catch {}
  }

  try {
    const supabase = getSupabase(event);
    const emailConfig = await resolveTeamTaskEmailConfig(event);

    const reminders = await loadDueReminders(supabase, limit);
    if (dryRun) {
      return json(200, {
        ok: true,
        mode: 'dry-run',
        count: reminders.length,
        reminderIds: reminders.map((row) => row.id),
      });
    }

    const summary = {
      ok: true,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      reminderIds: [],
    };

    for (const reminder of reminders) {
      const claimed = await claimReminder(supabase, reminder.id);
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      summary.processed += 1;
      summary.reminderIds.push(reminder.id);

      try {
        const result = await sendTaskReminderEmail({ event, emailConfig, reminder });
        await markReminderSent(supabase, reminder.id);
        await recordReminderAudit(supabase, reminder, {
          recipient_email: result.recipientEmail,
          provider: result.delivery?.provider || emailConfig.preferredProvider,
          delivery_id: result.delivery?.id || null,
        });
        summary.sent += 1;
      } catch (error) {
        await markReminderFailed(supabase, reminder.id, error?.message || 'Reminder send failed');
        summary.failed += 1;
      }
    }

    return json(200, summary);
  } catch (error) {
    return json(500, {
      ok: false,
      code: error?.code || 'team_tasks_reminders_failed',
      message: error?.message || 'Unable to process Team Tasks reminders.',
    });
  }
};
