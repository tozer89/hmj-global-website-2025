'use strict';

const TEAM_TASKS_SETTINGS_KEY = 'team_tasks_settings';

const DEFAULT_TEAM_TASK_SETTINGS = {
  dueSoonDays: 3,
  collapseDoneByDefault: true,
  reminderRecipientMode: 'assignee_creator_watchers',
  defaultPriority: 'medium',
};

const TASK_STATUSES = ['open', 'in_progress', 'waiting', 'done', 'archived'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const REMINDER_MODES = ['none', 'due_date_9am', '1_day_before', '2_days_before', 'custom'];

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
    reminderRecipientMode: trimString(settings.reminderRecipientMode, 64)
      || DEFAULT_TEAM_TASK_SETTINGS.reminderRecipientMode,
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
  const email = lowerEmail(row.email || row.actor_email);
  const userId = trimString(row.userId || row.user_id || row.id, 120);
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
    const key = member.userId || member.email;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(member);
  });
  return out;
}

function normalizeReminderMode(value) {
  return normaliseEnum(value, REMINDER_MODES, 'none');
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
    const email = lowerEmail(row.email || row.recipient_email);
    const userId = trimString(row.userId || row.user_id || row.id, 120);
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

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReminderEmail({ task = {}, recipient = {}, siteUrl = '' } = {}) {
  const taskTitle = trimString(task.title, 180) || 'HMJ task';
  const status = normaliseEnum(task.status, TASK_STATUSES, 'open').replace(/_/g, ' ');
  const priority = normaliseEnum(task.priority, TASK_PRIORITIES, 'medium');
  const assignee = trimString(task.assigned_to_email || task.assignedToEmail || task.assigned_to || '');
  const dueAt = formatDateTime(task.due_at || task.dueAt);
  const preview = trimString(task.description, 500)
    || 'Open HMJ Admin to review the latest notes, comments, and owner updates.';
  const taskPath = trimString(task.taskPath || '', 500);
  const taskUrl = taskPath && siteUrl
    ? `${String(siteUrl).replace(/\/$/, '')}${taskPath.startsWith('/') ? taskPath : `/${taskPath}`}`
    : '';
  const greeting = trimString(recipient.displayName || recipient.email, 160) || 'HMJ team';
  const subject = `[HMJ Team Tasks] ${taskTitle}`;
  const text = [
    `Hello ${greeting},`,
    '',
    `Task: ${taskTitle}`,
    `Status: ${status}`,
    `Priority: ${priority}`,
    `Due: ${dueAt}`,
    assignee ? `Assigned to: ${assignee}` : '',
    '',
    preview,
    '',
    taskUrl ? `Open in HMJ Admin: ${taskUrl}` : '',
  ].filter(Boolean).join('\n');
  const html = [
    '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f4f6ff;padding:24px;color:#13203f">',
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d7def3;border-radius:20px;padding:28px;box-shadow:0 18px 38px rgba(15,27,63,.10)">',
    '<p style="margin:0 0 12px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#2f4ea2;font-weight:800">HMJ Team Tasks</p>',
    `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.1;color:#0f1b3f">${escapeHtml(taskTitle)}</h1>`,
    `<p style="margin:0 0 20px;color:#6072a2">Hello ${escapeHtml(greeting)}, here is a reminder for one of your HMJ team tasks.</p>`,
    '<div style="display:grid;gap:10px;margin:0 0 20px;padding:18px;border-radius:18px;background:#f7f9ff;border:1px solid #d9e1f4">',
    `<div><strong>Status:</strong> ${escapeHtml(status)}</div>`,
    `<div><strong>Priority:</strong> ${escapeHtml(priority)}</div>`,
    `<div><strong>Due:</strong> ${escapeHtml(dueAt)}</div>`,
    assignee ? `<div><strong>Assigned to:</strong> ${escapeHtml(assignee)}</div>` : '',
    '</div>',
    `<p style="margin:0 0 18px;color:#0f1b3f;line-height:1.6">${escapeHtml(preview)}</p>`,
    taskUrl
      ? `<p style="margin:0"><a href="${escapeHtml(taskUrl)}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#2f4ea2;color:#ffffff;text-decoration:none;font-weight:700">Open task in HMJ Admin</a></p>`
      : '',
    '</div>',
    '</div>',
  ].filter(Boolean).join('');
  return { subject, text, html };
}

module.exports = {
  TEAM_TASKS_SETTINGS_KEY,
  DEFAULT_TEAM_TASK_SETTINGS,
  normalizeTaskSettings,
  normalizeReminderMode,
  computeReminderSendAt,
  dedupeReminderRecipients,
  dedupeMembers,
  coerceMemberRow,
  memberDisplayName,
  buildReminderEmail,
  trimString,
  lowerEmail,
  toIsoTimestamp,
};
