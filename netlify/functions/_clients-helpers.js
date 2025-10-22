const fs = require('fs');
const path = require('path');

function findClientsFile() {
  const candidates = [
    path.resolve(__dirname, '..', 'data', 'clients.json'),
    path.resolve(__dirname, '..', '..', 'data', 'clients.json'),
    path.resolve(process.cwd(), 'data', 'clients.json'),
  ];
  return candidates.find((filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }) || null;
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
  try {
    const filePath = findClientsFile();
    if (!filePath) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const rows = Array.isArray(parsed?.clients) ? parsed.clients : [];
    return rows.map(toClient);
  } catch (err) {
    console.error('[clients] failed to load static dataset', err?.message || err);
    return [];
  }
}

module.exports = {
  loadStaticClients,
  toClient,
};
