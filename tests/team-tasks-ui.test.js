const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('team tasks admin page exposes assignment email controls, planner upgrades, and quick-add aids', () => {
  const html = read('admin/team-tasks.html');
  assert.match(html, /team-tasks\.js\?v=5/);
  assert.match(html, /settingAssignmentEmails/);
  assert.match(html, /emailStatusDetail/);
  assert.match(html, /sendAssignmentEmailBtn/);
  assert.match(html, /sendReminderNowBtn/);
  assert.match(html, /detailReminderSummary/);
  assert.match(html, /detailEmailRecipients/);
  assert.match(html, /detailEmailHistory/);
  assert.match(html, /quickTemplateButtons/);
  assert.match(html, /quickDueShortcutButtons/);
  assert.match(html, /quickFeedback/);
  assert.match(html, /plannerComfortableBtn/);
  assert.match(html, /plannerCompactBtn/);
  assert.match(html, /plannerExpandAllBtn/);
  assert.match(html, /plannerCollapseAllBtn/);
  assert.match(html, /opsFocusList/);
  assert.match(html, /opsReminderList/);
  assert.match(html, /opsWaitingList/);
});

test('team tasks client wires assignment emails, planner interactions, and guided quick add', () => {
  const source = read('admin/team-tasks.js');
  assert.match(source, /const SEND_EMAIL_ENDPOINT = '\/admin-team-tasks-send-email';/);
  assert.match(source, /assignmentEmailNotifications/);
  assert.match(source, /maybeSendAssignmentEmail/);
  assert.match(source, /sendDrawerEmail\('assignment'\)/);
  assert.match(source, /sendDrawerEmail\('reminder'\)/);
  assert.match(source, /readQueryTab/);
  assert.match(source, /updateQueryState/);
  assert.match(source, /QUICK_TASK_TEMPLATES/);
  assert.match(source, /applyQuickTemplate/);
  assert.match(source, /applyDueShortcut/);
  assert.match(source, /setQuickFeedback/);
  assert.match(source, /setPlannerDensity/);
  assert.match(source, /setPlannerExpansionForVisibleDays/);
  assert.match(source, /renderOperationsPanels/);
  assert.doesNotMatch(source, /description:\s*trimText\(els\.quickDescription\.value,\s*5000\)/);
  assert.doesNotMatch(source, /payload\.description\s*=\s*trimText\(els\.detailDescription\.value,\s*5000\)/);
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
