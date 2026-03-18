(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const doc = document;
  const SUPABASE_ESM_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  const CONFIG_ENDPOINT = '/admin-team-tasks-config';
  const SETTINGS_SAVE_ENDPOINT = '/admin-settings-save';
  const NOTIFY_ENDPOINT = '/admin-team-tasks-notify-activity';
  const SEND_EMAIL_ENDPOINT = '/admin-team-tasks-send-email';
  const ATTACHMENT_DELETE_ENDPOINT = '/admin-team-task-attachment-delete';
  const ATTACHMENT_URL_ENDPOINT = '/admin-team-task-attachment-url';
  const CALENDAR_STATUS_ENDPOINT = '/admin-team-tasks-calendar-status';
  const CALENDAR_DISCONNECT_ENDPOINT = '/admin-team-tasks-calendar-disconnect';
  const TASK_ATTACHMENTS_BUCKET = 'task-files';
  const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
  const OWNER_COLORS = ['#24489e', '#138254', '#b33228', '#9b6a00', '#6c3fc7', '#006d8f', '#cf6a00', '#1b6f4f'];
  const ATTACHMENT_EXTENSION_TO_MIME = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
  };
  const ATTACHMENT_MIME_WHITELIST = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
  ]);

  const DEFAULT_SETTINGS = {
    dueSoonDays: 3,
    collapseDoneByDefault: true,
    assignmentEmailNotifications: true,
    reminderRecipientMode: 'assignee_creator_watchers',
    activityRecipientMode: 'assignee_creator_watchers',
    activityEmailNotifications: true,
    mentionEmailNotifications: true,
    defaultPriority: 'medium',
  };

  const STATUS_LABELS = {
    open: 'Open',
    in_progress: 'In Progress',
    waiting: 'Waiting',
    done: 'Done',
    archived: 'Archived',
  };

  const PRIORITY_LABELS = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
  };

  const STATUS_ORDER = ['open', 'in_progress', 'waiting', 'done', 'archived'];
  const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];
  const BOARD_STATUSES = ['open', 'in_progress', 'waiting', 'done'];
  const REMINDER_MODES = ['none', 'due_date_9am', '1_day_before', '2_days_before', 'custom'];
  const DEFAULT_PLANNER_CARD_LIMIT = 2;
  const QUICK_TASK_TEMPLATES = [
    {
      key: 'follow_up',
      label: 'Follow-up',
      title: 'Candidate follow-up',
      description: 'Check progress, confirm blockers, and update the next agreed action.',
      linkedModule: 'Candidates',
      tags: ['follow-up', 'candidate'],
      priority: 'medium',
    },
    {
      key: 'payroll',
      label: 'Payroll',
      title: 'Complete payroll review',
      description: 'Review timesheets, confirm exceptions, and finalise payroll checks before release.',
      linkedModule: 'Payroll',
      tags: ['payroll', 'finance'],
      priority: 'high',
    },
    {
      key: 'client',
      label: 'Client update',
      title: 'Send client project update',
      description: 'Prepare the client update, confirm decisions, and log the agreed next steps.',
      linkedModule: 'Clients',
      tags: ['client', 'update'],
      priority: 'medium',
    },
    {
      key: 'mobilisation',
      label: 'Mobilisation',
      title: 'Complete starter mobilisation check',
      description: 'Confirm onboarding, documentation, and first-day readiness for the live assignment.',
      linkedModule: 'Candidates',
      tags: ['onboarding', 'mobilisation'],
      priority: 'high',
    },
    {
      key: 'finance',
      label: 'Finance chase',
      title: 'Chase finance item',
      description: 'Follow up on the outstanding finance item and record the response in the task trail.',
      linkedModule: 'Finance',
      tags: ['finance', 'chase'],
      priority: 'high',
    },
  ];

  const state = {
    helpers: null,
    who: null,
    client: null,
    supabaseModulePromise: null,
    accessToken: '',
    tokenExpiresAt: 0,
    supabaseUrl: '',
    supabaseAnonKey: '',
    realtimeChannel: null,
    realtimeState: 'idle',
    reloadTimer: 0,
    activeTab: 'tasks',
    loading: false,
    configLoaded: false,
    schemaReady: false,
    schemaMessage: '',
    emailConfigured: false,
    emailDelivery: {
      ready: false,
      senderEmail: '',
      senderName: '',
      supportEmail: '',
      preferredProvider: 'none',
      message: '',
      resend: null,
      smtp: null,
    },
    siteUrl: '',
    settings: { ...DEFAULT_SETTINGS },
    currentUser: {
      userId: '',
      email: '',
      displayName: '',
      roles: [],
    },
    members: [],
    tasks: [],
    comments: [],
    commentMentions: [],
    watchers: [],
    attachments: [],
    reminders: [],
    audit: [],
    selectedTaskId: '',
    commentEditId: '',
    attachmentUploadBusy: false,
    countdownTimer: 0,
    plannerDensity: 'comfortable',
    plannerExpandedDays: {},
    filters: {
      query: '',
      scope: 'all',
      assignee: 'all',
      sort: 'urgency',
      showDone: false,
    },
    calendar: {
      weekStart: '',
      loading: false,
      settings: null,
      diagnostics: null,
      connections: [],
      events: [],
      notice: '',
    },
  };

  const els = {};

  function byId(id) {
    return doc.getElementById(id);
  }

  function cacheElements() {
    [
      'app',
      'welcomeMeta',
      'heroSummary',
      'quickToggleAdvanced',
      'quickAddForm',
      'quickTitle',
      'quickDueAt',
      'quickAssignedTo',
      'quickPriority',
      'quickAddBtn',
      'quickTemplateButtons',
      'quickDueShortcutButtons',
      'quickFeedback',
      'quickAdvanced',
      'quickDescription',
      'quickReminderMode',
      'quickReminderCustomAt',
      'quickWatchers',
      'quickLinkedModule',
      'quickLinkedUrl',
      'quickTags',
      'quickResetBtn',
      'schemaBanner',
      'schemaBannerTitle',
      'schemaBannerCopy',
      'metricOpen',
      'metricDueToday',
      'metricOverdue',
      'metricDone',
      'refreshBtn',
      'toggleDoneBtn',
      'searchInput',
      'assigneeFilter',
      'sortFilter',
      'scopeChips',
      'plannerPrevWeekBtn',
      'plannerTodayBtn',
      'plannerNextWeekBtn',
      'plannerSetupLink',
      'plannerConnectBtn',
      'plannerComfortableBtn',
      'plannerCompactBtn',
      'plannerExpandAllBtn',
      'plannerCollapseAllBtn',
      'plannerWeekLabel',
      'plannerConnectionBadge',
      'plannerTaskCountBadge',
      'plannerReminderBadge',
      'plannerStatusNote',
      'plannerLegend',
      'plannerGrid',
      'plannerUnscheduledList',
      'opsFocusMetric',
      'opsFocusList',
      'opsReminderMetric',
      'opsReminderList',
      'opsWaitingMetric',
      'opsWaitingList',
      'opsActionState',
      'opsOverdueBtn',
      'opsMineBtn',
      'opsBoardBtn',
      'opsSettingsBtn',
      'tasksList',
      'tasksEmpty',
      'boardColumns',
      'auditList',
      'auditEmpty',
      'mineAssignedList',
      'mineCreatedList',
      'mineWatchingList',
      'settingsForm',
      'settingDueSoonDays',
      'settingDefaultPriority',
      'settingReminderRecipients',
      'settingActivityRecipients',
      'settingAssignmentEmails',
      'settingCollapseDone',
      'settingActivityEmails',
      'settingMentionEmails',
      'emailStatusNote',
      'emailStatusDetail',
      'schemaStatusNote',
      'calendarRuntimeNote',
      'calendarConnectionSummary',
      'connectCalendarBtn',
      'disconnectCalendarBtn',
      'detailDrawerShell',
      'drawerBackdrop',
      'drawerTitle',
      'drawerMeta',
      'closeDrawerBtn',
      'taskDetailForm',
      'detailTitle',
      'detailDescription',
      'creatorEditNote',
      'detailStatus',
      'detailPriority',
      'detailAssignedTo',
      'detailDueAt',
      'detailReminderEnabled',
      'detailReminderMode',
      'detailReminderCustomAt',
      'detailReminderSummary',
      'detailEmailRecipients',
      'detailEmailHistory',
      'sendAssignmentEmailBtn',
      'sendReminderNowBtn',
      'detailLinkedModule',
      'detailLinkedUrl',
      'detailTags',
      'detailWatchers',
      'commentsList',
      'commentsEmpty',
      'commentForm',
      'commentBody',
      'commentMentions',
      'commentSubmitBtn',
      'cancelCommentEditBtn',
      'commentEditMeta',
      'attachmentFiles',
      'uploadAttachmentBtn',
      'attachmentsList',
      'attachmentsEmpty',
      'drawerAuditList',
      'deleteTaskBtn',
      'archiveTaskBtn',
      'markDoneBtn',
      'saveTaskBtn',
      'tabTasks',
      'tabBoard',
      'tabAudit',
      'tabMine',
      'tabSettings',
      'tabBtnTasks',
      'tabBtnBoard',
      'tabBtnAudit',
      'tabBtnMine',
      'tabBtnSettings',
    ].forEach((id) => {
      els[id] = byId(id);
    });
  }

  function trimText(value, maxLength) {
    const text = typeof value === 'string'
      ? value.trim()
      : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function lowerEmail(value) {
    const email = trimText(value, 320);
    return email ? email.toLowerCase() : '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
  }

  function toLocalInputValue(value) {
    const raw = trimText(value, 120);
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }

  function fromLocalInputValue(value) {
    const raw = trimText(value, 80);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function formatDateTime(value) {
    const raw = trimText(value, 120);
    if (!raw) return 'Not set';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(raw));
    } catch {
      return raw;
    }
  }

  function formatRelativeTimestamp(value) {
    const raw = trimText(value, 120);
    if (!raw) return 'Unknown time';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    try {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        Math.round((date.getTime() - Date.now()) / 3600000),
        'hour'
      );
    } catch {
      return formatDateTime(raw);
    }
  }

  function startOfWeekIso(value) {
    const source = value ? new Date(value) : new Date();
    if (Number.isNaN(source.getTime())) return '';
    const date = new Date(source);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + offset);
    return date.toISOString();
  }

  function addDaysIso(value, days) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString();
  }

  function formatWeekLabel(startIso) {
    const start = new Date(startIso || '');
    if (Number.isNaN(start.getTime())) return 'This week';
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const sameYear = start.getFullYear() === end.getFullYear();
    const startLabel = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: sameYear ? undefined : 'numeric',
    }).format(start);
    const endLabel = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: sameMonth ? undefined : 'short',
      year: 'numeric',
    }).format(end);
    return `${startLabel} to ${endLabel}`;
  }

  function dateKey(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isSameDay(value, compare) {
    return dateKey(value) === dateKey(compare);
  }

  function ownerColor(value) {
    const key = trimText(value, 240).toLowerCase();
    if (!key) return OWNER_COLORS[0];
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = ((hash << 5) - hash) + key.charCodeAt(index);
      hash |= 0;
    }
    return OWNER_COLORS[Math.abs(hash) % OWNER_COLORS.length];
  }

  function plannerNoticeFromQuery() {
    try {
      const url = new URL(window.location.href);
      const status = trimText(url.searchParams.get('calendar_status'), 60);
      const message = trimText(url.searchParams.get('calendar_message'), 260);
      if (!status) return;
      state.calendar.notice = status === 'connected'
        ? 'Microsoft calendar connected.'
        : (message || 'Microsoft calendar update failed.');
      url.searchParams.delete('calendar_status');
      url.searchParams.delete('calendar_message');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }

  function normaliseSettings(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const dueSoonDays = Math.min(14, Math.max(1, Number.parseInt(input.dueSoonDays, 10) || DEFAULT_SETTINGS.dueSoonDays));
    const collapseDoneByDefault = input.collapseDoneByDefault === false
      ? false
      : (input.collapseDoneByDefault === true ? true : DEFAULT_SETTINGS.collapseDoneByDefault);
    const defaultPriority = PRIORITY_LABELS[String(input.defaultPriority || '').toLowerCase()]
      ? String(input.defaultPriority).toLowerCase()
      : DEFAULT_SETTINGS.defaultPriority;
    const reminderRecipientMode = trimText(input.reminderRecipientMode, 64) || DEFAULT_SETTINGS.reminderRecipientMode;
    const activityRecipientMode = trimText(input.activityRecipientMode, 64) || DEFAULT_SETTINGS.activityRecipientMode;
    return {
      dueSoonDays,
      collapseDoneByDefault,
      assignmentEmailNotifications: input.assignmentEmailNotifications === false
        ? false
        : DEFAULT_SETTINGS.assignmentEmailNotifications,
      defaultPriority,
      reminderRecipientMode,
      activityRecipientMode,
      activityEmailNotifications: input.activityEmailNotifications === false ? false : DEFAULT_SETTINGS.activityEmailNotifications,
      mentionEmailNotifications: input.mentionEmailNotifications === false ? false : DEFAULT_SETTINGS.mentionEmailNotifications,
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
    return trimText(userId, 120) || 'HMJ admin';
  }

  function normaliseMember(raw = {}) {
    const email = lowerEmail(raw.email || raw.actor_email || raw.created_by_email || raw.user_email);
    const userId = trimText(raw.userId || raw.user_id || raw.id || raw.created_by, 120);
    return {
      id: trimText(raw.id, 120) || userId || email,
      userId: userId || email,
      email,
      displayName: trimText(
        raw.displayName
          || raw.display_name
          || raw.full_name
          || raw.fullName
          || raw.name,
        160
      ) || fallbackDisplayName(email, userId),
      role: trimText(raw.role, 64) || 'admin',
    };
  }

  function pickPreferredLabel(existing, incoming) {
    const left = trimText(existing, 160);
    const right = trimText(incoming, 160);
    if (!left) return right;
    if (!right) return left;
    if (left.includes('@') && !right.includes('@')) return right;
    if (!left.includes(' ') && right.includes(' ')) return right;
    return left.length >= right.length ? left : right;
  }

  function normaliseMembers(rows = []) {
    const out = [];
    const userIndex = new Map();
    const emailIndex = new Map();
    rows.forEach((row) => {
      const member = normaliseMember(row);
      const userId = trimText(member.userId, 120);
      const email = lowerEmail(member.email);
      const existingIndex = (
        (userId && userIndex.has(userId) ? userIndex.get(userId) : null)
        ?? (email && emailIndex.has(email) ? emailIndex.get(email) : null)
      );
      if (existingIndex == null) {
        const index = out.push(member) - 1;
        if (userId) userIndex.set(userId, index);
        if (email) emailIndex.set(email, index);
        return;
      }

      const existing = out[existingIndex];
      out[existingIndex] = {
        ...existing,
        id: trimText(existing.id, 120) || trimText(member.id, 120) || userId || email,
        userId: trimText(existing.userId, 120) || userId || email,
        email: lowerEmail(existing.email) || email,
        displayName: pickPreferredLabel(existing.displayName, member.displayName),
        role: trimText(existing.role, 64) || trimText(member.role, 64) || 'admin',
      };
      if (trimText(out[existingIndex].userId, 120)) userIndex.set(trimText(out[existingIndex].userId, 120), existingIndex);
      if (lowerEmail(out[existingIndex].email)) emailIndex.set(lowerEmail(out[existingIndex].email), existingIndex);
    });
    return out.sort((left, right) => left.displayName.localeCompare(right.displayName, 'en-GB', { sensitivity: 'base' }));
  }

  function sameActor(userId, email, otherUserId, otherEmail) {
    const aUser = trimText(userId, 120);
    const bUser = trimText(otherUserId, 120);
    if (aUser && bUser && aUser === bUser) return true;
    const aEmail = lowerEmail(email);
    const bEmail = lowerEmail(otherEmail);
    return !!aEmail && !!bEmail && aEmail === bEmail;
  }

  function currentUser() {
    return state.currentUser || { userId: '', email: '', displayName: '' };
  }

  function isTaskCreator(task) {
    return sameActor(
      currentUser().userId,
      currentUser().email,
      task?.created_by,
      task?.created_by_email
    );
  }

  function isCommentAuthor(comment) {
    return sameActor(
      currentUser().userId,
      currentUser().email,
      comment?.created_by,
      comment?.created_by_email
    );
  }

  function isAssignedToCurrentUser(task) {
    return sameActor(
      currentUser().userId,
      currentUser().email,
      task?.assigned_to,
      task?.assigned_to_email
    );
  }

  function memberDisplayName(userId, email) {
    const emailLower = lowerEmail(email);
    const user = trimText(userId, 120);
    const member = state.members.find((item) => (
      (user && item.userId === user)
      || (emailLower && item.email === emailLower)
    ));
    if (member) return member.displayName;
    return fallbackDisplayName(emailLower, user);
  }

  function findMemberByKey(value) {
    const key = trimText(value, 120);
    if (!key) return null;
    const email = lowerEmail(key);
    return state.members.find((member) => member.userId === key || (!!email && member.email === email)) || null;
  }

  function memberOptionValue(member) {
    return trimText(member?.userId || member?.email, 120);
  }

  function resolveMemberOptionValue(userId, email) {
    const member = findMemberByKey(userId) || findMemberByKey(email);
    return member ? memberOptionValue(member) : (trimText(userId, 120) || lowerEmail(email) || '');
  }

  function taskComments(taskId) {
    return state.comments
      .filter((comment) => comment.task_id === taskId)
      .sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());
  }

  function commentMentions(commentId) {
    return state.commentMentions
      .filter((mention) => mention.comment_id === commentId)
      .sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());
  }

  function taskWatchers(taskId) {
    return state.watchers.filter((watcher) => watcher.task_id === taskId);
  }

  function taskAttachments(taskId) {
    return state.attachments
      .filter((attachment) => attachment.task_id === taskId)
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  }

  function taskReminders(taskId) {
    return state.reminders.filter((reminder) => reminder.task_id === taskId);
  }

  function taskAuditEntries(taskId) {
    return state.audit
      .filter((entry) => entry.task_id === taskId || entry.entity_id === taskId)
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  }

  function isWatchedByCurrentUser(taskId) {
    return taskWatchers(taskId).some((watcher) => sameActor(
      currentUser().userId,
      currentUser().email,
      watcher.user_id,
      watcher.user_email
    ));
  }

  function reminderModeLabel(mode) {
    switch (mode) {
      case 'due_date_9am': return 'On due date at 9am';
      case '1_day_before': return '1 day before';
      case '2_days_before': return '2 days before';
      case 'custom': return 'Custom reminder';
      default: return 'No reminder';
    }
  }

  function actionLabel(action) {
    const raw = trimText(action, 80);
    if (!raw) return 'Task updated';
    return raw
      .replace(/^task_/, '')
      .replace(/^comment_/, 'comment ')
      .replace(/^attachment_/, 'attachment ')
      .replace(/^mention_/, 'mention ')
      .replace(/^reminder_/, 'reminder ')
      .replace(/^watcher_/, 'watcher ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function parseTags(value) {
    const items = String(value == null ? '' : value)
      .split(/[\n,]/)
      .map((item) => trimText(item, 40))
      .filter(Boolean);
    const out = [];
    const seen = new Set();
    items.forEach((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return 'Unknown size';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function normaliseFileName(name) {
    const raw = trimText(name, 220);
    if (!raw) return 'task-file';
    return raw
      .replace(/[^\w.\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'task-file';
  }

  function resolveAttachmentMimeType(file) {
    const direct = trimText(file?.type, 120).toLowerCase();
    if (ATTACHMENT_MIME_WHITELIST.has(direct)) return direct;
    const fileName = trimText(file?.name, 220).toLowerCase();
    const extension = fileName.includes('.') ? fileName.split('.').pop() : '';
    return ATTACHMENT_EXTENSION_TO_MIME[extension] || '';
  }

  function dedupeRecipients(rows = []) {
    const out = [];
    const seen = new Set();
    rows.forEach((row) => {
      const member = normaliseMember(row);
      const key = member.email || member.userId;
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(member);
    });
    return out;
  }

  function computeReminderSendAt(dueAt, reminderMode, customAt) {
    const mode = REMINDER_MODES.includes(reminderMode) ? reminderMode : 'none';
    if (mode === 'none') return '';
    if (mode === 'custom') {
      const customIso = fromLocalInputValue(customAt) || trimText(customAt, 120);
      return customIso || '';
    }
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

  function buildReminderRecipients(task, watcherRows = []) {
    const recipients = [];
    const mode = trimText(state.settings.reminderRecipientMode, 64);
    const includeAssignee = mode === 'assignee_creator_watchers' || mode === 'assignee_only';
    const includeCreator = mode === 'assignee_creator_watchers' || mode === 'creator_only';
    const includeWatchers = mode === 'assignee_creator_watchers' || mode === 'watchers_only';

    if (includeAssignee && (trimText(task.assigned_to, 120) || lowerEmail(task.assigned_to_email))) {
      recipients.push({
        userId: trimText(task.assigned_to, 120),
        email: lowerEmail(task.assigned_to_email),
      });
    }
    if (includeCreator && (trimText(task.created_by, 120) || lowerEmail(task.created_by_email))) {
      recipients.push({
        userId: trimText(task.created_by, 120),
        email: lowerEmail(task.created_by_email),
      });
    }
    if (includeWatchers) {
      watcherRows.forEach((watcher) => {
        recipients.push({
          userId: trimText(watcher.user_id, 120),
          email: lowerEmail(watcher.user_email),
        });
      });
    }
    return dedupeRecipients(recipients);
  }

  function buildActivityRecipients(task, watcherRows = []) {
    const recipients = [];
    const mode = trimText(state.settings.activityRecipientMode, 64) || state.settings.reminderRecipientMode;
    const includeAssignee = mode === 'assignee_creator_watchers' || mode === 'assignee_only';
    const includeCreator = mode === 'assignee_creator_watchers' || mode === 'creator_only';
    const includeWatchers = mode === 'assignee_creator_watchers' || mode === 'watchers_only';

    if (includeAssignee && (trimText(task.assigned_to, 120) || lowerEmail(task.assigned_to_email))) {
      recipients.push({
        userId: trimText(task.assigned_to, 120),
        email: lowerEmail(task.assigned_to_email),
      });
    }
    if (includeCreator && (trimText(task.created_by, 120) || lowerEmail(task.created_by_email))) {
      recipients.push({
        userId: trimText(task.created_by, 120),
        email: lowerEmail(task.created_by_email),
      });
    }
    if (includeWatchers) {
      watcherRows.forEach((watcher) => {
        recipients.push({
          userId: trimText(watcher.user_id, 120),
          email: lowerEmail(watcher.user_email),
        });
      });
    }
    return dedupeRecipients(recipients);
  }

  function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  function endOfToday() {
    return startOfToday() + (24 * 60 * 60 * 1000);
  }

  function taskUrgency(task) {
    const status = trimText(task?.status, 40);
    if (status === 'done' || status === 'archived') return 'done';
    const due = new Date(task?.due_at || '');
    if (Number.isNaN(due.getTime())) return 'none';
    const dueTime = due.getTime();
    const now = Date.now();
    if (dueTime < now) return 'overdue';
    if (dueTime < endOfToday()) return 'today';
    if (dueTime < (startOfToday() + (state.settings.dueSoonDays * 24 * 60 * 60 * 1000))) return 'soon';
    return 'normal';
  }

  function taskUrgencyBadge(task) {
    switch (taskUrgency(task)) {
      case 'overdue': return '<span class="badge badge--danger">Overdue</span>';
      case 'today': return '<span class="badge badge--warn">Due today</span>';
      case 'soon': return '<span class="badge badge--soon">Due soon</span>';
      default: return '';
    }
  }

  function taskCountdown(task) {
    const raw = trimText(task?.due_at, 120);
    if (!raw) return null;
    const due = new Date(raw);
    if (Number.isNaN(due.getTime())) return null;
    const diff = due.getTime() - Date.now();
    const abs = Math.abs(diff);
    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    const minuteMs = 60 * 1000;
    const days = Math.floor(abs / dayMs);
    const hours = Math.floor((abs % dayMs) / hourMs);
    const minutes = Math.max(1, Math.ceil((abs % hourMs) / minuteMs));
    const compact = days > 0
      ? `${days}d ${hours}h`
      : (hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
    return {
      overdue: diff < 0,
      compact,
      label: diff < 0 ? `Overdue by ${compact}` : `Due in ${compact}`,
      badgeClass: diff < 0 ? 'badge--danger' : 'badge--soon',
    };
  }

  function taskCountdownBadge(task) {
    const countdown = taskCountdown(task);
    if (!countdown || ['done', 'archived'].includes(trimText(task?.status, 40))) return '';
    return `<span class="badge ${escapeHtml(countdown.badgeClass)}">${escapeHtml(countdown.label)}</span>`;
  }

  function comparePriority(left, right) {
    return PRIORITY_ORDER.indexOf(trimText(left, 40)) - PRIORITY_ORDER.indexOf(trimText(right, 40));
  }

  function statusRank(task) {
    return STATUS_ORDER.indexOf(trimText(task?.status, 40));
  }

  function urgencyRank(task) {
    switch (taskUrgency(task)) {
      case 'overdue': return 0;
      case 'today': return 1;
      case 'soon': return 2;
      case 'normal': return 3;
      case 'done': return 4;
      default: return 5;
    }
  }

  function taskSearchHaystack(task) {
    const commentText = taskComments(task.id).map((comment) => comment.comment_body || '').join(' ');
    const attachmentText = taskAttachments(task.id).map((attachment) => attachment.file_name || '').join(' ');
    return [
      task.title,
      task.description,
      (task.tags || []).join(' '),
      task.linked_module,
      task.linked_url,
      memberDisplayName(task.created_by, task.created_by_email),
      memberDisplayName(task.assigned_to, task.assigned_to_email),
      commentText,
      attachmentText,
    ].join(' ').toLowerCase();
  }

  function taskMatchesScope(task) {
    const scope = state.filters.scope;
    if (scope === 'my_tasks') {
      return isAssignedToCurrentUser(task) || isTaskCreator(task);
    }
    if (scope === 'due_today') {
      return taskUrgency(task) === 'today';
    }
    if (scope === 'overdue') {
      return taskUrgency(task) === 'overdue';
    }
    if (scope === 'waiting') {
      return task.status === 'waiting';
    }
    if (scope === 'done') {
      return task.status === 'done' || task.status === 'archived';
    }
    if (scope === 'created_by_me') {
      return isTaskCreator(task);
    }
    return true;
  }

  function shouldIncludeDone(task) {
    if (state.filters.scope === 'done') return true;
    if (task.status === 'archived') return false;
    if (task.status !== 'done') return true;
    return state.filters.showDone === true;
  }

  function filteredTasks() {
    const query = trimText(state.filters.query, 200).toLowerCase();
    const assignee = trimText(state.filters.assignee, 120);
    const sorted = state.tasks.slice().filter((task) => {
      if (!taskMatchesScope(task)) return false;
      if (!shouldIncludeDone(task)) return false;
      if (assignee && assignee !== 'all') {
        const selectedMember = findMemberByKey(assignee);
        if (selectedMember) {
          if (!sameActor(selectedMember.userId, selectedMember.email, task.assigned_to, task.assigned_to_email)) return false;
        } else if (!sameActor(assignee, assignee, task.assigned_to, task.assigned_to_email)) {
          return false;
        }
      }
      if (!query) return true;
      return taskSearchHaystack(task).includes(query);
    });

    sorted.sort((left, right) => {
      const sort = state.filters.sort;
      if (sort === 'priority') {
        const priorityDelta = comparePriority(left.priority, right.priority);
        if (priorityDelta !== 0) return priorityDelta;
      }
      if (sort === 'due_at') {
        const a = new Date(left.due_at || '2999-12-31T00:00:00Z').getTime();
        const b = new Date(right.due_at || '2999-12-31T00:00:00Z').getTime();
        if (a !== b) return a - b;
      }
      if (sort === 'updated_at') {
        const a = new Date(left.updated_at || left.created_at || 0).getTime();
        const b = new Date(right.updated_at || right.created_at || 0).getTime();
        if (a !== b) return b - a;
      }
      if (sort === 'created_at') {
        const a = new Date(left.created_at || 0).getTime();
        const b = new Date(right.created_at || 0).getTime();
        if (a !== b) return b - a;
      }
      const urgencyDelta = urgencyRank(left) - urgencyRank(right);
      if (urgencyDelta !== 0) return urgencyDelta;
      const statusDelta = statusRank(left) - statusRank(right);
      if (statusDelta !== 0) return statusDelta;
      const dueDelta = new Date(left.due_at || '2999-12-31T00:00:00Z').getTime() - new Date(right.due_at || '2999-12-31T00:00:00Z').getTime();
      if (dueDelta !== 0) return dueDelta;
      const priorityDelta = comparePriority(left.priority, right.priority);
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime();
    });

    return sorted;
  }

  function findTask(taskId) {
    return state.tasks.find((task) => task.id === taskId) || null;
  }

  function currentTask() {
    return findTask(state.selectedTaskId);
  }

  function updateQueryState({ taskId = state.selectedTaskId, tab = state.activeTab } = {}) {
    try {
      const url = new URL(window.location.href);
      if (taskId) url.searchParams.set('task', taskId);
      else url.searchParams.delete('task');
      if (tab && ['tasks', 'board', 'audit', 'mine', 'settings'].includes(tab)) {
        url.searchParams.set('tab', tab);
      } else {
        url.searchParams.delete('tab');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }

  function readQueryTaskId() {
    try {
      const url = new URL(window.location.href);
      return trimText(url.searchParams.get('task'), 120);
    } catch {
      return '';
    }
  }

  function readQueryTab() {
    try {
      const url = new URL(window.location.href);
      const tab = trimText(url.searchParams.get('tab'), 40).toLowerCase();
      return ['tasks', 'board', 'audit', 'mine', 'settings'].includes(tab) ? tab : '';
    } catch {
      return '';
    }
  }

  function setAdvancedVisibility(expanded) {
    const open = !!expanded;
    if (els.quickAdvanced) {
      els.quickAdvanced.hidden = !open;
    }
    if (els.quickToggleAdvanced) {
      els.quickToggleAdvanced.setAttribute('aria-expanded', open ? 'true' : 'false');
      els.quickToggleAdvanced.textContent = open ? 'Hide advanced options' : 'Advanced options';
    }
  }

  function setQuickFeedback(message, tone) {
    if (!els.quickFeedback) return;
    els.quickFeedback.innerHTML = message || 'Choose a template, set a due shortcut, or add the task directly.';
    setStatusNoteTone(els.quickFeedback, tone || '');
  }

  function setQuickFormDefaults() {
    if (els.quickPriority) {
      els.quickPriority.value = state.settings.defaultPriority;
    }
    if (els.quickAssignedTo && !els.quickAssignedTo.value) {
      els.quickAssignedTo.value = '';
    }
    if (els.quickReminderMode) {
      els.quickReminderMode.value = 'none';
    }
    if (els.quickReminderCustomAt) {
      els.quickReminderCustomAt.value = '';
    }
    setQuickFeedback('Choose a template, set a due shortcut, or add the task directly. Assignment emails will follow your saved Team Tasks settings.');
  }

  function dateAtLocal(baseDate, hour, minute) {
    const value = new Date(baseDate);
    value.setHours(hour, minute, 0, 0);
    return value;
  }

  function upcomingWeekdayDate(targetWeekday, hour, minute) {
    const now = new Date();
    const value = new Date(now);
    const currentWeekday = value.getDay();
    let delta = (targetWeekday - currentWeekday + 7) % 7;
    value.setDate(value.getDate() + delta);
    value.setHours(hour, minute, 0, 0);
    if (delta === 0 && value <= now) {
      value.setDate(value.getDate() + 7);
    }
    return value;
  }

  function dueShortcutOptions() {
    return [
      {
        key: 'today_1700',
        label: 'Today 17:00',
        build() {
          const now = new Date();
          const value = dateAtLocal(now, 17, 0);
          if (value <= now) {
            value.setDate(value.getDate() + 1);
          }
          return value;
        },
      },
      {
        key: 'tomorrow_0900',
        label: 'Tomorrow 09:00',
        build() {
          const value = dateAtLocal(new Date(), 9, 0);
          value.setDate(value.getDate() + 1);
          return value;
        },
      },
      {
        key: 'friday_1500',
        label: 'Fri 15:00',
        build() {
          return upcomingWeekdayDate(5, 15, 0);
        },
      },
      {
        key: 'monday_0900',
        label: 'Mon 09:00',
        build() {
          return upcomingWeekdayDate(1, 9, 0);
        },
      },
      {
        key: 'clear',
        label: 'Clear due date',
        build() {
          return null;
        },
      },
    ];
  }

  function renderQuickAddAids() {
    if (els.quickTemplateButtons) {
      els.quickTemplateButtons.innerHTML = QUICK_TASK_TEMPLATES.map((template) => `
        <button class="quick-preset-btn" type="button" data-quick-template="${escapeHtml(template.key)}">${escapeHtml(template.label)}</button>
      `).join('');
    }
    if (els.quickDueShortcutButtons) {
      els.quickDueShortcutButtons.innerHTML = dueShortcutOptions().map((shortcut) => `
        <button class="quick-preset-btn" type="button" data-due-shortcut="${escapeHtml(shortcut.key)}">${escapeHtml(shortcut.label)}</button>
      `).join('');
    }
  }

  function applyQuickTemplate(key) {
    const template = QUICK_TASK_TEMPLATES.find((item) => item.key === key);
    if (!template) return;
    if (els.quickTitle) {
      els.quickTitle.value = template.title;
    }
    if (els.quickDescription) {
      els.quickDescription.value = template.description;
    }
    if (els.quickLinkedModule) {
      els.quickLinkedModule.value = template.linkedModule;
    }
    if (els.quickTags) {
      els.quickTags.value = template.tags.join(', ');
    }
    if (els.quickPriority) {
      els.quickPriority.value = template.priority;
    }
    setAdvancedVisibility(true);
    setQuickFeedback(`<strong>${escapeHtml(template.label)}</strong> template applied. Adjust the assignee, due date, or watcher list before saving.`, 'ok');
  }

  function applyDueShortcut(key) {
    const shortcut = dueShortcutOptions().find((item) => item.key === key);
    if (!shortcut || !els.quickDueAt) return;
    const value = shortcut.build();
    els.quickDueAt.value = value ? toLocalInputValue(value.toISOString()) : '';
    setQuickFeedback(value
      ? `<strong>${escapeHtml(shortcut.label)}</strong> applied to the due date.`
      : 'Due date cleared. This task will stay unscheduled until you set a new deadline.', value ? 'ok' : 'warn');
  }

  function populateSelect(select, options, placeholder) {
    if (!select) return;
    const rows = [];
    if (placeholder !== undefined) {
      rows.push(`<option value="">${escapeHtml(placeholder)}</option>`);
    }
    options.forEach((option) => {
      rows.push(`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`);
    });
    select.innerHTML = rows.join('');
  }

  function populateMemberInputs() {
    const memberOptions = state.members.map((member) => ({
      value: memberOptionValue(member),
      label: member.displayName + (member.email ? ` — ${member.email}` : ''),
    }));

    populateSelect(els.quickAssignedTo, memberOptions, 'Unassigned');
    populateSelect(els.detailAssignedTo, memberOptions, 'Unassigned');
    populateSelect(els.assigneeFilter, memberOptions, 'All assignees');
    if (els.assigneeFilter?.options?.length) {
      els.assigneeFilter.options[0].value = 'all';
    }

    const watcherOptionsHtml = memberOptions
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    if (els.quickWatchers) {
      els.quickWatchers.innerHTML = watcherOptionsHtml;
    }
    if (els.detailWatchers) {
      els.detailWatchers.innerHTML = watcherOptionsHtml;
    }
    if (els.commentMentions) {
      els.commentMentions.innerHTML = watcherOptionsHtml;
    }
  }

  function setMultiSelectValues(select, values) {
    if (!select) return;
    const chosen = new Set((values || []).map((value) => trimText(value, 120)).filter(Boolean));
    Array.from(select.options || []).forEach((option) => {
      option.selected = chosen.has(trimText(option.value, 120));
    });
  }

  function plannerWeekStart() {
    if (!state.calendar.weekStart) {
      state.calendar.weekStart = startOfWeekIso();
    }
    return state.calendar.weekStart;
  }

  function plannerRange() {
    const startAt = plannerWeekStart();
    return {
      startAt,
      endAt: addDaysIso(startAt, 7),
    };
  }

  function plannerDayEntries() {
    const startAt = new Date(plannerWeekStart() || '');
    if (Number.isNaN(startAt.getTime())) return [];
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(startAt);
      date.setDate(date.getDate() + index);
      return {
        key: dateKey(date.toISOString()),
        date,
      };
    });
  }

  function taskOwnerIdentity(task) {
    const userId = trimText(task?.assigned_to, 120) || trimText(task?.created_by, 120);
    const email = lowerEmail(task?.assigned_to_email) || lowerEmail(task?.created_by_email);
    return {
      userId,
      email,
      label: trimText(task?.assigned_to, 120) || lowerEmail(task?.assigned_to_email)
        ? memberDisplayName(task?.assigned_to, task?.assigned_to_email)
        : memberDisplayName(task?.created_by, task?.created_by_email),
    };
  }

  function connectedCalendarLabel() {
    const connections = Array.isArray(state.calendar.connections) ? state.calendar.connections : [];
    const count = connections.filter((connection) => connection.connected).length;
    if (!count) return 'No calendars connected';
    return `${pluralize(count, 'calendar')} connected`;
  }

  function plannerDayKey(date) {
    const value = date instanceof Date ? new Date(date) : new Date(date || '');
    if (Number.isNaN(value.getTime())) return '';
    const yyyy = String(value.getFullYear());
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function plannerDayExpanded(dayKey, itemCount, date) {
    if (!dayKey) return true;
    if (Object.prototype.hasOwnProperty.call(state.plannerExpandedDays, dayKey)) {
      return state.plannerExpandedDays[dayKey] !== false;
    }
    return isSameDay(date, new Date()) || itemCount <= DEFAULT_PLANNER_CARD_LIMIT;
  }

  function setPlannerDayExpanded(dayKey, expanded) {
    if (!dayKey) return;
    state.plannerExpandedDays[dayKey] = !!expanded;
    renderWeeklyPlanner();
  }

  function setPlannerExpansionForVisibleDays(expanded) {
    plannerDayEntries().forEach((day) => {
      const dayKey = plannerDayKey(day.date);
      if (dayKey) {
        state.plannerExpandedDays[dayKey] = !!expanded;
      }
    });
    renderWeeklyPlanner();
  }

  function setPlannerDensity(nextDensity) {
    state.plannerDensity = nextDensity === 'compact' ? 'compact' : 'comfortable';
    renderWeeklyPlanner();
  }

  function plannerOwners() {
    const owners = [];
    const seen = new Set();
    filteredTasks().forEach((task) => {
      const owner = taskOwnerIdentity(task);
      const key = owner.userId || owner.email;
      if (!key || seen.has(key)) return;
      seen.add(key);
      owners.push({
        key,
        label: owner.label || 'Unassigned',
        color: ownerColor(key),
      });
    });

    (state.calendar.connections || []).forEach((connection) => {
      const key = trimText(connection.userId, 240) || lowerEmail(connection.userEmail);
      if (!key || seen.has(key)) return;
      seen.add(key);
      owners.push({
        key,
        label: trimText(connection.userDisplayName, 240) || trimText(connection.userEmail, 240) || 'Connected calendar',
        color: ownerColor(key),
      });
    });
    return owners.sort((left, right) => left.label.localeCompare(right.label, 'en-GB', { sensitivity: 'base' }));
  }

  function taskPlannerCard(task) {
    const owner = taskOwnerIdentity(task);
    const ownerKey = owner.userId || owner.email || task.id;
    const color = ownerColor(ownerKey);
    const countdown = taskCountdown(task);
    return `
      <article class="planner-item planner-item--task" style="--owner-color:${escapeHtml(color)}">
        <div class="planner-item__kicker">Task</div>
        <div class="planner-item__title">${escapeHtml(task.title)}</div>
        <div class="planner-item__meta">${escapeHtml(task.due_at ? formatDateTime(task.due_at) : 'No due date')}${countdown ? ` · ${escapeHtml(countdown.shortLabel || countdown.label)}` : ''}</div>
        <div class="planner-item__owner">
          <span><span class="planner-dot" style="--owner-color:${escapeHtml(color)}"></span> ${escapeHtml(owner.label || 'Unassigned')}</span>
          <button class="btn secondary small" type="button" data-action="open" data-id="${escapeHtml(task.id)}">Open</button>
        </div>
      </article>
    `;
  }

  function externalPlannerCard(eventItem) {
    const ownerKey = trimText(eventItem.ownerUserId, 240) || lowerEmail(eventItem.ownerEmail) || eventItem.id;
    const color = ownerColor(ownerKey);
    const timeLabel = eventItem.isAllDay
      ? 'All day'
      : `${formatDateTime(eventItem.startAt)} to ${formatDateTime(eventItem.endAt)}`;
    const location = trimText(eventItem.location, 240);
    const action = trimText(eventItem.webLink, 2000)
      ? `<a class="planner-link" href="${escapeHtml(eventItem.webLink)}" target="_blank" rel="noreferrer">Open event</a>`
      : '';
    return `
      <article class="planner-item planner-item--event" style="--owner-color:${escapeHtml(color)}">
        <div class="planner-item__kicker">Calendar</div>
        <div class="planner-item__title">${escapeHtml(eventItem.title || 'Busy')}</div>
        <div class="planner-item__meta">${escapeHtml(timeLabel)}${location ? ` · ${escapeHtml(location)}` : ''}</div>
        <div class="planner-item__owner">
          <span><span class="planner-dot" style="--owner-color:${escapeHtml(color)}"></span> ${escapeHtml(eventItem.ownerDisplayName || eventItem.ownerEmail || 'Connected calendar')}</span>
          ${action}
        </div>
      </article>
    `;
  }

  function renderWeeklyPlanner() {
    if (!els.plannerGrid || !els.plannerWeekLabel || !els.plannerStatusNote) return;

    const startAt = plannerWeekStart();
    const days = plannerDayEntries();
    const range = plannerRange();
    const items = filteredTasks().filter((task) => {
      if (!trimText(task?.due_at, 120)) return false;
      const due = new Date(task.due_at);
      if (Number.isNaN(due.getTime())) return false;
      return due >= new Date(range.startAt) && due < new Date(range.endAt);
    });
    const unscheduled = filteredTasks().filter((task) => !trimText(task?.due_at, 120) && task.status !== 'archived').slice(0, 9);
    const externalEvents = Array.isArray(state.calendar.events) ? state.calendar.events : [];
    const visibleReminderCount = state.reminders.filter((item) => {
      if (!item || !item.task_id) return false;
      const task = findTask(item.task_id);
      return !!task && filteredTasks().some((candidate) => candidate.id === task.id) && item.status !== 'sent' && item.status !== 'cancelled';
    }).length;

    els.plannerWeekLabel.textContent = formatWeekLabel(startAt);
    if (els.plannerConnectionBadge) {
      els.plannerConnectionBadge.textContent = connectedCalendarLabel();
    }
    if (els.plannerTaskCountBadge) {
      els.plannerTaskCountBadge.textContent = `${pluralize(items.length, 'scheduled task')} · ${pluralize(externalEvents.length, 'diary event')}`;
    }
    if (els.plannerReminderBadge) {
      els.plannerReminderBadge.textContent = `${pluralize(visibleReminderCount, 'pending reminder')} · ${pluralize(unscheduled.length, 'unscheduled task')}`;
    }
    if (els.plannerGrid) {
      els.plannerGrid.dataset.density = state.plannerDensity;
    }
    if (els.plannerComfortableBtn) {
      const active = state.plannerDensity !== 'compact';
      els.plannerComfortableBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      els.plannerComfortableBtn.className = `btn ${active ? 'secondary' : 'soft'} small`;
    }
    if (els.plannerCompactBtn) {
      const active = state.plannerDensity === 'compact';
      els.plannerCompactBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      els.plannerCompactBtn.className = `btn ${active ? 'secondary' : 'soft'} small`;
    }

    const diagnostics = state.calendar.diagnostics || {};
    const currentConnection = (state.calendar.connections || []).find((connection) => connection.isCurrentUser && connection.connected);
    const eventCount = externalEvents.length;
    if (state.calendar.loading) {
      els.plannerStatusNote.textContent = 'Loading the current Team Tasks week and connected diary events…';
    } else if (!diagnostics.enabled) {
      els.plannerStatusNote.textContent = 'Microsoft diary sync is currently disabled. Tasks still show here, and the setup wizard lives in Admin Settings when you are ready to turn diary sync on.';
    } else if (!diagnostics.setupReady) {
      els.plannerStatusNote.textContent = 'Microsoft diary sync is not fully configured yet. Add the client ID, client secret, and callback URL in Admin Settings before connecting calendars.';
    } else if (!currentConnection) {
      els.plannerStatusNote.textContent = 'Your own Outlook / Teams diary is not connected yet. Use the connect button to link it, or open Admin Settings if the Microsoft app setup still needs work.';
    } else if (!eventCount) {
      els.plannerStatusNote.textContent = state.calendar.notice || 'No live Outlook / Teams diary events were returned for this week. Due tasks still show below.';
    } else {
      els.plannerStatusNote.textContent = state.calendar.notice || `${pluralize(eventCount, 'diary event')} loaded for this week across ${connectedCalendarLabel().toLowerCase()}.`;
    }

    if (els.plannerLegend) {
      const owners = plannerOwners();
      els.plannerLegend.innerHTML = owners.length
        ? owners.map((owner) => `
            <span class="badge"><span class="planner-dot" style="--owner-color:${escapeHtml(owner.color)}"></span> ${escapeHtml(owner.label)}</span>
          `).join('')
        : '<span class="badge">No owners to show yet</span>';
    }

    els.plannerGrid.innerHTML = days.map((day) => {
      const dayTasks = items
        .filter((task) => isSameDay(task.due_at, day.date))
        .sort((left, right) => new Date(left.due_at || 0).getTime() - new Date(right.due_at || 0).getTime());
      const dayEvents = externalEvents
        .filter((eventItem) => isSameDay(eventItem.startAt, day.date))
        .sort((left, right) => new Date(left.startAt || 0).getTime() - new Date(right.startAt || 0).getTime());
      const cards = [
        ...dayTasks.map((task) => taskPlannerCard(task)),
        ...dayEvents.map((eventItem) => externalPlannerCard(eventItem)),
      ];
      const dayKey = plannerDayKey(day.date);
      const expanded = plannerDayExpanded(dayKey, cards.length, day.date);
      const visibleCards = expanded ? cards : cards.slice(0, DEFAULT_PLANNER_CARD_LIMIT);
      const hiddenCount = Math.max(0, cards.length - visibleCards.length);

      return `
        <section class="planner-day${isSameDay(day.date, new Date()) ? ' is-today' : ''}${expanded ? '' : ' is-collapsed'}">
          <button class="planner-day__head planner-day__toggle" type="button" data-planner-day="${escapeHtml(dayKey)}" aria-expanded="${expanded ? 'true' : 'false'}">
            <div class="planner-day__eyebrow">${escapeHtml(new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(day.date))}</div>
            <div class="planner-day__summary">
              <div class="planner-day__date">${escapeHtml(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(day.date))}</div>
              <span class="planner-day__count">${escapeHtml(pluralize(cards.length, 'item'))} <span class="planner-day__chevron">${expanded ? 'Hide' : 'Expand'}</span></span>
            </div>
          </button>
          <div class="planner-day__items">
            ${visibleCards.length ? visibleCards.join('') : '<div class="planner-empty">No due tasks or diary events for this day.</div>'}
            ${hiddenCount ? `<button class="planner-day__more" type="button" data-planner-day="${escapeHtml(dayKey)}">Show ${escapeHtml(pluralize(hiddenCount, 'more item'))}</button>` : ''}
          </div>
        </section>
      `;
    }).join('');

    if (els.plannerUnscheduledList) {
      els.plannerUnscheduledList.innerHTML = unscheduled.length
        ? unscheduled.map((task) => taskPlannerCard(task)).join('')
        : '<div class="planner-empty">Every visible task currently has a due date.</div>';
    }

    if (els.plannerConnectBtn) {
      els.plannerConnectBtn.disabled = !(diagnostics.setupReady && diagnostics.enabled);
    }
    if (els.connectCalendarBtn) {
      els.connectCalendarBtn.disabled = !(diagnostics.setupReady && diagnostics.enabled);
    }
    if (els.disconnectCalendarBtn) {
      els.disconnectCalendarBtn.disabled = !currentConnection;
    }
  }

  function renderOpsCardItem(task, meta) {
    if (!task) {
      return '<div class="ops-card__item"><strong>Nothing to show</strong><span>The current filters do not surface any tasks here.</span></div>';
    }
    return `
      <article class="ops-card__item">
        <strong>${escapeHtml(task.title)}</strong>
        <span>${escapeHtml(meta)}</span>
        <button class="btn secondary small" type="button" data-action="open" data-id="${escapeHtml(task.id)}">Open task</button>
      </article>
    `;
  }

  function renderOperationsPanels() {
    const items = filteredTasks().filter((task) => task.status !== 'archived');
    const focusItems = items
      .filter((task) => ['overdue', 'today', 'soon'].includes(taskUrgency(task)))
      .sort((left, right) => {
        const urgencyDelta = ['overdue', 'today', 'soon', 'later', 'none'].indexOf(taskUrgency(left))
          - ['overdue', 'today', 'soon', 'later', 'none'].indexOf(taskUrgency(right));
        if (urgencyDelta !== 0) return urgencyDelta;
        return new Date(left.due_at || 0).getTime() - new Date(right.due_at || 0).getTime();
      })
      .slice(0, 3);
    const reminderEntries = items
      .map((task) => ({ task, reminders: pendingTaskReminders(task.id) }))
      .filter((entry) => entry.reminders.length);
    const reminderItems = reminderEntries
      .sort((left, right) => new Date(left.reminders[0].send_at || 0).getTime() - new Date(right.reminders[0].send_at || 0).getTime())
      .slice(0, 3);
    const waitingItems = items
      .filter((task) => task.status === 'waiting')
      .sort((left, right) => new Date(left.updated_at || left.created_at || 0).getTime() - new Date(right.updated_at || right.created_at || 0).getTime())
      .slice(0, 3);

    if (els.opsFocusMetric) {
      els.opsFocusMetric.innerHTML = `${focusItems.length}<small>${pluralize(items.filter((task) => taskUrgency(task) === 'overdue').length, 'overdue item')} and ${pluralize(items.filter((task) => taskUrgency(task) === 'today').length, 'due today')} visible.</small>`;
    }
    if (els.opsReminderMetric) {
      const pendingReminders = reminderEntries.reduce((total, entry) => total + entry.reminders.length, 0);
      els.opsReminderMetric.innerHTML = `${pendingReminders}<small>Next sends are surfaced here so manual nudges are easy to spot.</small>`;
    }
    if (els.opsWaitingMetric) {
      els.opsWaitingMetric.innerHTML = `${waitingItems.length}<small>${pluralize(items.filter((task) => !trimText(task.assigned_to, 120) && !lowerEmail(task.assigned_to_email)).length, 'unassigned task')} still need ownership.</small>`;
    }
    if (els.opsFocusList) {
      els.opsFocusList.innerHTML = (focusItems.length ? focusItems : [null]).map((task) => (
        renderOpsCardItem(task, task ? `${STATUS_LABELS[task.status] || 'Open'} · ${task.due_at ? formatDateTime(task.due_at) : 'No due date'}` : '')
      )).join('');
    }
    if (els.opsReminderList) {
      els.opsReminderList.innerHTML = reminderItems.length
        ? reminderItems.map((entry) => renderOpsCardItem(entry.task, `${pluralize(entry.reminders.length, 'reminder')} queued · next send ${formatDateTime(entry.reminders[0].send_at)}`)).join('')
        : renderOpsCardItem(null, '');
    }
    if (els.opsWaitingList) {
      els.opsWaitingList.innerHTML = (waitingItems.length ? waitingItems : [null]).map((task) => (
        renderOpsCardItem(task, task ? `${pluralize(taskComments(task.id).length, 'comment')} · updated ${formatDateTime(task.updated_at || task.created_at)}` : '')
      )).join('');
    }
    if (els.opsActionState) {
      els.opsActionState.textContent = `${pluralize(items.length, 'task')} visible in the current scope. Use the shortcuts below to flip between the task board, overdue queue, and workspace settings.`;
    }
  }

  function selectedValues(select) {
    return Array.from(select?.selectedOptions || [])
      .map((option) => trimText(option.value, 120))
      .filter(Boolean);
  }

  function setStatusNoteTone(element, tone) {
    if (!element) return;
    element.classList.remove('status-note--ok', 'status-note--warn', 'status-note--danger');
    if (tone === 'ok') element.classList.add('status-note--ok');
    if (tone === 'warn') element.classList.add('status-note--warn');
    if (tone === 'danger') element.classList.add('status-note--danger');
  }

  function pendingTaskReminders(taskId) {
    return taskReminders(taskId)
      .filter((item) => item.status !== 'sent' && item.status !== 'cancelled')
      .sort((left, right) => new Date(left.send_at || 0).getTime() - new Date(right.send_at || 0).getTime());
  }

  function assignmentEmailRecipient(task) {
    const email = lowerEmail(task?.assigned_to_email);
    if (!email) return null;
    return {
      userId: trimText(task.assigned_to, 120),
      email,
      displayName: memberDisplayName(task.assigned_to, task.assigned_to_email),
    };
  }

  function taskReminderRecipients(task) {
    const recipients = [];
    const mode = trimText(state.settings.reminderRecipientMode, 64) || DEFAULT_SETTINGS.reminderRecipientMode;
    const includeAssignee = mode === 'assignee_creator_watchers' || mode === 'assignee_only';
    const includeCreator = mode === 'assignee_creator_watchers' || mode === 'creator_only';
    const includeWatchers = mode === 'assignee_creator_watchers' || mode === 'watchers_only';
    if (includeAssignee && assignmentEmailRecipient(task)) {
      recipients.push(assignmentEmailRecipient(task));
    }
    if (includeCreator && (trimText(task.created_by, 120) || lowerEmail(task.created_by_email))) {
      recipients.push({
        userId: trimText(task.created_by, 120),
        email: lowerEmail(task.created_by_email),
        displayName: memberDisplayName(task.created_by, task.created_by_email),
      });
    }
    if (includeWatchers) {
      taskWatchers(task.id).forEach((watcher) => {
        recipients.push({
          userId: trimText(watcher.user_id, 120),
          email: lowerEmail(watcher.user_email),
          displayName: memberDisplayName(watcher.user_id, watcher.user_email),
        });
      });
    }
    const seen = new Set();
    return recipients.filter((recipient) => {
      const key = recipient.email || recipient.userId;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function taskEmailAuditEntry(taskId, actionType) {
    return taskAuditEntries(taskId).find((entry) => trimText(entry.action_type, 80) === actionType) || null;
  }

  function formatRecipients(recipients = []) {
    if (!recipients.length) return 'No recipient available yet.';
    return recipients.map((recipient) => recipient.displayName || recipient.email || recipient.userId).join(', ');
  }

  function buildReminderStatusCopy(task) {
    const pending = pendingTaskReminders(task.id);
    if (!pending.length && !task.reminder_enabled) {
      return {
        text: 'No reminder is scheduled for this task yet.',
        tone: 'warn',
      };
    }
    const nextReminder = pending[0] || null;
    if (!nextReminder) {
      return {
        text: 'Reminder is enabled, but there is no pending send time. Save the task again after setting the due date or custom reminder.',
        tone: 'warn',
      };
    }
    return {
      text: `${pluralize(pending.length, 'reminder')} queued. Next send: ${formatDateTime(nextReminder.send_at)} (${reminderModeLabel(nextReminder.reminder_mode || task.reminder_mode)}).`,
      tone: 'ok',
    };
  }

  function buildEmailHistoryCopy(task) {
    const assignmentSent = taskEmailAuditEntry(task.id, 'assignment_email_sent');
    const reminderSent = taskEmailAuditEntry(task.id, 'reminder_email_sent');
    if (!assignmentSent && !reminderSent) {
      return {
        text: 'No assignment or reminder email has been logged for this task yet.',
        tone: 'warn',
      };
    }
    const parts = [];
    if (assignmentSent) {
      const recipient = trimText(assignmentSent.metadata?.recipient_email, 160) || 'assignee';
      parts.push(`Assignment email: ${formatDateTime(assignmentSent.created_at)} to ${recipient}.`);
    }
    if (reminderSent) {
      const recipient = trimText(reminderSent.metadata?.recipient_email, 160) || 'recipient';
      parts.push(`Reminder email: ${formatDateTime(reminderSent.created_at)} to ${recipient}.`);
    }
    return {
      text: parts.join(' '),
      tone: 'ok',
    };
  }

  function reminderIndicator(task) {
    const pending = pendingTaskReminders(task.id);
    if (!pending.length && !task.reminder_enabled) {
      return '<span class="badge">No reminder</span>';
    }
    const nextReminder = pending[0];
    return `<span class="badge">${pluralize(pending.length || 1, 'reminder')}${nextReminder?.send_at ? ` · ${escapeHtml(formatDateTime(nextReminder.send_at))}` : ''}</span>`;
  }

  function renderHeroSummary() {
    const openCount = state.tasks.filter((task) => ['open', 'in_progress', 'waiting'].includes(task.status)).length;
    const overdueCount = state.tasks.filter((task) => taskUrgency(task) === 'overdue').length;
    if (!state.schemaReady) {
      els.heroSummary.textContent = 'Schema setup still required before Team Tasks can go live.';
      return;
    }
    if (state.loading) {
      els.heroSummary.textContent = 'Loading live task data…';
      return;
    }
    const syncLabel = state.realtimeState === 'SUBSCRIBED' ? 'Realtime live' : 'Refresh-based';
    els.heroSummary.textContent = `${pluralize(openCount, 'active task')}, ${pluralize(overdueCount, 'overdue item')} · ${syncLabel}`;
  }

  function renderBanner() {
    const hasSchemaIssue = !state.schemaReady;
    const hasGeneralMessage = !!trimText(state.schemaMessage, 600);
    if (!els.schemaBanner) return;

    if (!hasSchemaIssue && !hasGeneralMessage) {
      els.schemaBanner.hidden = true;
      return;
    }

    els.schemaBanner.hidden = false;
    if (hasSchemaIssue) {
      els.schemaBanner.dataset.tone = 'warn';
      els.schemaBannerTitle.textContent = 'Team Tasks schema still needs to be applied';
      els.schemaBannerCopy.textContent = state.schemaMessage
        || 'Run scripts/create-team-tasks-module.sql in Supabase, then refresh this page.';
    } else {
      els.schemaBanner.dataset.tone = 'info';
      els.schemaBannerTitle.textContent = 'Team Tasks information';
      els.schemaBannerCopy.textContent = state.schemaMessage;
    }

    if (els.quickAddBtn) {
      els.quickAddBtn.disabled = hasSchemaIssue;
    }
  }

  function renderMetrics() {
    const items = state.tasks.slice();
    const openTotal = items.filter((task) => ['open', 'in_progress', 'waiting'].includes(task.status)).length;
    const dueToday = items.filter((task) => taskUrgency(task) === 'today').length;
    const overdue = items.filter((task) => taskUrgency(task) === 'overdue').length;
    const done = items.filter((task) => task.status === 'done').length;
    els.metricOpen.textContent = String(openTotal);
    els.metricDueToday.textContent = String(dueToday);
    els.metricOverdue.textContent = String(overdue);
    els.metricDone.textContent = String(done);
  }

  function renderTaskCard(task) {
    const commentsCount = taskComments(task.id).length;
    const watchersCount = taskWatchers(task.id).length;
    const attachmentsCount = taskAttachments(task.id).length;
    const creatorName = memberDisplayName(task.created_by, task.created_by_email);
    const assigneeName = trimText(task.assigned_to, 120) || lowerEmail(task.assigned_to_email)
      ? memberDisplayName(task.assigned_to, task.assigned_to_email)
      : 'Unassigned';
    const dueText = task.due_at ? formatDateTime(task.due_at) : 'No due date';
    const countdown = taskCountdown(task);
    const reminderStatus = buildReminderStatusCopy(task);
    const statusOptions = STATUS_ORDER.map((status) => (
      `<option value="${status}"${task.status === status ? ' selected' : ''}>${STATUS_LABELS[status]}</option>`
    )).join('');
    const tagBadges = (task.tags || [])
      .slice(0, 4)
      .map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`)
      .join('');
    const linkedBadge = trimText(task.linked_module, 80)
      ? `<span class="badge">${escapeHtml(task.linked_module)}</span>`
      : '';
    return `
      <article class="task-card" data-id="${escapeHtml(task.id)}" data-urgency="${escapeHtml(taskUrgency(task))}" data-status="${escapeHtml(task.status)}">
        <div class="task-card__main">
          <div class="task-card__head">
            <div class="task-card__title-wrap">
              <h3 class="task-card__title">${escapeHtml(task.title)}</h3>
              <div class="task-card__meta">
                <span class="badge badge--status-${escapeHtml(task.status)}">${escapeHtml(STATUS_LABELS[task.status] || 'Open')}</span>
                <span class="badge badge--priority-${escapeHtml(task.priority)}">${escapeHtml(PRIORITY_LABELS[task.priority] || 'Medium')}</span>
                ${taskUrgencyBadge(task)}
                ${taskCountdownBadge(task)}
                ${reminderIndicator(task)}
                ${linkedBadge}
                ${tagBadges}
              </div>
            </div>
          </div>
          <p class="task-card__desc">${escapeHtml(trimText(task.description, 380) || 'No extended note yet.')}</p>
          <div class="task-card__footer">
            <span>Creator: <strong>${escapeHtml(creatorName)}</strong></span>
            <span>Assigned: <strong>${escapeHtml(assigneeName)}</strong></span>
            <span>Due: <strong>${escapeHtml(dueText)}</strong>${countdown ? ` · ${escapeHtml(countdown.label)}` : ''}</span>
            <span>Reminder: <strong>${escapeHtml(reminderStatus.text)}</strong></span>
            <span>${pluralize(commentsCount, 'comment')}</span>
            <span>${pluralize(watchersCount, 'watcher')}</span>
            <span>${pluralize(attachmentsCount, 'file')}</span>
          </div>
        </div>
        <div class="task-card__side">
          <div class="task-card__controls">
            <select data-action="status" data-id="${escapeHtml(task.id)}" aria-label="Change task status">
              ${statusOptions}
            </select>
          </div>
          <div class="task-card__actions">
            <button class="btn secondary small task-card__open" type="button" data-action="open" data-id="${escapeHtml(task.id)}">Open details</button>
            <button class="btn soft small" type="button" data-action="done" data-id="${escapeHtml(task.id)}"${task.status === 'done' || task.status === 'archived' ? ' disabled' : ''}>Mark done</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderTasksTab() {
    const items = filteredTasks();
    els.tasksList.innerHTML = items.map(renderTaskCard).join('');
    els.tasksEmpty.hidden = items.length > 0;
  }

  function renderBoardTab() {
    const items = filteredTasks().filter((task) => task.status !== 'archived');
    const columns = BOARD_STATUSES.map((status) => {
      const columnTasks = items.filter((task) => task.status === status);
      const cards = columnTasks.length
        ? columnTasks.map((task) => `
            <article class="board-card" data-id="${escapeHtml(task.id)}" data-urgency="${escapeHtml(taskUrgency(task))}">
              <h4>${escapeHtml(task.title)}</h4>
              <p>${escapeHtml(trimText(task.description, 120) || 'No description yet.')}</p>
              <div class="task-card__meta">
                <span class="badge badge--priority-${escapeHtml(task.priority)}">${escapeHtml(PRIORITY_LABELS[task.priority] || 'Medium')}</span>
                ${taskUrgencyBadge(task)}
                ${taskCountdownBadge(task)}
              </div>
              <p>Assigned: ${escapeHtml(
                trimText(task.assigned_to, 120) || lowerEmail(task.assigned_to_email)
                  ? memberDisplayName(task.assigned_to, task.assigned_to_email)
                  : 'Unassigned'
              )}</p>
              <p>Due: ${escapeHtml(task.due_at ? formatDateTime(task.due_at) : 'No due date')}${taskCountdown(task) ? ` · ${escapeHtml(taskCountdown(task).label)}` : ''}</p>
              <button class="btn secondary small" type="button" data-action="open" data-id="${escapeHtml(task.id)}">Open</button>
            </article>
          `).join('')
        : '<div class="empty"><strong>No tasks in this column.</strong><p class="muted">Status changes update here live.</p></div>';
      return `
        <section class="board-column">
          <div class="board-column__head">
            <h3>${escapeHtml(STATUS_LABELS[status])}</h3>
            <span class="board-column__count">${columnTasks.length}</span>
          </div>
          ${cards}
        </section>
      `;
    }).join('');
    els.boardColumns.innerHTML = columns;
  }

  function renderAuditEntry(entry) {
    const actor = trimText(entry.actor_email, 120)
      ? memberDisplayName(entry.actor_user_id, entry.actor_email)
      : 'System';
    const taskLabel = entry.task_id ? (findTask(entry.task_id)?.title || entry.task_id) : (entry.entity_id || 'task');
    const details = [];
    if (entry.old_data && Object.keys(entry.old_data).length) {
      details.push(`Old: ${JSON.stringify(entry.old_data, null, 2)}`);
    }
    if (entry.new_data && Object.keys(entry.new_data).length) {
      details.push(`New: ${JSON.stringify(entry.new_data, null, 2)}`);
    }
    if (entry.metadata && Object.keys(entry.metadata).length) {
      details.push(`Meta: ${JSON.stringify(entry.metadata, null, 2)}`);
    }
    return `
      <article class="audit-item">
        <div class="audit-item__top">
          <div>
            <div class="audit-item__title">${escapeHtml(actionLabel(entry.action_type))}</div>
            <div class="audit-item__meta">${escapeHtml(actor)} · ${escapeHtml(formatDateTime(entry.created_at))}</div>
          </div>
          ${entry.task_id ? `<button class="btn secondary small" type="button" data-action="open" data-id="${escapeHtml(entry.task_id)}">Open task</button>` : ''}
        </div>
        <div class="audit-item__meta">Affected item: ${escapeHtml(taskLabel)}</div>
        ${details.length ? `<pre>${escapeHtml(details.join('\n\n'))}</pre>` : ''}
      </article>
    `;
  }

  function renderAuditTab() {
    els.auditList.innerHTML = state.audit.map(renderAuditEntry).join('');
    els.auditEmpty.hidden = state.audit.length > 0;
  }

  function renderMiniTask(task) {
    if (!task) {
      return '<div class="mini-card"><p class="muted">Nothing to show here yet.</p></div>';
    }
    return `
      <article class="mini-card">
        <h4>${escapeHtml(task.title)}</h4>
        <p>${escapeHtml(trimText(task.description, 120) || 'No description yet.')}</p>
        <div class="task-card__meta">
          <span class="badge badge--status-${escapeHtml(task.status)}">${escapeHtml(STATUS_LABELS[task.status] || 'Open')}</span>
          ${taskUrgencyBadge(task)}
          ${taskCountdownBadge(task)}
        </div>
        <button class="btn secondary small" type="button" data-action="open" data-id="${escapeHtml(task.id)}">Open</button>
      </article>
    `;
  }

  function renderMineTab() {
    const assigned = filteredTasks().filter((task) => isAssignedToCurrentUser(task)).slice(0, 6);
    const created = filteredTasks().filter((task) => isTaskCreator(task)).slice(0, 6);
    const watching = filteredTasks().filter((task) => isWatchedByCurrentUser(task.id)).slice(0, 6);

    els.mineAssignedList.innerHTML = (assigned.length ? assigned : [null]).map(renderMiniTask).join('');
    els.mineCreatedList.innerHTML = (created.length ? created : [null]).map(renderMiniTask).join('');
    els.mineWatchingList.innerHTML = (watching.length ? watching : [null]).map(renderMiniTask).join('');
  }

  function renderSettingsTab() {
    els.settingDueSoonDays.value = String(state.settings.dueSoonDays);
    els.settingDefaultPriority.value = state.settings.defaultPriority;
    els.settingReminderRecipients.value = state.settings.reminderRecipientMode;
    els.settingActivityRecipients.value = state.settings.activityRecipientMode || state.settings.reminderRecipientMode;
    els.settingAssignmentEmails.checked = state.settings.assignmentEmailNotifications !== false;
    els.settingCollapseDone.checked = state.settings.collapseDoneByDefault;
    els.settingActivityEmails.checked = state.settings.activityEmailNotifications !== false;
    els.settingMentionEmails.checked = state.settings.mentionEmailNotifications !== false;
    const delivery = state.emailDelivery || {};
    els.emailStatusNote.textContent = delivery.ready
      ? `Team Tasks emails are live via ${String(delivery.preferredProvider || '').toUpperCase()}.`
      : 'Team Tasks email delivery still needs attention.';
    setStatusNoteTone(els.emailStatusNote, delivery.ready ? 'ok' : 'warn');
    if (els.emailStatusDetail) {
      const senderLabel = trimText(delivery.senderEmail, 160) || 'No sender saved';
      const smtpLine = delivery.smtp?.message || 'SMTP status unavailable.';
      const resendLine = delivery.resend?.message || 'Resend status unavailable.';
      els.emailStatusDetail.innerHTML = delivery.ready
        ? `<strong>Sender:</strong> ${escapeHtml(senderLabel)}<br><strong>SMTP:</strong> ${escapeHtml(smtpLine)}<br><strong>Resend:</strong> ${escapeHtml(resendLine)}`
        : `<strong>Delivery check:</strong> ${escapeHtml(trimText(delivery.message, 240) || 'Email delivery is not configured.')}`;
      setStatusNoteTone(els.emailStatusDetail, delivery.ready ? 'ok' : 'warn');
    }
    els.schemaStatusNote.textContent = state.schemaReady
      ? 'Supabase schema checks passed for Team Tasks.'
      : (state.schemaMessage || 'Team Tasks schema is still missing required tables or columns.');
    setStatusNoteTone(els.schemaStatusNote, state.schemaReady ? 'ok' : 'warn');
    const diagnostics = state.calendar.diagnostics || {};
    const connections = Array.isArray(state.calendar.connections) ? state.calendar.connections : [];
    const currentConnection = connections.find((connection) => connection.isCurrentUser && connection.connected) || null;
    if (els.calendarRuntimeNote) {
      if (!diagnostics.enabled) {
        els.calendarRuntimeNote.textContent = 'Microsoft calendar sync is disabled. Turn it on in Admin Settings after the app details are ready.';
      } else if (!diagnostics.setupReady) {
        els.calendarRuntimeNote.textContent = 'Microsoft calendar sync is not fully configured yet. Save the app details in Admin Settings before connecting calendars.';
      } else {
        els.calendarRuntimeNote.textContent = 'Microsoft calendar sync is configured. Connected Outlook / Teams diaries can now feed into the weekly planner.';
      }
    }
    if (els.calendarConnectionSummary) {
      els.calendarConnectionSummary.textContent = currentConnection
        ? `Your calendar is connected as ${currentConnection.externalAccountEmail || currentConnection.userEmail}. ${pluralize(connections.filter((connection) => connection.connected).length, 'team calendar')} currently feed into the weekly planner.`
        : `${pluralize(connections.filter((connection) => connection.connected).length, 'team calendar')} currently connected. Use the connect button here or in the weekly planner to link your own Outlook / Teams diary.`;
    }
  }

  function renderTabs() {
    const tabIds = ['tasks', 'board', 'audit', 'mine', 'settings'];
    tabIds.forEach((tabId) => {
      const button = els[`tabBtn${tabId.charAt(0).toUpperCase()}${tabId.slice(1)}`];
      const panel = els[`tab${tabId.charAt(0).toUpperCase()}${tabId.slice(1)}`];
      const active = state.activeTab === tabId;
      if (button) {
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (panel) {
        panel.hidden = !active;
      }
    });
  }

  function renderToolbar() {
    const buttons = Array.from(els.scopeChips?.querySelectorAll('button[data-scope]') || []);
    buttons.forEach((button) => {
      const pressed = button.getAttribute('data-scope') === state.filters.scope;
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
    els.toggleDoneBtn.setAttribute('aria-pressed', state.filters.showDone ? 'true' : 'false');
    els.toggleDoneBtn.textContent = state.filters.showDone ? 'Hide done in active views' : 'Show done in active views';
    els.searchInput.value = state.filters.query;
    els.assigneeFilter.value = state.filters.assignee;
    els.sortFilter.value = state.filters.sort;
  }

  function renderComments(task) {
    const comments = taskComments(task.id);
    els.commentsList.innerHTML = comments.map((comment) => {
      const author = memberDisplayName(comment.created_by, comment.created_by_email);
      const canEdit = isCommentAuthor(comment);
      const mentions = commentMentions(comment.id);
      const mentionHtml = mentions.length
        ? `<div class="comment__mentions">${mentions.map((mention) => (
          `<span class="badge">${escapeHtml(trimText(mention.mentioned_display_name, 160) || memberDisplayName(mention.mentioned_user_id, mention.mentioned_email))}</span>`
        )).join('')}</div>`
        : '';
      return `
        <article class="comment">
          <div class="comment__top">
            <div>
              <div class="comment__author">${escapeHtml(author)}</div>
              <div class="comment__meta">${escapeHtml(formatDateTime(comment.updated_at || comment.created_at))}${comment.updated_at && comment.updated_at !== comment.created_at ? ' · edited' : ''}</div>
            </div>
            ${canEdit ? `<div class="comment__actions"><button class="btn secondary small" type="button" data-action="edit-comment" data-id="${escapeHtml(comment.id)}">Edit</button></div>` : ''}
          </div>
          <p class="comment__body">${escapeHtml(comment.comment_body)}</p>
          ${mentionHtml}
        </article>
      `;
    }).join('');
    els.commentsEmpty.hidden = comments.length > 0;

    if (state.commentEditId) {
      const comment = state.comments.find((item) => item.id === state.commentEditId);
      const mentionValues = comment ? commentMentions(comment.id).map((mention) => (
        resolveMemberOptionValue(mention.mentioned_user_id, mention.mentioned_email)
      )).filter(Boolean) : [];
      els.commentEditMeta.textContent = comment ? `Editing your comment from ${formatDateTime(comment.updated_at || comment.created_at)}` : '';
      els.cancelCommentEditBtn.hidden = !comment;
      els.commentSubmitBtn.textContent = comment ? 'Save comment' : 'Post comment';
      if (comment && els.commentBody.value !== comment.comment_body) {
        els.commentBody.value = comment.comment_body || '';
      }
      setMultiSelectValues(els.commentMentions, mentionValues);
    } else {
      els.commentEditMeta.textContent = '';
      els.cancelCommentEditBtn.hidden = true;
      els.commentSubmitBtn.textContent = 'Post comment';
      setMultiSelectValues(els.commentMentions, []);
    }
  }

  function attachmentUrl(attachment, download) {
    const id = trimText(attachment?.id, 120);
    if (!id) return '#';
    return `${ATTACHMENT_URL_ENDPOINT}?id=${encodeURIComponent(id)}${download ? '&download=1' : ''}`;
  }

  function renderAttachments(task) {
    const attachments = taskAttachments(task.id);
    els.attachmentsList.innerHTML = attachments.map((attachment) => {
      const uploader = memberDisplayName(attachment.uploaded_by, attachment.uploaded_by_email);
      const createdAt = formatDateTime(attachment.created_at);
      return `
        <article class="attachment">
          <div class="attachment__top">
            <div>
              <div class="attachment__name">${escapeHtml(attachment.file_name || 'Task file')}</div>
              <div class="attachment__meta">${escapeHtml(formatFileSize(attachment.file_size_bytes))} · ${escapeHtml(trimText(attachment.mime_type, 120) || 'unknown type')} · Uploaded by ${escapeHtml(uploader)} · ${escapeHtml(createdAt)}</div>
            </div>
            <div class="attachment__actions">
              <a class="btn secondary small" href="${escapeHtml(attachmentUrl(attachment, false))}" target="_blank" rel="noreferrer">Open</a>
              <a class="btn soft small" href="${escapeHtml(attachmentUrl(attachment, true))}" rel="noreferrer">Download</a>
              <button class="btn danger small" type="button" data-action="delete-attachment" data-id="${escapeHtml(attachment.id)}">Delete</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
    els.attachmentsEmpty.hidden = attachments.length > 0;
  }

  function renderDrawerAudit(task) {
    const entries = taskAuditEntries(task.id);
    els.drawerAuditList.innerHTML = entries.length
      ? entries.map(renderAuditEntry).join('')
      : '<div class="empty"><strong>No activity yet.</strong><p class="muted">Changes to this task will appear here automatically.</p></div>';
  }

  function renderDrawer() {
    const task = currentTask();
    if (!task) {
      closeDrawer();
      return;
    }

    const creatorName = memberDisplayName(task.created_by, task.created_by_email);
    const canEditSource = isTaskCreator(task);
    const reminderMode = REMINDER_MODES.includes(task.reminder_mode) ? task.reminder_mode : 'none';
    const countdown = taskCountdown(task);
    const watcherValues = taskWatchers(task.id)
      .map((watcher) => resolveMemberOptionValue(watcher.user_id, watcher.user_email))
      .filter(Boolean);
    const assignmentRecipient = assignmentEmailRecipient(task);
    const reminderRecipients = taskReminderRecipients(task);
    const reminderStatus = buildReminderStatusCopy(task);
    const emailHistory = buildEmailHistoryCopy(task);
    const metaBits = [
      `<span class="badge">${escapeHtml(creatorName)}</span>`,
      `<span class="badge">Created ${escapeHtml(formatDateTime(task.created_at))}</span>`,
      `<span class="badge">Updated ${escapeHtml(formatDateTime(task.updated_at || task.created_at))}</span>`,
      countdown && !['done', 'archived'].includes(task.status) ? `<span class="badge ${escapeHtml(countdown.badgeClass)}">${escapeHtml(countdown.label)}</span>` : '',
      task.completed_at ? `<span class="badge badge--status-done">Completed ${escapeHtml(formatDateTime(task.completed_at))}</span>` : '',
    ].filter(Boolean).join('');

    els.drawerTitle.textContent = task.title || 'Task';
    els.drawerMeta.innerHTML = metaBits;
    els.detailTitle.value = task.title || '';
    els.detailDescription.value = task.description || '';
    els.detailStatus.value = task.status || 'open';
    els.detailPriority.value = task.priority || 'medium';
    els.detailAssignedTo.value = resolveMemberOptionValue(task.assigned_to, task.assigned_to_email);
    els.detailDueAt.value = toLocalInputValue(task.due_at);
    els.detailReminderEnabled.checked = task.reminder_enabled === true;
    els.detailReminderMode.value = reminderMode;
    els.detailReminderCustomAt.value = toLocalInputValue(task.reminder_custom_at);
    els.detailLinkedModule.value = task.linked_module || '';
    els.detailLinkedUrl.value = task.linked_url || '';
    els.detailTags.value = (task.tags || []).join(', ');
    setMultiSelectValues(els.detailWatchers, watcherValues);
    els.uploadAttachmentBtn.disabled = state.attachmentUploadBusy;
    if (els.detailReminderSummary) {
      els.detailReminderSummary.textContent = reminderStatus.text;
      setStatusNoteTone(els.detailReminderSummary, reminderStatus.tone);
    }
    if (els.detailEmailRecipients) {
      els.detailEmailRecipients.innerHTML = [
        `<strong>Assignment:</strong> ${escapeHtml(assignmentRecipient ? (assignmentRecipient.displayName || assignmentRecipient.email) : 'No assignee email yet.')}`,
        `<br><strong>Reminders:</strong> ${escapeHtml(formatRecipients(reminderRecipients))}`,
      ].join('');
      setStatusNoteTone(els.detailEmailRecipients, reminderRecipients.length || assignmentRecipient ? 'ok' : 'warn');
    }
    if (els.detailEmailHistory) {
      els.detailEmailHistory.textContent = emailHistory.text;
      setStatusNoteTone(els.detailEmailHistory, emailHistory.tone);
    }
    if (els.sendAssignmentEmailBtn) {
      els.sendAssignmentEmailBtn.disabled = !state.emailConfigured || !assignmentRecipient;
    }
    if (els.sendReminderNowBtn) {
      els.sendReminderNowBtn.disabled = !state.emailConfigured || !reminderRecipients.length;
    }

    ['detailTitle', 'detailDescription', 'detailLinkedModule', 'detailLinkedUrl', 'detailTags'].forEach((id) => {
      if (els[id]) {
        els[id].disabled = !canEditSource;
      }
    });
    els.creatorEditNote.hidden = canEditSource;
    els.deleteTaskBtn.hidden = !canEditSource;
    els.archiveTaskBtn.textContent = task.status === 'archived' ? 'Restore task' : 'Archive task';
    els.markDoneBtn.hidden = task.status === 'done' || task.status === 'archived';
    renderComments(task);
    renderAttachments(task);
    renderDrawerAudit(task);

    els.detailDrawerShell.classList.add('is-open');
    els.detailDrawerShell.setAttribute('aria-hidden', 'false');
    updateQueryState({ taskId: task.id });
  }

  function renderAll() {
    renderHeroSummary();
    renderBanner();
    renderMetrics();
    renderQuickAddAids();
    renderToolbar();
    renderTasksTab();
    renderBoardTab();
    renderAuditTab();
    renderMineTab();
    renderSettingsTab();
    renderWeeklyPlanner();
    renderOperationsPanels();
    renderTabs();
    if (state.selectedTaskId) {
      renderDrawer();
    }
  }

  async function fetchConfig(force = false) {
    if (!force && state.configLoaded && state.accessToken && Date.now() < (state.tokenExpiresAt - 60000)) {
      return;
    }

    const payload = await state.helpers.api(CONFIG_ENDPOINT, 'POST', {});
    const shouldSeedShowDone = !state.configLoaded;
    state.accessToken = trimText(payload.accessToken, 5000);
    state.tokenExpiresAt = Date.parse(payload.expiresAt || '') || 0;
    state.supabaseUrl = trimText(payload.supabaseUrl, 500);
    state.supabaseAnonKey = trimText(payload.supabaseAnonKey, 5000);
    state.schemaReady = payload.schemaReady !== false;
    state.schemaMessage = trimText(payload.schemaMessage, 600);
    state.emailConfigured = payload.emailConfigured === true;
    state.emailDelivery = payload.emailDelivery && typeof payload.emailDelivery === 'object'
      ? payload.emailDelivery
      : state.emailDelivery;
    state.siteUrl = trimText(payload.siteUrl, 500).replace(/\/$/, '');
    state.settings = normaliseSettings(payload.settings);
    state.members = normaliseMembers(payload.members || []);
    state.currentUser = {
      ...normaliseMember(payload.currentUser || {}),
      roles: Array.isArray(payload.currentUser?.roles) ? payload.currentUser.roles : [],
    };
    state.configLoaded = true;
    if (typeof payload.currentUser?.email === 'string' && state.who) {
      state.who.email = payload.currentUser.email;
    }
    populateMemberInputs();
    setQuickFormDefaults();
    if (shouldSeedShowDone) {
      state.filters.showDone = state.settings.collapseDoneByDefault === false;
    }
    if (state.client?.realtime?.setAuth && state.accessToken) {
      try {
        state.client.realtime.setAuth(state.accessToken);
      } catch {}
    }
  }

  async function loadCalendarStatus(options = {}) {
    if (!state.helpers?.api) return;
    const { silent = false } = options;
    const range = plannerRange();
    try {
      state.calendar.loading = true;
      if (!silent) renderWeeklyPlanner();
      const payload = await state.helpers.api(CALENDAR_STATUS_ENDPOINT, 'POST', {
        startAt: range.startAt,
        endAt: range.endAt,
        includeEvents: true,
      });
      state.calendar.settings = payload?.settings || state.calendar.settings;
      state.calendar.diagnostics = payload?.diagnostics || state.calendar.diagnostics;
      state.calendar.connections = Array.isArray(payload?.connections) ? payload.connections : [];
      state.calendar.events = Array.isArray(payload?.events) ? payload.events : [];
    } catch (error) {
      state.calendar.events = [];
      state.calendar.connections = [];
      state.calendar.notice = error?.message || 'Unable to load Outlook / Teams diary data.';
    } finally {
      state.calendar.loading = false;
      renderWeeklyPlanner();
      renderSettingsTab();
    }
  }

  async function startCalendarConnectFlow() {
    const diagnostics = state.calendar.diagnostics || {};
    if (!(diagnostics.setupReady && diagnostics.enabled)) {
      state.helpers?.toast?.err('Finish the Microsoft calendar setup in Admin Settings first.', 4200);
      return;
    }
    try {
      const payload = await state.helpers.api('admin-team-tasks-calendar-connect', 'POST', {
        returnTo: `${window.location.origin}/admin/team-tasks.html`,
      });
      if (!trimText(payload?.url, 4000)) {
        throw new Error('Microsoft calendar connection URL was not returned.');
      }
      window.location.href = payload.url;
    } catch (error) {
      state.helpers?.toast?.err(error?.message || 'Unable to start Microsoft calendar connection.', 5200);
    }
  }

  async function disconnectCalendarConnection() {
    try {
      await state.helpers.api(CALENDAR_DISCONNECT_ENDPOINT, 'POST', {});
      state.calendar.notice = 'Microsoft calendar disconnected.';
      await loadCalendarStatus({ silent: true });
      state.helpers.toast.ok('Calendar disconnected.', 2400);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to disconnect Microsoft calendar.', 5200);
    }
  }

  async function loadSupabaseModule() {
    if (!state.supabaseModulePromise) {
      state.supabaseModulePromise = import(SUPABASE_ESM_URL);
    }
    return state.supabaseModulePromise;
  }

  async function ensureClient() {
    await fetchConfig(false);
    if (state.client && typeof state.client.from === 'function') {
      return state.client;
    }
    const moduleRef = await loadSupabaseModule();
    const createClient = moduleRef?.createClient;
    if (typeof createClient !== 'function') {
      throw new Error('Supabase browser client could not be loaded.');
    }
    if (!state.supabaseUrl || !state.supabaseAnonKey) {
      throw new Error('Supabase public configuration is missing for Team Tasks.');
    }
    state.client = createClient(state.supabaseUrl, state.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 12 },
      },
      accessToken: async () => {
        if (Date.now() >= (state.tokenExpiresAt - 60000)) {
          await fetchConfig(true);
        }
        return state.accessToken || null;
      },
    });
    if (state.client?.realtime?.setAuth && state.accessToken) {
      try {
        state.client.realtime.setAuth(state.accessToken);
      } catch {}
    }
    return state.client;
  }

  function looksLikeMissingRelation(error) {
    const message = trimText(error?.message, 400).toLowerCase();
    return message.includes('does not exist') || message.includes('could not find') || message.includes('relation');
  }

  async function loadAllData(options = {}) {
    if (!state.schemaReady) {
      renderAll();
      return;
    }
    const silent = options.silent === true;
    state.loading = !silent;
    renderHeroSummary();

    try {
      await fetchConfig(false);
      const client = await ensureClient();
      const [
        tasksResult,
        commentsResult,
        commentMentionsResult,
        watchersResult,
        attachmentsResult,
        remindersResult,
        auditResult,
      ] = await Promise.all([
        client.from('task_items').select('*').order('archived_at', { ascending: true, nullsFirst: true }).order('updated_at', { ascending: false }),
        client.from('task_comments').select('*').order('created_at', { ascending: true }),
        client.from('task_comment_mentions').select('*').order('created_at', { ascending: true }),
        client.from('task_watchers').select('*').order('created_at', { ascending: true }),
        client.from('task_attachments').select('*').order('created_at', { ascending: false }),
        client.from('task_reminders').select('*').order('send_at', { ascending: true }),
        client.from('task_audit_log').select('*').order('created_at', { ascending: false }).limit(300),
      ]);

      const firstError = [tasksResult, commentsResult, commentMentionsResult, watchersResult, attachmentsResult, remindersResult, auditResult]
        .map((result) => result.error)
        .find(Boolean);
      if (firstError) throw firstError;

      state.tasks = Array.isArray(tasksResult.data) ? tasksResult.data : [];
      state.comments = Array.isArray(commentsResult.data) ? commentsResult.data : [];
      state.commentMentions = Array.isArray(commentMentionsResult.data) ? commentMentionsResult.data : [];
      state.watchers = Array.isArray(watchersResult.data) ? watchersResult.data : [];
      state.attachments = Array.isArray(attachmentsResult.data) ? attachmentsResult.data : [];
      state.reminders = Array.isArray(remindersResult.data) ? remindersResult.data : [];
      state.audit = Array.isArray(auditResult.data) ? auditResult.data : [];
      renderAll();
    } catch (error) {
      if (looksLikeMissingRelation(error)) {
        state.schemaReady = false;
        state.schemaMessage = error?.message || 'Team Tasks schema is missing.';
      }
      state.helpers.toast.err(error?.message || 'Unable to load Team Tasks.', 5200);
      renderAll();
    } finally {
      state.loading = false;
      renderHeroSummary();
    }
  }

  function scheduleReload() {
    window.clearTimeout(state.reloadTimer);
    state.reloadTimer = window.setTimeout(() => {
      loadAllData({ silent: true });
    }, 260);
  }

  async function setupRealtime() {
    if (!state.schemaReady) return;
    const client = await ensureClient();
    if (!client || state.realtimeChannel) return;

    const channel = client.channel('hmj-team-tasks-live');
    ['task_items', 'task_comments', 'task_comment_mentions', 'task_watchers', 'task_attachments', 'task_reminders', 'task_audit_log'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        scheduleReload();
      });
    });

    channel.subscribe((status) => {
      state.realtimeState = status;
      renderHeroSummary();
    });
    state.realtimeChannel = channel;
  }

  async function quickUpdateTask(taskId, patch) {
    const task = findTask(taskId);
    if (!task) return;
    try {
      const client = await ensureClient();
      const payload = {
        ...patch,
      };
      const { error } = await client
        .from('task_items')
        .update(payload)
        .eq('id', taskId);
      if (error) throw error;
      state.helpers.toast.ok('Task updated.', 2800);
      await loadAllData({ silent: true });
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to update task.', 5200);
    }
  }

  async function syncTaskWatchers(taskId, watcherKeys) {
    const client = await ensureClient();
    const desiredMembers = dedupeRecipients((watcherKeys || []).map((value) => {
      const member = findMemberByKey(value);
      return member || { userId: value, email: lowerEmail(value) };
    }));
    const existing = taskWatchers(taskId);

    const removeIds = existing
      .filter((item) => !desiredMembers.some((member) => sameActor(
        member.userId,
        member.email,
        item.user_id,
        item.user_email
      )))
      .map((item) => item.id);
    if (removeIds.length) {
      const { error } = await client
        .from('task_watchers')
        .delete()
        .in('id', removeIds);
      if (error) throw error;
    }

    const inserts = desiredMembers
      .filter((item) => !existing.some((existingRow) => sameActor(
        item.userId,
        item.email,
        existingRow.user_id,
        existingRow.user_email
      )))
      .map((item) => ({
        task_id: taskId,
        user_id: trimText(item.userId, 120) || lowerEmail(item.email),
        user_email: lowerEmail(item.email),
      }));
    if (inserts.length) {
      const { error } = await client
        .from('task_watchers')
        .insert(inserts);
      if (error) throw error;
    }
  }

  async function syncTaskReminders(task, watcherKeys, reminderEnabled, reminderMode, reminderCustomAt) {
    const client = await ensureClient();
    const shouldEnable = reminderEnabled === true && reminderMode !== 'none';
    const sendAt = computeReminderSendAt(task.due_at, reminderMode, reminderCustomAt);
    const existing = taskReminders(task.id);

    const removableIds = existing
      .filter((row) => row.status !== 'sent')
      .map((row) => row.id);
    if (removableIds.length) {
      const { error } = await client
        .from('task_reminders')
        .delete()
        .in('id', removableIds);
      if (error) throw error;
    }

    if (!shouldEnable || !sendAt) return;

    const watcherRows = (watcherKeys || []).map((value) => {
      const member = findMemberByKey(value);
      return member || { userId: value, email: lowerEmail(value) };
    });
    const recipients = buildReminderRecipients(task, watcherRows);
    if (!recipients.length) return;

    const inserts = recipients.map((recipient) => ({
      task_id: task.id,
      recipient_user_id: trimText(recipient.userId, 120) || null,
      recipient_email: lowerEmail(recipient.email) || null,
      reminder_mode: reminderMode,
      send_at: sendAt,
      status: 'pending',
    }));
    const { error } = await client
      .from('task_reminders')
      .insert(inserts);
    if (error) throw error;
  }

  async function syncCommentMentions(commentId, taskId, mentionKeys) {
    const client = await ensureClient();
    const existing = commentMentions(commentId);
    const desiredMentions = dedupeRecipients((mentionKeys || []).map((value) => {
      const member = findMemberByKey(value);
      return member || { userId: value, email: lowerEmail(value) };
    }));

    const removeIds = existing
      .filter((mention) => !desiredMentions.some((member) => sameActor(
        member.userId,
        member.email,
        mention.mentioned_user_id,
        mention.mentioned_email
      )))
      .map((mention) => mention.id);
    if (removeIds.length) {
      const { error } = await client
        .from('task_comment_mentions')
        .delete()
        .in('id', removeIds);
      if (error) throw error;
    }

    const inserts = desiredMentions
      .filter((member) => !existing.some((mention) => sameActor(
        member.userId,
        member.email,
        mention.mentioned_user_id,
        mention.mentioned_email
      )))
      .map((member) => ({
        task_id: taskId,
        comment_id: commentId,
        mentioned_user_id: trimText(member.userId, 120) || null,
        mentioned_email: lowerEmail(member.email) || null,
        mentioned_display_name: trimText(member.displayName, 160) || null,
        created_by: trimText(currentUser().userId, 120) || lowerEmail(currentUser().email) || null,
        created_by_email: lowerEmail(currentUser().email) || null,
      }));
    if (inserts.length) {
      const { error } = await client
        .from('task_comment_mentions')
        .insert(inserts);
      if (error) throw error;
    }
  }

  async function notifyTaskActivity(payload) {
    if (!state.emailConfigured) return;
    try {
      await state.helpers.api(NOTIFY_ENDPOINT, 'POST', payload);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Task notification email could not be sent.', 4200);
    }
  }

  async function sendTaskEmail(action, taskId, options = {}) {
    const payload = {
      action,
      taskId,
      force: options.force === true,
    };
    return state.helpers.api(SEND_EMAIL_ENDPOINT, 'POST', payload);
  }

  function assignmentChanged(previousTask, nextTask) {
    const previousKey = [
      trimText(previousTask?.assigned_to, 120),
      lowerEmail(previousTask?.assigned_to_email),
    ].join('|');
    const nextKey = [
      trimText(nextTask?.assigned_to, 120),
      lowerEmail(nextTask?.assigned_to_email),
    ].join('|');
    return !!lowerEmail(nextTask?.assigned_to_email) && nextKey !== previousKey;
  }

  async function maybeSendAssignmentEmail(previousTask, nextTask) {
    if (state.settings.assignmentEmailNotifications === false) {
      return { skipped: true, reason: 'assignment_emails_disabled' };
    }
    if (!assignmentChanged(previousTask, nextTask)) {
      return { skipped: true, reason: 'assignee_unchanged' };
    }
    return sendTaskEmail('assignment', nextTask.id);
  }

  async function sendDrawerEmail(action) {
    const task = currentTask();
    if (!task) return;
    const button = action === 'assignment' ? els.sendAssignmentEmailBtn : els.sendReminderNowBtn;
    if (!button) return;
    button.disabled = true;
    try {
      const result = await sendTaskEmail(action, task.id, { force: true });
      state.helpers.toast.ok(result?.message || 'Email accepted for delivery.', 3600);
      await loadAllData({ silent: true });
      openDrawer(task.id);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to send the task email.', 5200);
    } finally {
      button.disabled = false;
    }
  }

  function attachmentStorageKey(taskId, fileName) {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : String(Date.now()).slice(-8);
    return `tasks/${taskId}/${year}/${month}/${Date.now()}-${suffix}-${normaliseFileName(fileName)}`;
  }

  async function uploadTaskAttachments() {
    const task = currentTask();
    const files = Array.from(els.attachmentFiles?.files || []);
    if (!task || !files.length) {
      state.helpers.toast.err('Choose at least one file first.', 3200);
      return;
    }

    const invalid = files.find((file) => file.size > ATTACHMENT_MAX_BYTES || !resolveAttachmentMimeType(file));
    if (invalid) {
      state.helpers.toast.err('Files must be PDF, Word, or image formats and 15MB or smaller.', 5200);
      return;
    }

    state.attachmentUploadBusy = true;
    els.uploadAttachmentBtn.disabled = true;
    try {
      const client = await ensureClient();
      for (const file of files) {
        const mimeType = resolveAttachmentMimeType(file) || 'application/octet-stream';
        const storagePath = attachmentStorageKey(task.id, file.name);
        const uploadResult = await client.storage.from(TASK_ATTACHMENTS_BUCKET).upload(storagePath, file, {
          contentType: mimeType,
          upsert: false,
        });
        if (uploadResult.error) throw uploadResult.error;

        const insertPayload = {
          task_id: task.id,
          file_name: trimText(file.name, 220) || 'task-file',
          mime_type: mimeType,
          file_size_bytes: file.size,
          storage_bucket: TASK_ATTACHMENTS_BUCKET,
          storage_path: storagePath,
          storage_key: storagePath,
          uploaded_by: trimText(currentUser().userId, 120) || lowerEmail(currentUser().email) || null,
          uploaded_by_email: lowerEmail(currentUser().email) || null,
        };
        const { data, error } = await client
          .from('task_attachments')
          .insert(insertPayload)
          .select('*')
          .single();
        if (error) {
          await client.storage.from(TASK_ATTACHMENTS_BUCKET).remove([storagePath]).catch(() => {});
          throw error;
        }

        await notifyTaskActivity({
          eventType: 'attachment_added',
          taskId: task.id,
          attachmentId: data.id,
        });
      }

      els.attachmentFiles.value = '';
      state.helpers.toast.ok(files.length === 1 ? 'File uploaded.' : `${files.length} files uploaded.`, 3200);
      await loadAllData({ silent: true });
      openDrawer(task.id);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to upload task files.', 5400);
    } finally {
      state.attachmentUploadBusy = false;
      els.uploadAttachmentBtn.disabled = false;
    }
  }

  async function deleteTaskAttachment(attachmentId) {
    const attachment = state.attachments.find((item) => item.id === attachmentId);
    const task = currentTask();
    if (!attachment || !task) return;
    if (!window.confirm(`Delete "${attachment.file_name}" from this task?`)) return;
    try {
      await state.helpers.api(ATTACHMENT_DELETE_ENDPOINT, 'POST', { id: attachmentId });
      state.helpers.toast.ok('File removed.', 2800);
      await loadAllData({ silent: true });
      openDrawer(task.id);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to delete this file.', 5200);
    }
  }

  function quickTaskPayload() {
    const dueAt = fromLocalInputValue(els.quickDueAt.value);
    const reminderMode = REMINDER_MODES.includes(els.quickReminderMode.value) ? els.quickReminderMode.value : 'none';
    const assignedKey = trimText(els.quickAssignedTo.value, 120);
    const assignedMember = findMemberByKey(assignedKey);
    return {
      title: trimText(els.quickTitle.value, 180),
      description: trimText(els.quickDescription.value),
      priority: PRIORITY_LABELS[els.quickPriority.value] ? els.quickPriority.value : state.settings.defaultPriority,
      assigned_to: assignedKey || null,
      assigned_to_email: lowerEmail(assignedMember?.email) || null,
      due_at: dueAt,
      reminder_enabled: reminderMode !== 'none',
      reminder_mode: reminderMode,
      reminder_custom_at: reminderMode === 'custom' ? fromLocalInputValue(els.quickReminderCustomAt.value) : null,
      linked_module: trimText(els.quickLinkedModule.value, 120) || null,
      linked_url: trimText(els.quickLinkedUrl.value, 500) || null,
      tags: parseTags(els.quickTags.value),
      sort_order: 0,
    };
  }

  async function handleQuickAddSubmit(event) {
    event.preventDefault();
    if (!state.schemaReady) {
      state.helpers.toast.err('Apply the Team Tasks schema first, then refresh this page.', 5400);
      return;
    }
    const payload = quickTaskPayload();
    if (!payload.title) {
      setQuickFeedback('Add a task title before saving this item.', 'warn');
      state.helpers.toast.err('Add a task title first.', 3400);
      els.quickTitle.focus();
      return;
    }
    if (payload.reminder_mode !== 'none' && payload.reminder_mode !== 'custom' && !payload.due_at) {
      setQuickFeedback('Preset reminders need a due date. Apply a shortcut or choose a date and time first.', 'warn');
      state.helpers.toast.err('Due date is required for preset reminders.', 4200);
      return;
    }

    els.quickAddBtn.disabled = true;
    els.quickAddBtn.textContent = 'Adding task…';
    setQuickFeedback('Creating the task, syncing watchers/reminders, and triggering any assignment email rules now.', 'ok');
    try {
      const client = await ensureClient();
      const { data, error } = await client
        .from('task_items')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw error;

      const watcherKeys = selectedValues(els.quickWatchers);
      await syncTaskWatchers(data.id, watcherKeys);
      await syncTaskReminders(
        data,
        watcherKeys,
        payload.reminder_enabled,
        payload.reminder_mode,
        els.quickReminderCustomAt.value
      );

      let assignmentMessage = '';
      try {
        const assignmentResult = await maybeSendAssignmentEmail(null, data);
        if (assignmentResult?.message) {
          assignmentMessage = ` ${assignmentResult.message}`;
        }
      } catch (assignmentError) {
        assignmentMessage = '';
        state.helpers.toast.err(assignmentError?.message || 'Task added, but the assignment email could not be sent.', 5200);
      }

      state.helpers.toast.ok(`Task added.${assignmentMessage}`.trim(), 3200);
      els.quickAddForm.reset();
      setAdvancedVisibility(false);
      setQuickFormDefaults();
      setQuickFeedback(`Task created successfully.${assignmentMessage}`.trim(), 'ok');
      await loadAllData({ silent: true });
      openDrawer(data.id);
    } catch (error) {
      setQuickFeedback(error?.message || 'Unable to add the task. Check the required fields and try again.', 'warn');
      state.helpers.toast.err(error?.message || 'Unable to add task.', 5400);
    } finally {
      els.quickAddBtn.disabled = false;
      els.quickAddBtn.textContent = 'Add Task';
    }
  }

  function resetQuickForm() {
    els.quickAddForm.reset();
    setAdvancedVisibility(false);
    setQuickFormDefaults();
  }

  function detailTaskPayload(task) {
    const assignedKey = trimText(els.detailAssignedTo.value, 120);
    const assignedMember = findMemberByKey(assignedKey);
    const reminderMode = REMINDER_MODES.includes(els.detailReminderMode.value) ? els.detailReminderMode.value : 'none';
    const canEditSource = isTaskCreator(task);
    const payload = {
      status: els.detailStatus.value,
      priority: els.detailPriority.value,
      assigned_to: assignedKey || null,
      assigned_to_email: lowerEmail(assignedMember?.email) || null,
      due_at: fromLocalInputValue(els.detailDueAt.value),
      reminder_enabled: els.detailReminderEnabled.checked && reminderMode !== 'none',
      reminder_mode: reminderMode,
      reminder_custom_at: reminderMode === 'custom' ? fromLocalInputValue(els.detailReminderCustomAt.value) : null,
    };
    if (canEditSource) {
      payload.title = trimText(els.detailTitle.value, 180);
      payload.description = trimText(els.detailDescription.value);
      payload.linked_module = trimText(els.detailLinkedModule.value, 120) || null;
      payload.linked_url = trimText(els.detailLinkedUrl.value, 500) || null;
      payload.tags = parseTags(els.detailTags.value);
    }
    return payload;
  }

  async function handleTaskSave() {
    const task = currentTask();
    if (!task) return;
    const payload = detailTaskPayload(task);
    if (isTaskCreator(task) && !trimText(payload.title, 180)) {
      state.helpers.toast.err('Task title cannot be empty.', 3600);
      return;
    }
    if (payload.reminder_mode !== 'none' && payload.reminder_mode !== 'custom' && !payload.due_at) {
      state.helpers.toast.err('Due date is required for preset reminders.', 4200);
      return;
    }

    els.saveTaskBtn.disabled = true;
    try {
      const client = await ensureClient();
      const previousTask = { ...task };
      const { data, error } = await client
        .from('task_items')
        .update(payload)
        .eq('id', task.id)
        .select('*')
        .single();
      if (error) throw error;

      const watcherKeys = selectedValues(els.detailWatchers);
      await syncTaskWatchers(task.id, watcherKeys);
      await syncTaskReminders(
        data,
        watcherKeys,
        payload.reminder_enabled,
        payload.reminder_mode,
        els.detailReminderCustomAt.value
      );

      let assignmentMessage = '';
      try {
        const assignmentResult = await maybeSendAssignmentEmail(previousTask, data);
        if (assignmentResult?.message) {
          assignmentMessage = ` ${assignmentResult.message}`;
        }
      } catch (assignmentError) {
        assignmentMessage = '';
        state.helpers.toast.err(assignmentError?.message || 'Task saved, but the assignment email could not be sent.', 5200);
      }

      state.helpers.toast.ok(`Task saved.${assignmentMessage}`.trim(), 3200);
      await loadAllData({ silent: true });
      openDrawer(task.id);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to save task.', 5400);
    } finally {
      els.saveTaskBtn.disabled = false;
    }
  }

  async function handleDeleteTask() {
    const task = currentTask();
    if (!task) return;
    if (!isTaskCreator(task)) {
      state.helpers.toast.err('Only the task creator can delete this task.', 4200);
      return;
    }
    if (!window.confirm(`Delete "${task.title}"? This will remove the task and its comments.`)) {
      return;
    }
    try {
      const client = await ensureClient();
      const { error } = await client
        .from('task_items')
        .delete()
        .eq('id', task.id);
      if (error) throw error;
      state.helpers.toast.ok('Task deleted.', 2800);
      closeDrawer();
      await loadAllData({ silent: true });
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to delete task.', 5200);
    }
  }

  async function handleArchiveToggle() {
    const task = currentTask();
    if (!task) return;
    const patch = task.status === 'archived'
      ? { status: 'open' }
      : { status: 'archived' };
    await quickUpdateTask(task.id, patch);
    if (task.status !== 'archived') {
      closeDrawer();
    } else {
      openDrawer(task.id);
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    const task = currentTask();
    if (!task) return;
    const body = trimText(els.commentBody.value, 5000);
    const mentionKeys = selectedValues(els.commentMentions);
    if (!body) {
      state.helpers.toast.err('Write a comment first.', 3200);
      return;
    }
    try {
      const client = await ensureClient();
      let commentId = state.commentEditId;
      const isEditing = !!state.commentEditId;
      if (state.commentEditId) {
        const { data, error } = await client
          .from('task_comments')
          .update({ comment_body: body })
          .eq('id', state.commentEditId)
          .select('id')
          .single();
        if (error) throw error;
        commentId = data?.id || commentId;
        state.helpers.toast.ok('Comment updated.', 2800);
      } else {
        const { data, error } = await client
          .from('task_comments')
          .insert({
            task_id: task.id,
            comment_body: body,
          })
          .select('id')
          .single();
        if (error) throw error;
        commentId = data?.id || commentId;
        state.helpers.toast.ok('Comment added.', 2800);
      }
      if (commentId) {
        await syncCommentMentions(commentId, task.id, mentionKeys);
      }
      state.commentEditId = '';
      els.commentBody.value = '';
      setMultiSelectValues(els.commentMentions, []);
      if (!isEditing && commentId) {
        await notifyTaskActivity({
          eventType: 'comment_added',
          taskId: task.id,
          commentId,
        });
      } else if (isEditing && mentionKeys.length && commentId) {
        await notifyTaskActivity({
          eventType: 'mention',
          taskId: task.id,
          commentId,
        });
      }
      await loadAllData({ silent: true });
      openDrawer(task.id);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to save comment.', 5200);
    }
  }

  function beginCommentEdit(commentId) {
    const comment = state.comments.find((item) => item.id === commentId);
    if (!comment) return;
    state.commentEditId = commentId;
    els.commentBody.value = comment.comment_body || '';
    renderDrawer();
    els.commentBody.focus();
  }

  function cancelCommentEdit() {
    state.commentEditId = '';
    els.commentBody.value = '';
    renderDrawer();
  }

  async function handleSettingsSave(event) {
    event.preventDefault();
    const nextSettings = {
      dueSoonDays: Math.min(14, Math.max(1, Number.parseInt(els.settingDueSoonDays.value, 10) || DEFAULT_SETTINGS.dueSoonDays)),
      defaultPriority: PRIORITY_LABELS[els.settingDefaultPriority.value] ? els.settingDefaultPriority.value : DEFAULT_SETTINGS.defaultPriority,
      assignmentEmailNotifications: els.settingAssignmentEmails.checked,
      reminderRecipientMode: trimText(els.settingReminderRecipients.value, 64) || DEFAULT_SETTINGS.reminderRecipientMode,
      activityRecipientMode: trimText(els.settingActivityRecipients.value, 64) || DEFAULT_SETTINGS.activityRecipientMode,
      activityEmailNotifications: els.settingActivityEmails.checked,
      mentionEmailNotifications: els.settingMentionEmails.checked,
      collapseDoneByDefault: els.settingCollapseDone.checked,
    };
    try {
      const response = await state.helpers.api(SETTINGS_SAVE_ENDPOINT, 'POST', {
        settings: {
          team_tasks_settings: nextSettings,
        },
      });
      state.settings = normaliseSettings(response?.settings?.team_tasks_settings || nextSettings);
      state.filters.showDone = state.settings.collapseDoneByDefault === false;
      renderAll();
      state.helpers.toast.ok('Team Tasks settings saved.', 2800);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to save Team Tasks settings.', 5200);
    }
  }

  function openDrawer(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    state.selectedTaskId = taskId;
    state.commentEditId = '';
    renderDrawer();
  }

  function closeDrawer() {
    state.selectedTaskId = '';
    state.commentEditId = '';
    if (els.attachmentFiles) {
      els.attachmentFiles.value = '';
    }
    if (els.detailDrawerShell) {
      els.detailDrawerShell.classList.remove('is-open');
      els.detailDrawerShell.setAttribute('aria-hidden', 'true');
    }
    updateQueryState({ taskId: '' });
  }

  function bindListOpeners(root) {
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action][data-id]');
      if (!button) return;
      const action = trimText(button.getAttribute('data-action'), 40);
      const id = trimText(button.getAttribute('data-id'), 120);
      if (!id) return;
      if (action === 'open') {
        openDrawer(id);
      } else if (action === 'done') {
        quickUpdateTask(id, { status: 'done' });
      }
    });

    root.addEventListener('change', (event) => {
      const select = event.target.closest('select[data-action="status"][data-id]');
      if (!select) return;
      const id = trimText(select.getAttribute('data-id'), 120);
      const status = trimText(select.value, 40);
      if (!id || !STATUS_LABELS[status]) return;
      quickUpdateTask(id, { status });
    });
  }

  function bindEvents() {
    els.quickToggleAdvanced.addEventListener('click', () => {
      setAdvancedVisibility(els.quickAdvanced.hidden);
    });
    els.quickAddForm.addEventListener('submit', handleQuickAddSubmit);
    els.quickResetBtn.addEventListener('click', resetQuickForm);
    els.quickTemplateButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-quick-template]');
      if (!button) return;
      applyQuickTemplate(button.getAttribute('data-quick-template'));
    });
    els.quickDueShortcutButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-due-shortcut]');
      if (!button) return;
      applyDueShortcut(button.getAttribute('data-due-shortcut'));
    });
    els.refreshBtn.addEventListener('click', async () => {
      await loadAllData({ silent: false });
      await loadCalendarStatus({ silent: true });
    });
    els.plannerPrevWeekBtn?.addEventListener('click', () => {
      state.calendar.weekStart = addDaysIso(plannerWeekStart(), -7);
      loadCalendarStatus({ silent: false });
    });
    els.plannerTodayBtn?.addEventListener('click', () => {
      state.calendar.weekStart = startOfWeekIso();
      loadCalendarStatus({ silent: false });
    });
    els.plannerNextWeekBtn?.addEventListener('click', () => {
      state.calendar.weekStart = addDaysIso(plannerWeekStart(), 7);
      loadCalendarStatus({ silent: false });
    });
    els.plannerConnectBtn?.addEventListener('click', startCalendarConnectFlow);
    els.plannerComfortableBtn?.addEventListener('click', () => setPlannerDensity('comfortable'));
    els.plannerCompactBtn?.addEventListener('click', () => setPlannerDensity('compact'));
    els.plannerExpandAllBtn?.addEventListener('click', () => setPlannerExpansionForVisibleDays(true));
    els.plannerCollapseAllBtn?.addEventListener('click', () => setPlannerExpansionForVisibleDays(false));
    els.connectCalendarBtn?.addEventListener('click', startCalendarConnectFlow);
    els.disconnectCalendarBtn?.addEventListener('click', disconnectCalendarConnection);
    els.toggleDoneBtn.addEventListener('click', () => {
      state.filters.showDone = !state.filters.showDone;
      renderAll();
    });
    els.searchInput.addEventListener('input', () => {
      state.filters.query = els.searchInput.value || '';
      renderAll();
    });
    els.assigneeFilter.addEventListener('change', () => {
      state.filters.assignee = els.assigneeFilter.value || 'all';
      renderAll();
    });
    els.sortFilter.addEventListener('change', () => {
      state.filters.sort = els.sortFilter.value || 'urgency';
      renderAll();
    });
    els.scopeChips.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-scope]');
      if (!button) return;
      state.filters.scope = button.getAttribute('data-scope') || 'all';
      renderAll();
    });

    ['Tasks', 'Board', 'Audit', 'Mine', 'Settings'].forEach((label) => {
      const key = label.toLowerCase();
      const button = els[`tabBtn${label}`];
      if (!button) return;
      button.addEventListener('click', () => {
        state.activeTab = key;
        updateQueryState({ tab: key });
        renderTabs();
      });
    });

    bindListOpeners(els.tasksList);
    bindListOpeners(els.plannerGrid);
    bindListOpeners(els.plannerUnscheduledList);
    bindListOpeners(els.boardColumns);
    bindListOpeners(els.auditList);
    bindListOpeners(els.mineAssignedList);
    bindListOpeners(els.mineCreatedList);
    bindListOpeners(els.mineWatchingList);
    bindListOpeners(els.drawerAuditList);
    els.plannerGrid?.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-planner-day]');
      if (!toggle) return;
      const dayKey = trimText(toggle.getAttribute('data-planner-day'), 40);
      if (!dayKey) return;
      const currentExpanded = toggle.getAttribute('aria-expanded') === 'true';
      setPlannerDayExpanded(dayKey, !currentExpanded);
    });
    els.opsOverdueBtn?.addEventListener('click', () => {
      state.filters.scope = 'overdue';
      state.activeTab = 'tasks';
      updateQueryState({ tab: 'tasks' });
      renderAll();
    });
    els.opsMineBtn?.addEventListener('click', () => {
      state.filters.scope = 'my_tasks';
      state.activeTab = 'tasks';
      updateQueryState({ tab: 'tasks' });
      renderAll();
    });
    els.opsBoardBtn?.addEventListener('click', () => {
      state.activeTab = 'board';
      updateQueryState({ tab: 'board' });
      renderTabs();
    });
    els.opsSettingsBtn?.addEventListener('click', () => {
      state.activeTab = 'settings';
      updateQueryState({ tab: 'settings' });
      renderTabs();
    });

    els.closeDrawerBtn.addEventListener('click', closeDrawer);
    els.drawerBackdrop.addEventListener('click', closeDrawer);
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.selectedTaskId) {
        closeDrawer();
      }
    });

    els.saveTaskBtn.addEventListener('click', handleTaskSave);
    els.sendAssignmentEmailBtn?.addEventListener('click', () => sendDrawerEmail('assignment'));
    els.sendReminderNowBtn?.addEventListener('click', () => sendDrawerEmail('reminder'));
    els.markDoneBtn.addEventListener('click', () => {
      const task = currentTask();
      if (task) quickUpdateTask(task.id, { status: 'done' });
    });
    els.archiveTaskBtn.addEventListener('click', handleArchiveToggle);
    els.deleteTaskBtn.addEventListener('click', handleDeleteTask);
    els.commentForm.addEventListener('submit', handleCommentSubmit);
    els.cancelCommentEditBtn.addEventListener('click', cancelCommentEdit);
    els.uploadAttachmentBtn.addEventListener('click', uploadTaskAttachments);
    els.commentsList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="edit-comment"][data-id]');
      if (!button) return;
      beginCommentEdit(button.getAttribute('data-id'));
    });
    els.attachmentsList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="delete-attachment"][data-id]');
      if (!button) return;
      deleteTaskAttachment(button.getAttribute('data-id'));
    });
    els.settingsForm.addEventListener('submit', handleSettingsSave);
  }

  async function initPage(helpers) {
    state.helpers = helpers;
    state.who = await helpers.identity('admin');
    state.activeTab = readQueryTab() || state.activeTab;
    els.welcomeMeta.textContent = `Signed in as ${state.who?.email || state.currentUser.email || 'admin user'}`;
    plannerNoticeFromQuery();

    await fetchConfig(true);
    els.welcomeMeta.textContent = `Signed in as ${state.currentUser.email || state.who?.email || 'admin user'}`;
    renderAll();
    await loadCalendarStatus({ silent: false });

    if (state.schemaReady) {
      await ensureClient();
      await setupRealtime();
      await loadAllData({ silent: false });
      window.clearInterval(state.countdownTimer);
      state.countdownTimer = window.setInterval(() => {
        renderAll();
      }, 60000);
      const queryTaskId = readQueryTaskId();
      if (queryTaskId && findTask(queryTaskId)) {
        openDrawer(queryTaskId);
      }
    }
  }

  function init() {
    cacheElements();
    bindEvents();
    setAdvancedVisibility(false);

    window.Admin.bootAdmin(async (helpers) => {
      try {
        await initPage(helpers);
      } catch (error) {
        state.helpers = helpers;
        helpers.toast.err(error?.message || 'Unable to load Team Tasks.', 5600);
        state.schemaReady = false;
        state.schemaMessage = error?.message || 'Team Tasks failed to load.';
        renderAll();
      }
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
