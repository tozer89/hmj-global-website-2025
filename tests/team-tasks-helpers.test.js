const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTaskSettings,
  computeReminderSendAt,
  dedupeReminderRecipients,
  dedupeMembers,
  buildReminderEmail,
} = require('../netlify/functions/_team-tasks-helpers.js');

test('normalizeTaskSettings falls back cleanly and preserves valid values', () => {
  assert.deepEqual(
    normalizeTaskSettings({
      dueSoonDays: '5',
      collapseDoneByDefault: false,
      reminderRecipientMode: 'assignee_only',
      defaultPriority: 'urgent',
    }),
    {
      dueSoonDays: 5,
      collapseDoneByDefault: false,
      reminderRecipientMode: 'assignee_only',
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
      reminderRecipientMode: 'assignee_creator_watchers',
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
  assert.match(message.html, /Open task in HMJ Admin/);
});
