'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  listTimesheetPortalAssignments,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');
const {
  deriveTimesheetPortalClients,
  mergeTimesheetPortalClient,
  normalizeClientKey,
} = require('./_clients-sync.js');

function isMissingClientsSchemaError(error) {
  const message = String(error?.message || '');
  return /Could not find the table 'public\.clients' in the schema cache/i.test(message)
    || /relation "?clients"? does not exist/i.test(message);
}

async function loadExistingClients(supabase) {
  const { data, error } = await supabase
    .from('clients')
    .select('id,name,billing_email,phone,contact_name,contact_email,contact_phone,terms_days,status,address,billing')
    .order('name', { ascending: true })
    .limit(5000);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

const baseHandler = async (event, context) => {
  const { supabase } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');
  if (!supabase || typeof supabase.from !== 'function') throw coded(503, 'Supabase unavailable.');

  const config = readTimesheetPortalConfig();
  if (!config.enabled || !config.configured) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: false,
        rows: [],
        tableAvailable: false,
        message: 'Timesheet Portal is not configured for this environment.',
      }),
    };
  }

  try {
    const tspData = await listTimesheetPortalAssignments(config, { take: 500, pageLimit: 20 });
    const remoteRows = deriveTimesheetPortalClients(tspData.assignments || []);

    let tableAvailable = true;
    let syncedRows = remoteRows;
    let upserted = 0;

    try {
      const existingRows = await loadExistingClients(supabase);
      const existingByName = new Map();
      existingRows.forEach((row) => {
        const key = normalizeClientKey(row.name);
        if (key && !existingByName.has(key)) existingByName.set(key, row);
      });

      const payloads = remoteRows.map((row) => {
        const existing = existingByName.get(normalizeClientKey(row.name)) || null;
        return mergeTimesheetPortalClient(existing || {}, row);
      });

      if (payloads.length) {
        const { data, error } = await supabase
          .from('clients')
          .upsert(payloads)
          .select('id,name,billing_email,phone,contact_name,contact_email,contact_phone,terms_days,status,address,billing');
        if (error) throw error;
        const persisted = Array.isArray(data) ? data : [];
        upserted = persisted.length;
        const persistedByName = new Map();
        persisted.forEach((row) => {
          const key = normalizeClientKey(row.name);
          if (key && !persistedByName.has(key)) persistedByName.set(key, row);
        });
        syncedRows = remoteRows.map((row) => {
          const persistedRow = persistedByName.get(normalizeClientKey(row.name));
          return {
            ...(persistedRow || row),
            terms_text: persistedRow?.billing?.notes || row.notes || null,
            client_code: row.client_code,
            assignment_count: row.assignment_count,
            source: persistedRow ? 'supabase' : 'timesheet_portal',
            readOnly: !persistedRow,
          };
        });
      }
    } catch (error) {
      if (!isMissingClientsSchemaError(error)) throw error;
      tableAvailable = false;
      syncedRows = remoteRows.map((row) => ({ ...row, terms_text: row.notes || null, readOnly: true }));
    }

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: true,
        tableAvailable,
        source: 'timesheet_portal_jobs',
        syncedAt: new Date().toISOString(),
        assignmentPath: tspData.discovery.assignmentPath,
        attempts: tspData.discovery.attempts,
        fetched: Array.isArray(tspData.assignments) ? tspData.assignments.length : 0,
        upserted,
        rows: syncedRows,
        message: tableAvailable
          ? 'Clients refreshed from Timesheet Portal.'
          : 'Clients table is not available. Showing Timesheet Portal-derived clients in read-only mode.',
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: false,
        configured: true,
        rows: [],
        message: error?.message || 'Timesheet Portal client sync failed.',
        code: error?.code || 'timesheet_portal_clients_sync_failed',
        attempts: Array.isArray(error?.attempts) ? error.attempts : [],
      }),
    };
  }
};

module.exports.handler = withAdminCors(baseHandler, { requireToken: false });
