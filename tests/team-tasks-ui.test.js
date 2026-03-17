const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('team tasks admin page exposes assignment email controls and delivery notes', () => {
  const html = read('admin/team-tasks.html');
  assert.match(html, /team-tasks\.js\?v=3/);
  assert.match(html, /settingAssignmentEmails/);
  assert.match(html, /emailStatusDetail/);
  assert.match(html, /sendAssignmentEmailBtn/);
  assert.match(html, /sendReminderNowBtn/);
  assert.match(html, /detailReminderSummary/);
  assert.match(html, /detailEmailRecipients/);
  assert.match(html, /detailEmailHistory/);
});

test('team tasks client wires assignment emails, manual sends, and query-aware tabs', () => {
  const source = read('admin/team-tasks.js');
  assert.match(source, /const SEND_EMAIL_ENDPOINT = '\/admin-team-tasks-send-email';/);
  assert.match(source, /assignmentEmailNotifications/);
  assert.match(source, /maybeSendAssignmentEmail/);
  assert.match(source, /sendDrawerEmail\('assignment'\)/);
  assert.match(source, /sendDrawerEmail\('reminder'\)/);
  assert.match(source, /readQueryTab/);
  assert.match(source, /updateQueryState/);
});

test('team tasks backend uses shared email config and new send endpoint', () => {
  const configSource = read('netlify/functions/admin-team-tasks-config.js');
  const notifySource = read('netlify/functions/admin-team-tasks-notify-activity.js');
  const reminderSource = read('netlify/functions/admin-team-tasks-reminders-run.js');
  const sendSource = read('netlify/functions/admin-team-tasks-send-email.js');

  assert.match(configSource, /resolveTeamTaskEmailConfig/);
  assert.match(configSource, /emailDelivery:/);
  assert.match(notifySource, /sendTeamTaskEmail/);
  assert.match(reminderSource, /sendTeamTaskEmail/);
  assert.match(sendSource, /buildAssignmentEmail/);
  assert.match(sendSource, /buildReminderEmail/);
  assert.match(sendSource, /assignment_email_sent/);
  assert.match(sendSource, /reminder_email_sent/);
});
