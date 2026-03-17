'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { fetchSettings } = require('./_settings-helpers.js');
const {
  TEAM_TASKS_SETTINGS_KEY,
  TASK_ACTIVITY_TYPES,
  normalizeTaskSettings,
  buildTaskRecipients,
  buildTaskActivityEmail,
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

function sameRecipient(left = {}, right = {}) {
  const leftUser = trimString(left.userId || left.user_id, 120);
  const rightUser = trimString(right.userId || right.user_id, 120);
  if (leftUser && rightUser && leftUser === rightUser) return true;
  const leftEmail = lowerEmail(left.email || left.user_email || left.recipient_email || left.mentioned_email);
  const rightEmail = lowerEmail(right.email || right.user_email || right.recipient_email || right.mentioned_email);
  return !!leftEmail && !!rightEmail && leftEmail === rightEmail;
}

function nonActorRecipients(recipients, actor) {
  return dedupeReminderRecipients(recipients).filter((recipient) => !sameRecipient(recipient, actor));
}

async function sendTaskActivityEmail({ event, emailConfig, recipient, message }) {
  const email = lowerEmail(recipient?.email);
  if (!email) {
    return { skipped: true, reason: 'recipient_email_missing' };
  }
  const result = await sendTeamTaskEmail({
    event,
    emailConfig,
    toEmail: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { skipped: false, payload: result.delivery };
}

async function loadTaskBundle(supabase, { taskId, commentId, attachmentId }) {
  const [taskResult, watchersResult, commentResult, attachmentResult, mentionsResult] = await Promise.all([
    supabase.from('task_items').select('*').eq('id', taskId).single(),
    supabase.from('task_watchers').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    commentId
      ? supabase.from('task_comments').select('*').eq('id', commentId).single()
      : Promise.resolve({ data: null, error: null }),
    attachmentId
      ? supabase.from('task_attachments').select('*').eq('id', attachmentId).single()
      : Promise.resolve({ data: null, error: null }),
    commentId
      ? supabase
        .from('task_comment_mentions')
        .select('*')
        .eq('comment_id', commentId)
        .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const firstError = [taskResult, watchersResult, commentResult, attachmentResult, mentionsResult]
    .map((result) => result?.error)
    .find(Boolean);
  if (firstError) throw firstError;

  return {
    task: taskResult.data,
    watchers: Array.isArray(watchersResult.data) ? watchersResult.data : [],
    comment: commentResult.data || null,
    attachment: attachmentResult.data || null,
    mentions: Array.isArray(mentionsResult.data) ? mentionsResult.data : [],
  };
}

async function recordNotificationAudit(supabase, {
  taskId,
  actionType,
  actor,
  metadata,
}) {
  try {
    await supabase
      .from('task_audit_log')
      .insert({
        task_id: taskId,
        action_type: actionType,
        actor_user_id: trimString(actor?.userId, 120) || null,
        actor_email: lowerEmail(actor?.email) || null,
        entity_type: 'task',
        entity_id: trimString(taskId, 120) || null,
        source_action: 'admin-team-tasks-notify-activity',
        old_data: {},
        new_data: {},
        metadata: metadata || {},
      });
  } catch (error) {
    console.warn('[team-task-notify] audit log write failed (%s)', error?.message || error);
  }
}

async function markMentionsNotified(supabase, mentionIds = []) {
  if (!mentionIds.length) return;
  try {
    await supabase
      .from('task_comment_mentions')
      .update({ notification_sent_at: new Date().toISOString() })
      .in('id', mentionIds);
  } catch (error) {
    console.warn('[team-task-notify] mention notification flag update failed (%s)', error?.message || error);
  }
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const body = JSON.parse(event.body || '{}');
    const eventType = trimString(body.eventType, 80).toLowerCase();
    const taskId = trimString(body.taskId, 120);
    const commentId = trimString(body.commentId, 120);
    const attachmentId = trimString(body.attachmentId, 120);

    if (!TASK_ACTIVITY_TYPES.includes(eventType) || !taskId) {
      return json(400, {
        ok: false,
        code: 'invalid_payload',
        message: 'eventType and taskId are required for Team Tasks notifications.',
      });
    }
    if ((eventType === 'comment_added' || eventType === 'mention') && !commentId) {
      return json(400, {
        ok: false,
        code: 'comment_id_required',
        message: 'commentId is required for comment and mention notifications.',
      });
    }
    if (eventType === 'attachment_added' && !attachmentId) {
      return json(400, {
        ok: false,
        code: 'attachment_id_required',
        message: 'attachmentId is required for attachment notifications.',
      });
    }

    const settingsResult = await fetchSettings(event, [TEAM_TASKS_SETTINGS_KEY]);
    const settings = normalizeTaskSettings(settingsResult?.settings?.[TEAM_TASKS_SETTINGS_KEY]);
    const bundle = await loadTaskBundle(supabase, { taskId, commentId, attachmentId });
    const actor = {
      userId: trimString(user?.id || user?.sub, 120),
      email: lowerEmail(user?.email),
      displayName: memberDisplayName(user?.user_metadata || { email: user?.email, userId: user?.id || user?.sub }),
    };
    const emailConfig = await resolveTeamTaskEmailConfig(event);
    const siteUrl = emailConfig.siteUrl;

    const mentionRecipients = settings.mentionEmailNotifications
      ? nonActorRecipients(
        bundle.mentions.filter((mention) => !mention.notification_sent_at).map((mention) => ({
          userId: trimString(mention.mentioned_user_id, 120),
          email: lowerEmail(mention.mentioned_email),
          displayName: trimString(mention.mentioned_display_name, 160),
          mentionId: mention.id,
        })),
        actor
      )
      : [];

    const activityRecipients = settings.activityEmailNotifications
      ? nonActorRecipients(
        buildTaskRecipients({
          task: bundle.task,
          watchers: bundle.watchers,
          mode: settings.activityRecipientMode || settings.reminderRecipientMode,
        }),
        actor
      ).filter((recipient) => !mentionRecipients.some((mentionRecipient) => sameRecipient(recipient, mentionRecipient)))
      : [];

    const summary = {
      ok: true,
      eventType,
      sent: 0,
      skipped: 0,
      errors: [],
      mentionRecipients: mentionRecipients.length,
      activityRecipients: activityRecipients.length,
    };

    const sentMentionIds = [];
    for (const recipient of mentionRecipients) {
      try {
        const message = buildTaskActivityEmail({
          eventType: 'mention',
          task: bundle.task,
          recipient,
          actor,
          comment: bundle.comment,
          attachment: bundle.attachment,
          siteUrl,
        });
        const delivery = await sendTaskActivityEmail({ event, emailConfig, recipient, message });
        if (delivery.skipped) {
          summary.skipped += 1;
          summary.errors.push({
            recipient: recipient.email,
            reason: delivery.reason,
          });
        } else {
          summary.sent += 1;
          if (trimString(recipient.mentionId, 120)) {
            sentMentionIds.push(trimString(recipient.mentionId, 120));
          }
          await recordNotificationAudit(supabase, {
            taskId,
            actionType: 'mention_notification_sent',
            actor,
            metadata: {
              comment_id: commentId || null,
              recipient_email: recipient.email,
            },
          });
        }
      } catch (error) {
        summary.errors.push({
          recipient: recipient.email,
          reason: error?.message || 'mention_send_failed',
        });
      }
    }

    if (sentMentionIds.length) {
      await markMentionsNotified(supabase, sentMentionIds);
    }

    const actionType = eventType === 'attachment_added'
      ? 'attachment_notification_sent'
      : 'comment_notification_sent';

    for (const recipient of activityRecipients) {
      try {
        const message = buildTaskActivityEmail({
          eventType,
          task: bundle.task,
          recipient,
          actor,
          comment: bundle.comment,
          attachment: bundle.attachment,
          siteUrl,
        });
        const delivery = await sendTaskActivityEmail({ event, emailConfig, recipient, message });
        if (delivery.skipped) {
          summary.skipped += 1;
          summary.errors.push({
            recipient: recipient.email,
            reason: delivery.reason,
          });
        } else {
          summary.sent += 1;
          await recordNotificationAudit(supabase, {
            taskId,
            actionType,
            actor,
            metadata: {
              comment_id: commentId || null,
              attachment_id: attachmentId || null,
              recipient_email: recipient.email,
            },
          });
        }
      } catch (error) {
        summary.errors.push({
          recipient: recipient.email,
          reason: error?.message || 'activity_send_failed',
        });
      }
    }

    return json(200, summary);
  } catch (error) {
    return json(error?.code === 401 ? 401 : error?.code === 403 ? 403 : 500, {
      ok: false,
      code: error?.code || 'team_tasks_activity_notify_failed',
      message: error?.message || 'Unable to send Team Tasks activity notifications.',
    });
  }
});
