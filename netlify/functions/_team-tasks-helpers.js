'use strict';

const TEAM_TASKS_SETTINGS_KEY = 'team_tasks_settings';
const HMJ_EMAIL_BRAND = {
  eyebrow: 'HMJ Team Tasks',
  bg: '#f4f6ff',
  panel: '#ffffff',
  border: '#d7def3',
  accent: '#2f4ea2',
  accentDeep: '#0f1b3f',
  muted: '#6072a2',
  badgeBg: '#f7f9ff',
  badgeBorder: '#d9e1f4',
};

const DEFAULT_TEAM_TASK_SETTINGS = {
  dueSoonDays: 3,
  collapseDoneByDefault: true,
  assignmentEmailNotifications: true,
  reminderRecipientMode: 'assignee_creator_watchers',
  activityRecipientMode: 'assignee_creator_watchers',
  activityEmailNotifications: true,
  mentionEmailNotifications: true,
  defaultPriority: 'medium',
};

const TASK_STATUSES = ['open', 'in_progress', 'waiting', 'done', 'archived'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const REMINDER_MODES = ['none', 'due_date_9am', '1_day_before', '2_days_before', 'custom'];
const RECIPIENT_MODES = ['assignee_creator_watchers', 'assignee_only', 'creator_only', 'watchers_only'];
const TASK_ACTIVITY_TYPES = ['comment_added', 'attachment_added', 'mention'];

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320);
  return email ? email.toLowerCase() : '';
}

function normaliseEnum(value, allowed, fallback) {
  const raw = trimString(value, 80).toLowerCase();
  return allowed.includes(raw) ? raw : fallback;
}

function toIsoTimestamp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function coerceBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  }
  if (value == null) return fallback;
  return !!value;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value == null ? '' : value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTaskSettings(value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    dueSoonDays: toPositiveInteger(settings.dueSoonDays, DEFAULT_TEAM_TASK_SETTINGS.dueSoonDays),
    collapseDoneByDefault: coerceBoolean(
      settings.collapseDoneByDefault,
      DEFAULT_TEAM_TASK_SETTINGS.collapseDoneByDefault
    ),
    assignmentEmailNotifications: coerceBoolean(
      settings.assignmentEmailNotifications,
      DEFAULT_TEAM_TASK_SETTINGS.assignmentEmailNotifications
    ),
    reminderRecipientMode: normaliseEnum(
      settings.reminderRecipientMode,
      RECIPIENT_MODES,
      DEFAULT_TEAM_TASK_SETTINGS.reminderRecipientMode
    ),
    activityRecipientMode: normaliseEnum(
      settings.activityRecipientMode,
      RECIPIENT_MODES,
      DEFAULT_TEAM_TASK_SETTINGS.activityRecipientMode
    ),
    activityEmailNotifications: coerceBoolean(
      settings.activityEmailNotifications,
      DEFAULT_TEAM_TASK_SETTINGS.activityEmailNotifications
    ),
    mentionEmailNotifications: coerceBoolean(
      settings.mentionEmailNotifications,
      DEFAULT_TEAM_TASK_SETTINGS.mentionEmailNotifications
    ),
    defaultPriority: normaliseEnum(
      settings.defaultPriority,
      TASK_PRIORITIES,
      DEFAULT_TEAM_TASK_SETTINGS.defaultPriority
    ),
  };
}

function fallbackDisplayName(email, userId) {
  const safeEmail = lowerEmail(email);
  if (safeEmail) {
    const local = safeEmail.split('@')[0] || safeEmail;
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return trimString(userId, 80) || 'HMJ admin';
}

function memberDisplayName(member = {}) {
  return trimString(
    member.displayName
      || member.display_name
      || member.fullName
      || member.full_name
      || member.name
      || member.email,
    160
  ) || fallbackDisplayName(member.email, member.userId || member.user_id || member.id);
}

function coerceMemberRow(row = {}) {
  const email = lowerEmail(row.email || row.actor_email || row.user_email || row.recipient_email || row.mentioned_email);
  const userId = trimString(row.userId || row.user_id || row.id || row.actor_user_id || row.mentioned_user_id, 120);
  return {
    id: trimString(row.id, 120) || userId || email,
    userId: userId || email,
    email,
    displayName: memberDisplayName(row),
    role: trimString(row.role, 64) || 'admin',
    isActive: row.isActive !== false && row.is_active !== false,
  };
}

function dedupeMembers(rows = []) {
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const member = coerceMemberRow(row);
    const key = member.email || member.userId;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(member);
  });
  return out;
}

function normalizeReminderMode(value) {
  return normaliseEnum(value, REMINDER_MODES, 'none');
}

