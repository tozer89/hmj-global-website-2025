const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTaskSettings,
  computeReminderSendAt,
  dedupeReminderRecipients,
  dedupeMembers,
  buildTaskRecipients,
  describeTaskDueCountdown,
  formatFileSize,
  buildAssignmentEmail,
  buildReminderEmail,
  buildTaskActivityEmail,
} = require('../netlify/functions/_team-tasks-helpers.js');

test('normalizeTaskSettings falls back cleanly and preserves valid values', () => {
  assert.deepEqual(
    normalizeTaskSettings({
      dueSoonDays: '5',
      collapseDoneByDefault: false,
      reminderRecipientMode: 'assignee_only',
      activityRecipientMode: 'watchers_only',
      activityEmailNotifications: false,
      mentionEmailNotifications: false,
      defaultPriority: 'urgent',
    }),
    {
      dueSoonDays: 5,
      collapseDoneByDefault: false,
      assignmentEmailNotifications: true,
      reminderRecipientMode: 'assignee_only',
      activityRecipientMode: 'watchers_only',
      activityEmailNotifications: false,
      mentionEmailNotifications: false,
      defaultPriority: 'urgent',
    }
  );

  assert.deepEqual(
    normalizeTaskSettings({
      dueSoonDays: '0',
      collapseDoneByDefault: 'maybe',
      reminderRecipientMode: '',
      defaultPriority: 'not-real',
    }),
    {
      dueSoonDays: 3,
      collapseDoneByDefault: true,
      assignmentEmailNotifications: true,
      reminderRecipientMode: 'assignee_creator_watchers',
      activityRecipientMode: 'assignee_creator_watchers',
      activityEmailNotifications: true,
      mentionEmailNotifications: true,
      defaultPriority: 'medium',
    }
  );
});

test('computeReminderSendAt derives preset and custom reminder times', () => {
  assert.equal(
    computeReminderSendAt({
      dueAt: '2026-03-20T15:30:00.000Z',
      reminderMode: 'due_date_9am',
    }),
    '2026-03-20T09:00:00.000Z'
  );

  assert.equal(
    computeReminderSendAt({
      dueAt: '2026-03-20T15:30:00.000Z',
      reminderMode: '1_day_before',
    }),
    '2026-03-19T09:00:00.000Z'
  );

  assert.equal(
    computeReminderSendAt({
      dueAt: '2026-03-20T15:30:00.000Z',
      reminderMode: 'custom',
      customAt: '2026-03-18T12:45:00.000Z',
    }),
    '2026-03-18T12:45:00.000Z'
  );
});

test('dedupeMembers and reminder recipients collapse repeated identities', () => {
  const members = dedupeMembers([
    { userId: 'abc', email: 'person@hmj-global.com', displayName: 'Person One' },
    { user_id: 'abc', email: 'PERSON@hmj-global.com', display_name: 'Duplicate Person' },
    { userId: 'xyz', email: 'other@hmj-global.com', displayName: 'Other Person' },
  ]);

  assert.equal(members.length, 2);
  assert.deepEqual(members.map((member) => member.userId), ['abc', 'xyz']);

  const recipients = dedupeReminderRecipients([
    { userId: 'abc', email: 'person@hmj-global.com', displayName: 'Person One' },
    { user_id: 'abc', recipient_email: 'PERSON@hmj-global.com', name: 'Person Again' },
    { userId: 'xyz', email: 'other@hmj-global.com', displayName: 'Other Person' },
  ]);

  assert.equal(recipients.length, 2);
  assert.equal(recipients[0].email, 'person@hmj-global.com');
  assert.equal(recipients[1].email, 'other@hmj-global.com');
});

test('buildReminderEmail includes admin deep link and task context', () => {
  const message = buildReminderEmail({
    task: {
      id: 'task-1',
      title: 'Chase updated payroll sign-off',
      description: 'Confirm the final payroll approval before Thursday noon.',
      status: 'waiting',
      priority: 'high',
      due_at: '2026-03-20T15:30:00.000Z',
      assigned_to_email: 'ops@hmj-global.com',
      taskPath: '/admin/team-tasks.html?task=task-1',
    },
    recipient: {
      email: 'ops@hmj-global.com',
      displayName: 'Ops Team',
    },
    siteUrl: 'https://hmj-global.com',
  });

  assert.match(message.subject, /\[HMJ Team Tasks\]/);
  assert.match(message.text, /Chase updated payroll sign-off/);
  assert.match(message.text, /https:\/\/hmj-global\.com\/admin\/team-tasks\.html\?task=task-1/);
  assert.match(message.html, /Open task/);
  assert.match(message.html, /Open board/);
  assert.match(message.html, /Weekly planner/);
});

