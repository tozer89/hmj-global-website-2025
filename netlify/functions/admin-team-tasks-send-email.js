'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { fetchSettings } = require('./_settings-helpers.js');
const {
  TEAM_TASKS_SETTINGS_KEY,
  normalizeTaskSettings,
  buildTaskRecipients,
  buildAssignmentEmail,
  buildReminderEmail,
  dedupeReminderRecipients,
  memberDisplayName,
  trimString,
  lowerEmail,
} = require('./_team-tasks-helpers.js');
const { resolveTeamTaskEmailConfig, sendTeamTaskEmail } = require('./_team-task-email.js');

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

function resolveAction(value) {
  const action = trimString(value, 40).toLowerCase();
  return ['assignment', 'reminder'].includes(action) ? action : '';
}

async function loadTaskBundle(supabase, taskId) {
  const [taskResult, watchersResult] = await Promise.all([
    supabase.from('task_items').select('*').eq('id', taskId).single(),
    supabase.from('task_watchers').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
  ]);
  const firstError = [taskResult.error, watchersResult.error].find(Boolean);
  if (firstError) throw firstError;
  return {
    task: taskResult.data || null,
    watchers: Array.isArray(watchersResult.data) ? watchersResult.data : [],
  };
}

function assignmentRecipients(task = {}) {
  const email = lowerEmail(task.assigned_to_email);
  if (!email) return [];
  return [{
    userId: trimString(task.assigned_to, 120),
    email,
    displayName: memberDisplayName({
      userId: task.assigned_to,
      email: task.assigned_to_email,
    }),
  }];
}

async function recordNotificationAudit(supabase, {
  taskId,
  actionType,
  actor,
  metadata,
}) {
  try {
    await supabase.from('task_audit_log').insert({
      task_id: trimString(taskId, 120) || null,
      action_type: actionType,
      actor_user_id: trimString(actor?.userId, 120) || null,
      actor_email: lowerEmail(actor?.email) || null,
      entity_type: 'task',
      entity_id: trimString(taskId, 120) || null,
      source_action: 'admin-team-tasks-send-email',
      old_data: {},
      new_data: {},
      metadata: metadata || {},
    });
  } catch (error) {
    console.warn('[team-task-email] audit log write failed (%s)', error?.message || error);
  }
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const body = JSON.parse(event.body || '{}');
    const action = resolveAction(body.action);
    const taskId = trimString(body.taskId, 120);
    const force = body.force === true;

    if (!action || !taskId) {
      return json(400, {
        ok: false,
        code: 'invalid_payload',
        message: 'action and taskId are required.',
      });
    }

    const supabase = getSupabase(event);
    const [settingsResult, bundle, emailConfig] = await Promise.all([
      fetchSettings(event, [TEAM_TASKS_SETTINGS_KEY]),
      loadTaskBundle(supabase, taskId),
      resolveTeamTaskEmailConfig(event),
    ]);
    const settings = normalizeTaskSettings(settingsResult?.settings?.[TEAM_TASKS_SETTINGS_KEY]);
    const task = bundle.task;
    if (!task) {
      return json(404, {
        ok: false,
        code: 'task_not_found',
        message: 'Task not found.',
      });
    }

    if (!emailConfig.ready) {
      return json(409, {
        ok: false,
        code: 'team_task_email_not_ready',
        message: emailConfig.message,
      });
    }

    if (action === 'assignment' && settings.assignmentEmailNotifications === false && !force) {
      return json(200, {
        ok: true,
        action,
        sent: 0,
        skipped: 1,
        message: 'Assignment emails are disabled in Team Tasks settings.',
      });
    }

    const actor = {
      userId: trimString(user?.id || user?.sub, 120),
      email: lowerEmail(user?.email),
      displayName: memberDisplayName(user?.user_metadata || { email: user?.email, userId: user?.id || user?.sub }),
    };

    const recipients = action === 'assignment'
      ? assignmentRecipients(task)
      : dedupeReminderRecipients(buildTaskRecipients({
        task,
        watchers: bundle.watchers,
        mode: settings.reminderRecipientMode,
      }));

    if (!recipients.length) {
      return json(400, {
        ok: false,
        code: 'recipient_missing',
        message: action === 'assignment'
          ? 'The task assignee does not have an email address yet.'
          : 'No reminder recipients are available for this task.',
      });
    }

    const summary = {
      ok: true,
      action,
      sent: 0,
      skipped: 0,
      recipients: [],
      provider: emailConfig.preferredProvider,
    };

    for (const recipient of recipients) {
      const message = action === 'assignment'
        ? buildAssignmentEmail({
          task,
          recipient,
          actor,
          siteUrl: emailConfig.siteUrl,
        })
        : buildReminderEmail({
          task,
          recipient,
          siteUrl: emailConfig.siteUrl,
        });

      const result = await sendTeamTaskEmail({
        event,
        emailConfig,
        toEmail: recipient.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      summary.sent += 1;
      summary.recipients.push(recipient.email);
      await recordNotificationAudit(supabase, {
        taskId,
        actionType: action === 'assignment' ? 'assignment_email_sent' : 'reminder_email_sent',
        actor,
        metadata: {
          recipient_email: recipient.email,
          provider: result.delivery?.provider || emailConfig.preferredProvider,
          delivery_id: result.delivery?.id || null,
          manual: true,
        },
      });
    }

    summary.message = action === 'assignment'
      ? `Assignment email accepted for delivery to ${summary.sent} recipient${summary.sent === 1 ? '' : 's'}.`
      : `Reminder email accepted for delivery to ${summary.sent} recipient${summary.sent === 1 ? '' : 's'}.`;

    return json(200, summary);
  } catch (error) {
    return json(error?.code === 401 ? 401 : error?.code === 403 ? 403 : 500, {
      ok: false,
      code: error?.code || 'team_task_email_send_failed',
      message: error?.message || 'Unable to send the Team Tasks email.',
    });
  }
});