function normalizeRecipientMode(value, fallback = DEFAULT_TEAM_TASK_SETTINGS.reminderRecipientMode) {
  return normaliseEnum(value, RECIPIENT_MODES, fallback);
}

function computeReminderSendAt({ dueAt, reminderMode, customAt }) {
  const mode = normalizeReminderMode(reminderMode);
  if (mode === 'none') return '';
  if (mode === 'custom') return toIsoTimestamp(customAt);
  const due = new Date(dueAt || '');
  if (Number.isNaN(due.getTime())) return '';

  const send = new Date(due);
  send.setSeconds(0, 0);

  if (mode === 'due_date_9am') {
    send.setHours(9, 0, 0, 0);
    return send.toISOString();
  }
  if (mode === '1_day_before') {
    send.setDate(send.getDate() - 1);
    send.setHours(9, 0, 0, 0);
    return send.toISOString();
  }
  if (mode === '2_days_before') {
    send.setDate(send.getDate() - 2);
    send.setHours(9, 0, 0, 0);
    return send.toISOString();
  }
  return '';
}

function dedupeReminderRecipients(recipients = []) {
  const out = [];
  const seen = new Set();
  recipients.forEach((row) => {
    const email = lowerEmail(row.email || row.recipient_email || row.mentioned_email);
    const userId = trimString(row.userId || row.user_id || row.id || row.mentioned_user_id, 120);
    const key = email || userId;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      userId,
      email,
      displayName: memberDisplayName(row),
    });
  });
  return out;
}

function buildTaskRecipients({ task = {}, watchers = [], mode }) {
  const recipients = [];
  const recipientMode = normalizeRecipientMode(mode);
  const includeAssignee = recipientMode === 'assignee_creator_watchers' || recipientMode === 'assignee_only';
  const includeCreator = recipientMode === 'assignee_creator_watchers' || recipientMode === 'creator_only';
  const includeWatchers = recipientMode === 'assignee_creator_watchers' || recipientMode === 'watchers_only';

  if (includeAssignee && (trimString(task.assigned_to, 120) || lowerEmail(task.assigned_to_email))) {
    recipients.push({
      userId: trimString(task.assigned_to, 120),
      email: lowerEmail(task.assigned_to_email),
      displayName: memberDisplayName({
        userId: task.assigned_to,
        email: task.assigned_to_email,
      }),
    });
  }
  if (includeCreator && (trimString(task.created_by, 120) || lowerEmail(task.created_by_email))) {
    recipients.push({
      userId: trimString(task.created_by, 120),
      email: lowerEmail(task.created_by_email),
      displayName: memberDisplayName({
        userId: task.created_by,
        email: task.created_by_email,
      }),
    });
  }
  if (includeWatchers) {
    watchers.forEach((watcher) => {
      recipients.push({
        userId: trimString(watcher.user_id || watcher.userId, 120),
        email: lowerEmail(watcher.user_email || watcher.email),
        displayName: memberDisplayName(watcher),
      });
    });
  }

  return dedupeReminderRecipients(recipients);
}