test('buildAssignmentEmail includes branded CTA buttons and assignment context', () => {
  const message = buildAssignmentEmail({
    task: {
      id: 'task-2',
      title: 'Review payroll exceptions',
      description: 'Check the remaining payroll exceptions before payroll close.',
      status: 'open',
      priority: 'urgent',
      due_at: '2026-03-22T15:30:00.000Z',
      assigned_to_email: 'nick@hmj-global.com',
      linked_module: 'Payroll',
    },
    recipient: {
      email: 'nick@hmj-global.com',
      displayName: 'Nick Chamberlain',
    },
    actor: {
      email: 'joe@hmj-global.com',
      displayName: "Joe Tozer-O'Sullivan",
    },
    siteUrl: 'https://hmj-global.com',
  });

  assert.match(message.subject, /New task assigned/);
  assert.match(message.html, /Open task/);
  assert.match(message.html, /Open board/);
  assert.match(message.html, /Open workspace/);
  assert.match(message.html, /background:#0f1b3f/);
  assert.match(message.html, /bgcolor="#0f1b3f"/);
  assert.match(message.text, /Joe Tozer-O'Sullivan assigned you a task/);
});

test('buildTaskRecipients respects mode and dedupes watchers', () => {
  const recipients = buildTaskRecipients({
    task: {
      created_by: 'creator-1',
      created_by_email: 'creator@hmj-global.com',
      assigned_to: 'assignee-1',
      assigned_to_email: 'assignee@hmj-global.com',
    },
    watchers: [
      { user_id: 'watcher-1', user_email: 'watcher@hmj-global.com' },
      { user_id: 'watcher-1', user_email: 'WATCHER@hmj-global.com' },
    ],
    mode: 'assignee_creator_watchers',
  });

  assert.deepEqual(
    recipients.map((recipient) => recipient.email),
    ['assignee@hmj-global.com', 'creator@hmj-global.com', 'watcher@hmj-global.com']
  );
});

test('describeTaskDueCountdown and formatFileSize return human-readable values', () => {
  const countdown = describeTaskDueCountdown('2026-03-20T15:30:00.000Z', {
    now: new Date('2026-03-19T10:15:00.000Z'),
  });

  assert.equal(countdown.overdue, false);
  assert.match(countdown.label, /Due in/);
  assert.equal(formatFileSize(1536), '1.5 KB');
});

test('buildTaskActivityEmail covers mentions and attachments with branded context', () => {
  const mentionMessage = buildTaskActivityEmail({
    eventType: 'mention',
    task: {
      id: 'task-1',
      title: 'Approve contractor docs',
      status: 'waiting',
      priority: 'high',
      due_at: '2026-03-20T15:30:00.000Z',
    },
    recipient: {
      email: 'nick@hmj-global.com',
      displayName: 'Nick Chamberlain',
    },
    actor: {
      email: 'joe@hmj-global.com',
      displayName: "Joe Tozer-O'Sullivan",
    },
    comment: {
      comment_body: 'Please review the uploaded contract wording before noon.',
    },
    siteUrl: 'https://hmj-global.com',
  });

  assert.match(mentionMessage.subject, /You were tagged/);
  assert.match(mentionMessage.text, /Please review the uploaded contract wording/);

  const attachmentMessage = buildTaskActivityEmail({
    eventType: 'attachment_added',
    task: {
      id: 'task-1',
      title: 'Approve contractor docs',
      status: 'waiting',
      priority: 'high',
      due_at: '2026-03-20T15:30:00.000Z',
    },
    recipient: {
      email: 'info@hmj-global.com',
      displayName: 'Info@HMJ',
    },
    actor: {
      email: 'joe@hmj-global.com',
      displayName: "Joe Tozer-O'Sullivan",
    },
    attachment: {
      file_name: 'contract-pack.docx',
      file_size_bytes: 204800,
    },
    siteUrl: 'https://hmj-global.com',
  });

  assert.match(attachmentMessage.subject, /New file/);
  assert.match(attachmentMessage.text, /contract-pack\.docx/);
});
