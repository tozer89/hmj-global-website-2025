const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveTimesheetPortalClients,
  mergeTimesheetPortalClient,
} = require('../netlify/functions/_clients-sync.js');

test('deriveTimesheetPortalClients groups repeated client codes and counts assignments', () => {
  const rows = deriveTimesheetPortalClients([
    { clientCode: 'ACELEC', clientName: 'Ace Electrical', status: 'live' },
    { clientCode: 'ACELEC', clientName: 'Ace Electrical', status: 'complete' },
    { clientCode: 'NGRID', clientName: 'North Grid', status: 'pending' },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].client_code, 'ACELEC');
  assert.equal(rows[0].assignment_count, 2);
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[1].status, 'prospect');
});

test('mergeTimesheetPortalClient preserves manual contact details while applying synced identity', () => {
  const merged = mergeTimesheetPortalClient(
    {
      id: 12,
      name: 'Existing Client',
      billing_email: 'ap@example.com',
      phone: '+44 20 1234 5678',
      status: 'active',
      contact_name: 'Sam',
    },
    {
      name: 'Existing Client',
      status: 'inactive',
    },
  );

  assert.equal(merged.id, 12);
  assert.equal(merged.name, 'Existing Client');
  assert.equal(merged.billing_email, 'ap@example.com');
  assert.equal(merged.phone, '+44 20 1234 5678');
  assert.equal(merged.contact_name, 'Sam');
  assert.equal(merged.status, 'active');
});