function formatDateTime(value) {
  const iso = toIsoTimestamp(value);
  if (!iso) return 'Not set';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/London',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatCountdownParts(ms) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let remaining = Math.max(0, Math.abs(ms));
  const days = Math.floor(remaining / day);
  remaining -= days * day;
  const hours = Math.floor(remaining / hour);
  remaining -= hours * hour;
  const minutes = Math.max(0, Math.ceil(remaining / minute));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function describeTaskDueCountdown(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const due = new Date(value || '');
  if (Number.isNaN(due.getTime())) {
    return {
      active: false,
      overdue: false,
      compact: '',
      label: 'No due date',
      shortLabel: '',
      ms: 0,
    };
  }

  const diff = due.getTime() - now.getTime();
  const overdue = diff < 0;
  const compact = formatCountdownParts(diff);
  return {
    active: true,
    overdue,
    compact,
    label: overdue ? `Overdue by ${compact}` : `Due in ${compact}`,
    shortLabel: overdue ? `${compact} overdue` : `${compact} left`,
    ms: diff,
  };
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return 'Unknown size';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTaskUrl(task = {}, siteUrl = '') {
  const taskId = trimString(task.id, 120);
  const safeSiteUrl = trimString(siteUrl, 500).replace(/\/$/, '');
  const taskPath = trimString(task.taskPath, 500);
  if (!safeSiteUrl) return '';
  if (taskPath) {
    return `${safeSiteUrl}${taskPath.startsWith('/') ? taskPath : `/${taskPath}`}`;
  }
  if (!taskId) return '';
  return `${safeSiteUrl}/admin/team-tasks.html?task=${encodeURIComponent(taskId)}`;
}

function buildTaskUrls(task = {}, siteUrl = '') {
  const taskId = trimString(task.id, 120);
  const safeSiteUrl = trimString(siteUrl, 500).replace(/\/$/, '');
  const base = safeSiteUrl ? `${safeSiteUrl}/admin/team-tasks.html` : '';
  if (!base) {
    return {
      taskUrl: '',
      boardUrl: '',
      plannerUrl: '',
      workspaceUrl: '',
    };
  }
  const taskUrl = taskId
    ? `${base}?task=${encodeURIComponent(taskId)}&tab=tasks`
    : base;
  return {
    taskUrl,
    boardUrl: taskId
      ? `${base}?task=${encodeURIComponent(taskId)}&tab=board`
      : `${base}?tab=board`,
    plannerUrl: taskId
      ? `${base}?task=${encodeURIComponent(taskId)}&tab=tasks#weeklyPlannerHeading`
      : `${base}#weeklyPlannerHeading`,
    workspaceUrl: `${base}?tab=tasks`,
  };
}

function buildEmailShell({
  eyebrow,
  heading,
  preheader = '',
  intro,
  summaryRows = [],
  bodyHtml = '',
  bodyText = '',
  ctaLabel = 'Open task in HMJ Admin',
  ctaUrl = '',
  actions = [],
}) {
  const safePreheader = trimString(preheader, 220);
  const primaryActions = ctaUrl
    ? [{ label: ctaLabel, url: ctaUrl, tone: 'primary' }].concat(actions || [])
    : (actions || []);
  const actionHtml = primaryActions.length
    ? [
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 12px;margin:24px 0 0;">',
      ...primaryActions
        .filter((action) => trimString(action?.url, 2000))
        .map((action) => {
          const tone = trimString(action.tone, 32) || 'secondary';
          const isPrimary = tone === 'primary';
          const bg = isPrimary ? HMJ_EMAIL_BRAND.accent : '#ffffff';
          const color = isPrimary ? '#ffffff' : HMJ_EMAIL_BRAND.accent;
          const border = isPrimary ? HMJ_EMAIL_BRAND.accent : HMJ_EMAIL_BRAND.border;
          return `<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${bg}" style="border-radius:14px;background:${bg};background-color:${bg};border:1px solid ${border}"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 16px;border-radius:14px;background:${bg};background-color:${bg};color:${color};text-decoration:none;font-weight:800;border:1px solid ${border}">${escapeHtml(action.label || 'Open')}</a></td></tr></table></td></tr>`;
        }),
      '</table>',
    ].join('')
    : '';
  const summaryHtml = summaryRows.length
    ? [
      '<div style="display:grid;gap:10px;margin:0 0 20px;padding:18px;border-radius:18px;background:#f7f9ff;border:1px solid #d9e1f4">',
      ...summaryRows.map((row) => `<div><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</div>`),
      '</div>',
    ].join('')
    : '';
  const logoUrl = trimString(ctaUrl, 2000)
    ? `${trimString(ctaUrl, 2000).split('/admin/team-tasks.html')[0] || ''}/images/uploads/logo-plain.png`
    : '';

  const html = [
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(safePreheader || intro)}</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="${HMJ_EMAIL_BRAND.bg}" style="background:${HMJ_EMAIL_BRAND.bg};padding:24px 12px;font-family:Arial,sans-serif;color:${HMJ_EMAIL_BRAND.accentDeep};">`,
    '<tr><td align="center">',
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:${HMJ_EMAIL_BRAND.panel};border:1px solid ${HMJ_EMAIL_BRAND.border};border-radius:20px;overflow:hidden;">`,
    `<tr><td bgcolor="${HMJ_EMAIL_BRAND.accentDeep}" style="padding:28px 32px;background:${HMJ_EMAIL_BRAND.accentDeep};background-color:${HMJ_EMAIL_BRAND.accentDeep};color:#ffffff;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td>`,
    `<p style="margin:0 0 12px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#dbe6ff;font-weight:800">${escapeHtml(eyebrow || HMJ_EMAIL_BRAND.eyebrow)}</p>`,
    `<h1 style="margin:0;font-size:28px;line-height:1.1;color:#ffffff">${escapeHtml(heading)}</h1>`,
    `</td>${logoUrl ? `<td align="right" valign="top"><img src="${escapeHtml(logoUrl)}" alt="HMJ Global" style="display:block;height:30px;width:auto;max-width:150px"></td>` : ''}</tr></table>`,
    `</td></tr>`,
    `<tr><td style="padding:28px 32px;">`,
    `<p style="margin:0 0 20px;color:${HMJ_EMAIL_BRAND.muted};line-height:1.6">${escapeHtml(intro)}</p>`,
    summaryHtml,
    bodyHtml,
    actionHtml,
    `<p style="margin:18px 0 0;color:${HMJ_EMAIL_BRAND.muted};font-size:13px;line-height:1.6">Use the HMJ buttons above to reopen this task securely in HMJ Admin for comments, files, reminders, and ownership updates.</p>`,
    `</td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
  ].filter(Boolean).join('');

  const text = [
    eyebrow || HMJ_EMAIL_BRAND.eyebrow,
    heading,
    '',
    intro,
    '',
    ...summaryRows.map((row) => `${row.label}: ${row.value}`),
    summaryRows.length ? '' : null,
    bodyText,
    '',
    ...primaryActions
      .filter((action) => trimString(action?.url, 2000))
      .map((action) => `${trimString(action.label, 120) || 'Open'}: ${trimString(action.url, 2000)}`),
  ].filter((value) => value != null && value !== '').join('\n');

  return { html, text };
}

function taskSummaryRows(task = {}) {
  const countdown = describeTaskDueCountdown(task.due_at || task.dueAt);
  const assignee = trimString(task.assigned_to_email || task.assignedToEmail || task.assigned_to || task.assignedTo, 160);
  return [
    { label: 'Status', value: normaliseEnum(task.status, TASK_STATUSES, 'open').replace(/_/g, ' ') },
    { label: 'Priority', value: normaliseEnum(task.priority, TASK_PRIORITIES, 'medium') },
    { label: 'Due', value: formatDateTime(task.due_at || task.dueAt) },
    ...(countdown.active ? [{ label: 'Countdown', value: countdown.label }] : []),
    ...(assignee ? [{ label: 'Assigned to', value: assignee }] : []),
  ];
}

function buildReminderEmail({ task = {}, recipient = {}, siteUrl = '' } = {}) {
  const taskTitle = trimString(task.title, 180) || 'HMJ task';
  const preview = trimString(task.description, 500)
    || 'Open HMJ Admin to review the latest notes, comments, and owner updates.';
  const greeting = trimString(recipient.displayName || recipient.email, 160) || 'HMJ team';
  const subject = `[HMJ Team Tasks] Reminder: ${taskTitle}`;
  const urls = buildTaskUrls(task, siteUrl);
  const shell = buildEmailShell({
    eyebrow: HMJ_EMAIL_BRAND.eyebrow,
    heading: taskTitle,
    preheader: `Reminder: ${taskTitle}`,
    intro: `Hello ${greeting}, this is a reminder for one of your HMJ team tasks.`,
    summaryRows: taskSummaryRows(task),
    bodyHtml: `<p style="margin:0;color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6">${escapeHtml(preview)}</p>`,
    bodyText: preview,
    ctaLabel: 'Open task',
    ctaUrl: urls.taskUrl,
    actions: [
      { label: 'Open board', url: urls.boardUrl, tone: 'secondary' },
      { label: 'Weekly planner', url: urls.plannerUrl, tone: 'secondary' },
    ],
  });

  return {
    subject,
    text: shell.text,
    html: shell.html,
  };
}

function buildAssignmentEmail({
  task = {},
  recipient = {},
  actor = {},
  siteUrl = '',
} = {}) {
  const taskTitle = trimString(task.title, 180) || 'HMJ task';
  const greeting = trimString(recipient.displayName || recipient.email, 160) || 'HMJ team';
  const actorName = trimString(actor.displayName || actor.email, 160) || 'An HMJ admin';
  const preview = trimString(task.description, 500)
    || 'Open HMJ Admin to review the brief, links, files, and due date.';
  const urls = buildTaskUrls(task, siteUrl);
  const subject = `[HMJ Team Tasks] New task assigned: ${taskTitle}`;
  const shell = buildEmailShell({
    eyebrow: HMJ_EMAIL_BRAND.eyebrow,
    heading: taskTitle,
    preheader: `New HMJ task assigned: ${taskTitle}`,
    intro: `Hello ${greeting}, ${actorName} assigned you a task in HMJ Team Tasks.`,
    summaryRows: taskSummaryRows(task).concat(
      trimString(task.linked_module, 80)
        ? [{ label: 'Linked module', value: trimString(task.linked_module, 80) }]
        : []
    ),
    bodyHtml: [
      `<p style="margin:0 0 14px;color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6">${escapeHtml(preview)}</p>`,
      `<div style="padding:16px 18px;border-radius:18px;background:${HMJ_EMAIL_BRAND.badgeBg};border:1px solid ${HMJ_EMAIL_BRAND.badgeBorder};color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6">Use the buttons below to open the task directly, jump to the board view, or review this week’s planner alongside diary commitments.</div>`,
    ].join(''),
    bodyText: preview,
    ctaLabel: 'Open task',
    ctaUrl: urls.taskUrl,
    actions: [
      { label: 'Open board', url: urls.boardUrl, tone: 'secondary' },
      { label: 'Open workspace', url: urls.workspaceUrl, tone: 'secondary' },
    ],
  });

  return {
    subject,
    text: shell.text,
    html: shell.html,
  };
}

function buildTaskActivityEmail({
  eventType,
  task = {},
  recipient = {},
  actor = {},
  comment = {},
  attachment = {},
  siteUrl = '',
} = {}) {
  const type = normaliseEnum(eventType, TASK_ACTIVITY_TYPES, 'comment_added');
  const taskTitle = trimString(task.title, 180) || 'HMJ task';
  const actorName = trimString(actor.displayName || actor.email, 160) || 'An HMJ admin';
  const greeting = trimString(recipient.displayName || recipient.email, 160) || 'HMJ team';
  const urls = buildTaskUrls(task, siteUrl);
  const commentPreview = trimString(comment.comment_body || comment.commentBody, 600)
    || 'Open HMJ Admin to read the latest comment.';
  const attachmentName = trimString(attachment.file_name || attachment.original_filename || attachment.name, 220) || 'Task file';
  const attachmentSize = formatFileSize(attachment.file_size_bytes || attachment.fileSizeBytes);

  let subject = `[HMJ Team Tasks] Update on ${taskTitle}`;
  let intro = `Hello ${greeting}, there is a new update on one of your HMJ team tasks.`;
  let bodyHtml = '';
  let bodyText = '';
  let ctaLabel = 'Open task in HMJ Admin';

  if (type === 'mention') {
    subject = `[HMJ Team Tasks] You were tagged in ${taskTitle}`;
    intro = `Hello ${greeting}, ${actorName} tagged you in a Team Tasks comment.`;
    bodyHtml = `<p style="margin:0;color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6">${escapeHtml(commentPreview)}</p>`;
    bodyText = commentPreview;
  } else if (type === 'attachment_added') {
    subject = `[HMJ Team Tasks] New file on ${taskTitle}`;
    intro = `Hello ${greeting}, ${actorName} added a file to this task.`;
    bodyHtml = [
      `<p style="margin:0 0 12px;color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6">A new attachment was added to this task.</p>`,
      `<p style="margin:0;color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6"><strong>File:</strong> ${escapeHtml(attachmentName)}${attachmentSize ? ` (${escapeHtml(attachmentSize)})` : ''}</p>`,
    ].join('');
    bodyText = `A new attachment was added.\nFile: ${attachmentName}${attachmentSize ? ` (${attachmentSize})` : ''}`;
    ctaLabel = 'Open task files';
  } else {
    subject = `[HMJ Team Tasks] New comment on ${taskTitle}`;
    intro = `Hello ${greeting}, ${actorName} added a comment to this task.`;
    bodyHtml = `<p style="margin:0;color:${HMJ_EMAIL_BRAND.accentDeep};line-height:1.6">${escapeHtml(commentPreview)}</p>`;
    bodyText = commentPreview;
  }

  const shell = buildEmailShell({
    eyebrow: HMJ_EMAIL_BRAND.eyebrow,
    heading: taskTitle,
    preheader: subject,
    intro,
    summaryRows: taskSummaryRows(task),
    bodyHtml,
    bodyText,
    ctaLabel,
    ctaUrl: urls.taskUrl,
    actions: [
      { label: 'Open board', url: urls.boardUrl, tone: 'secondary' },
    ],
  });

  return {
    subject,
    text: shell.text,
    html: shell.html,
  };
}

module.exports = {
  TEAM_TASKS_SETTINGS_KEY,
  DEFAULT_TEAM_TASK_SETTINGS,
  TASK_ACTIVITY_TYPES,
  normalizeTaskSettings,
  normalizeReminderMode,
  normalizeRecipientMode,
  computeReminderSendAt,
  dedupeReminderRecipients,
  dedupeMembers,
  coerceMemberRow,
  memberDisplayName,
  buildTaskRecipients,
  describeTaskDueCountdown,
  formatFileSize,
  buildAssignmentEmail,
  buildReminderEmail,
  buildTaskActivityEmail,
  trimString,
  lowerEmail,
  toIsoTimestamp,
  buildTaskUrls,
};
