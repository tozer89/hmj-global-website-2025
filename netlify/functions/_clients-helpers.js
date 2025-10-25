let staticClients = [];
try {
  const seed = require('../../data/clients.json');
  if (Array.isArray(seed?.clients)) staticClients = seed.clients;
  else if (Array.isArray(seed)) staticClients = seed;
} catch (err) {
  console.warn('[clients] unable to pre-load static dataset', err?.message || err);
}

function toClient(row = {}) {
  return {
    id: Number(row.id) || row.id || null,
    name: row.name || 'Unnamed client',
    billing_email: row.billing_email || null,
    phone: row.phone || null,
    contact_name: row.contact_name || null,
    contact_email: row.contact_email || null,
    contact_phone: row.contact_phone || null,
    terms_days: row.terms_days !== undefined ? Number(row.terms_days) : null,
    status: row.status || 'active',
    notes: row.notes || null,
  };
}

function loadStaticClients() {
  if (!staticClients.length) return [];
  return staticClients.map(toClient);
}

module.exports = {
  loadStaticClients,
  toClient,
};
