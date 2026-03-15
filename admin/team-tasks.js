(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const doc = document;
  const SUPABASE_ESM_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  const CONFIG_ENDPOINT = '/admin-team-tasks-config';
  const SETTINGS_SAVE_ENDPOINT = '/admin-settings-save';

  const DEFAULT_SETTINGS = {
    dueSoonDays: 3,
    collapseDoneByDefault: true,
    reminderRecipientMode: 'assignee_creator_watchers',
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
    watchers: [],
    reminders: [],
    audit: [],
    selectedTaskId: '',
    commentEditId: '',
    filters: {
      query: '',
      scope: 'all',
      assignee: 'all',
      sort: 'urgency',
      showDone: false,
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
      'settingCollapseDone',
      'emailStatusNote',
      'schemaStatusNote',
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
      'detailLinkedModule',
      'detailLinkedUrl',
      'detailTags',
      'detailWatchers',
      'commentsList',
      'commentsEmpty',
      'commentForm',
      'commentBody',
      'commentSubmitBtn',
      'cancelCommentEditBtn',
      'commentEditMeta',
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
    return {
      dueSoonDays,
      collapseDoneByDefault,
      defaultPriority,
      reminderRecipientMode,
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

  function taskWatchers(taskId) {
    return state.watchers.filter((watcher) => watcher.task_id === taskId);
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
    return [
      task.title,
      task.description,
      (task.tags || []).join(' '),
      task.linked_module,
      task.linked_url,
      memberDisplayName(task.created_by, task.created_by_email),
      memberDisplayName(task.assigned_to, task.assigned_to_email),
      commentText,
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

  function updateQueryTaskParam(taskId) {
    try {
      const url = new URL(window.location.href);
      if (taskId) url.searchParams.set('task', taskId);
      else url.searchParams.delete('task');
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
  }

  function setMultiSelectValues(select, values) {
    if (!select) return;
    const chosen = new Set((values || []).map((value) => trimText(value, 120)).filter(Boolean));
    Array.from(select.options || []).forEach((option) => {
      option.selected = chosen.has(trimText(option.value, 120));
    });
  }

  function selectedValues(select) {
    return Array.from(select?.selectedOptions || [])
      .map((option) => trimText(option.value, 120))
      .filter(Boolean);
  }

  function reminderIndicator(task) {
    const pending = taskReminders(task.id).filter((item) => item.status !== 'sent' && item.status !== 'cancelled');
    if (!pending.length && !task.reminder_enabled) {
      return '<span class="badge">No reminder</span>';
    }
    return `<span class="badge">${pluralize(pending.length || 1, 'reminder')}</span>`;
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
    const creatorName = memberDisplayName(task.created_by, task.created_by_email);
    const assigneeName = trimText(task.assigned_to, 120) || lowerEmail(task.assigned_to_email)
      ? memberDisplayName(task.assigned_to, task.assigned_to_email)
      : 'Unassigned';
    const dueText = task.due_at ? formatDateTime(task.due_at) : 'No due date';
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
            <span>Due: <strong>${escapeHtml(dueText)}</strong></span>
            <span>${pluralize(commentsCount, 'comment')}</span>
            <span>${pluralize(watchersCount, 'watcher')}</span>
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
              </div>
              <p>Assigned: ${escapeHtml(
                trimText(task.assigned_to, 120) || lowerEmail(task.assigned_to_email)
                  ? memberDisplayName(task.assigned_to, task.assigned_to_email)
                  : 'Unassigned'
              )}</p>
              <p>Due: ${escapeHtml(task.due_at ? formatDateTime(task.due_at) : 'No due date')}</p>
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
    els.settingCollapseDone.checked = state.settings.collapseDoneByDefault;
    els.emailStatusNote.textContent = state.emailConfigured
      ? 'Reminder email environment variables are present.'
      : 'Reminder email delivery is not fully configured yet.';
    els.emailStatusNote.style.color = state.emailConfigured ? 'var(--ok)' : 'var(--warn)';
    els.schemaStatusNote.textContent = state.schemaReady
      ? 'Supabase schema checks passed for Team Tasks.'
      : (state.schemaMessage || 'Team Tasks schema is still missing required tables or columns.');
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
        </article>
      `;
    }).join('');
    els.commentsEmpty.hidden = comments.length > 0;

    if (state.commentEditId) {
      const comment = state.comments.find((item) => item.id === state.commentEditId);
      els.commentEditMeta.textContent = comment ? `Editing your comment from ${formatDateTime(comment.updated_at || comment.created_at)}` : '';
      els.cancelCommentEditBtn.hidden = !comment;
      els.commentSubmitBtn.textContent = comment ? 'Save comment' : 'Post comment';
      if (comment && els.commentBody.value !== comment.comment_body) {
        els.commentBody.value = comment.comment_body || '';
      }
    } else {
      els.commentEditMeta.textContent = '';
      els.cancelCommentEditBtn.hidden = true;
      els.commentSubmitBtn.textContent = 'Post comment';
    }
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
    const watcherValues = taskWatchers(task.id)
      .map((watcher) => resolveMemberOptionValue(watcher.user_id, watcher.user_email))
      .filter(Boolean);
    const metaBits = [
      `<span class="badge">${escapeHtml(creatorName)}</span>`,
      `<span class="badge">Created ${escapeHtml(formatDateTime(task.created_at))}</span>`,
      `<span class="badge">Updated ${escapeHtml(formatDateTime(task.updated_at || task.created_at))}</span>`,
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
    renderDrawerAudit(task);

    els.detailDrawerShell.classList.add('is-open');
    els.detailDrawerShell.setAttribute('aria-hidden', 'false');
    updateQueryTaskParam(task.id);
  }

  function renderAll() {
    renderHeroSummary();
    renderBanner();
    renderMetrics();
    renderToolbar();
    renderTasksTab();
    renderBoardTab();
    renderAuditTab();
    renderMineTab();
    renderSettingsTab();
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
      const [tasksResult, commentsResult, watchersResult, remindersResult, auditResult] = await Promise.all([
        client.from('task_items').select('*').order('archived_at', { ascending: true, nullsFirst: true }).order('updated_at', { ascending: false }),
        client.from('task_comments').select('*').order('created_at', { ascending: true }),
        client.from('task_watchers').select('*').order('created_at', { ascending: true }),
        client.from('task_reminders').select('*').order('send_at', { ascending: true }),
        client.from('task_audit_log').select('*').order('created_at', { ascending: false }).limit(300),
      ]);

      const firstError = [tasksResult, commentsResult, watchersResult, remindersResult, auditResult]
        .map((result) => result.error)
        .find(Boolean);
      if (firstError) throw firstError;

      state.tasks = Array.isArray(tasksResult.data) ? tasksResult.data : [];
      state.comments = Array.isArray(commentsResult.data) ? commentsResult.data : [];
      state.watchers = Array.isArray(watchersResult.data) ? watchersResult.data : [];
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
    ['task_items', 'task_comments', 'task_watchers', 'task_reminders', 'task_audit_log'].forEach((table) => {
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

  function quickTaskPayload() {
    const dueAt = fromLocalInputValue(els.quickDueAt.value);
    const reminderMode = REMINDER_MODES.includes(els.quickReminderMode.value) ? els.quickReminderMode.value : 'none';
    const assignedKey = trimText(els.quickAssignedTo.value, 120);
    const assignedMember = findMemberByKey(assignedKey);
    return {
      title: trimText(els.quickTitle.value, 180),
      description: trimText(els.quickDescription.value, 5000),
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
      state.helpers.toast.err('Add a task title first.', 3400);
      els.quickTitle.focus();
      return;
    }
    if (payload.reminder_mode !== 'none' && payload.reminder_mode !== 'custom' && !payload.due_at) {
      state.helpers.toast.err('Due date is required for preset reminders.', 4200);
      return;
    }

    els.quickAddBtn.disabled = true;
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

      state.helpers.toast.ok('Task added.', 2800);
      els.quickAddForm.reset();
      setAdvancedVisibility(false);
      setQuickFormDefaults();
      await loadAllData({ silent: true });
      openDrawer(data.id);
    } catch (error) {
      state.helpers.toast.err(error?.message || 'Unable to add task.', 5400);
    } finally {
      els.quickAddBtn.disabled = false;
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
      payload.description = trimText(els.detailDescription.value, 5000);
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

      state.helpers.toast.ok('Task saved.', 2800);
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
    if (!body) {
      state.helpers.toast.err('Write a comment first.', 3200);
      return;
    }
    try {
      const client = await ensureClient();
      if (state.commentEditId) {
        const { error } = await client
          .from('task_comments')
          .update({ comment_body: body })
          .eq('id', state.commentEditId);
        if (error) throw error;
        state.helpers.toast.ok('Comment updated.', 2800);
      } else {
        const { error } = await client
          .from('task_comments')
          .insert({
            task_id: task.id,
            comment_body: body,
          });
        if (error) throw error;
        state.helpers.toast.ok('Comment added.', 2800);
      }
      state.commentEditId = '';
      els.commentBody.value = '';
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
      reminderRecipientMode: trimText(els.settingReminderRecipients.value, 64) || DEFAULT_SETTINGS.reminderRecipientMode,
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
    if (els.detailDrawerShell) {
      els.detailDrawerShell.classList.remove('is-open');
      els.detailDrawerShell.setAttribute('aria-hidden', 'true');
    }
    updateQueryTaskParam('');
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
    els.refreshBtn.addEventListener('click', () => loadAllData({ silent: false }));
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
        renderTabs();
      });
    });

    bindListOpeners(els.tasksList);
    bindListOpeners(els.boardColumns);
    bindListOpeners(els.auditList);
    bindListOpeners(els.mineAssignedList);
    bindListOpeners(els.mineCreatedList);
    bindListOpeners(els.mineWatchingList);
    bindListOpeners(els.drawerAuditList);

    els.closeDrawerBtn.addEventListener('click', closeDrawer);
    els.drawerBackdrop.addEventListener('click', closeDrawer);
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.selectedTaskId) {
        closeDrawer();
      }
    });

    els.saveTaskBtn.addEventListener('click', handleTaskSave);
    els.markDoneBtn.addEventListener('click', () => {
      const task = currentTask();
      if (task) quickUpdateTask(task.id, { status: 'done' });
    });
    els.archiveTaskBtn.addEventListener('click', handleArchiveToggle);
    els.deleteTaskBtn.addEventListener('click', handleDeleteTask);
    els.commentForm.addEventListener('submit', handleCommentSubmit);
    els.cancelCommentEditBtn.addEventListener('click', cancelCommentEdit);
    els.commentsList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="edit-comment"][data-id]');
      if (!button) return;
      beginCommentEdit(button.getAttribute('data-id'));
    });
    els.settingsForm.addEventListener('submit', handleSettingsSave);
  }

  async function initPage(helpers) {
    state.helpers = helpers;
    state.who = await helpers.identity('admin');
    els.welcomeMeta.textContent = `Signed in as ${state.who?.email || state.currentUser.email || 'admin user'}`;

    await fetchConfig(true);
    els.welcomeMeta.textContent = `Signed in as ${state.currentUser.email || state.who?.email || 'admin user'}`;
    renderAll();

    if (state.schemaReady) {
      await ensureClient();
      await setupRealtime();
      await loadAllData({ silent: false });
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
