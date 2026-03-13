const { withAdminCors } = require('./_http.js');
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, toDbPayload, isSchemaError } = require('./_jobs-helpers.js');
const {
  sanitiseBulkEdits,
  applyBulkEditsToJob,
  createDuplicateJob,
} = require('./_jobs-bulk-helpers.js');

function uniqueIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function stripUnsupportedColumns(records, err) {
  const message = String(err?.message || '').toLowerCase();
  if (!/public_page_config/.test(message)) {
    return null;
  }
  return records.map((record) => {
    const next = { ...record };
    delete next.public_page_config;
    return next;
  });
}

async function fetchJobsByIds(supabase, ids) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .in('id', ids);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return {
    rows: ids.map((id) => byId.get(id)).filter(Boolean),
    missingIds: ids.filter((id) => !byId.has(id)),
  };
}

async function upsertRecords(supabase, records) {
  const payloads = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!payloads.length) {
    return { rows: [], schemaAdjusted: false, failures: [] };
  }
  if (payloads.length === 1) {
    const result = await upsertSingleRecord(supabase, payloads[0]);
    return {
      rows: result.row ? [result.row] : [],
      schemaAdjusted: result.schemaAdjusted,
      failures: [],
    };
  }

  try {
    const result = await upsertBatchRecords(supabase, payloads);
    return {
      rows: result.rows,
      schemaAdjusted: result.schemaAdjusted,
      failures: [],
    };
  } catch (err) {
    const rows = [];
    const failures = [];
    let schemaAdjusted = false;

    for (const record of payloads) {
      try {
        const result = await upsertSingleRecord(supabase, record);
        if (result.row) rows.push(result.row);
        schemaAdjusted = schemaAdjusted || result.schemaAdjusted;
      } catch (error) {
        failures.push({
          id: String(record?.id || ''),
          error: error?.message || 'Failed to save job',
        });
      }
    }

    if (!rows.length && failures.length) {
      const aggregate = new Error('Bulk action failed for all selected jobs');
      aggregate.failures = failures;
      throw aggregate;
    }

    return {
      rows,
      schemaAdjusted,
      failures,
    };
  }
}

async function upsertBatchRecords(supabase, records) {
  let payloads = Array.isArray(records) ? records : [];
  let schemaAdjusted = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await supabase
      .from('jobs')
      .upsert(payloads, { onConflict: 'id', ignoreDuplicates: false })
      .select('*');

    if (!result.error) {
      return {
        rows: Array.isArray(result.data) ? result.data : [],
        schemaAdjusted,
      };
    }

    if (!isSchemaError(result.error)) {
      throw result.error;
    }

    const adjusted = stripUnsupportedColumns(payloads, result.error);
    if (!adjusted) {
      throw result.error;
    }

    payloads = adjusted;
    schemaAdjusted = true;
  }

  return {
    rows: [],
    schemaAdjusted,
  };
}

async function upsertSingleRecord(supabase, record) {
  let payload = { ...record };
  let schemaAdjusted = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await supabase
      .from('jobs')
      .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })
      .select('*')
      .single();

    if (!result.error) {
      return {
        row: result.data || null,
        schemaAdjusted,
      };
    }

    if (!isSchemaError(result.error)) {
      throw result.error;
    }

    const adjusted = stripUnsupportedColumns([payload], result.error);
    if (!adjusted?.[0]) {
      throw result.error;
    }

    payload = adjusted[0];
    schemaAdjusted = true;
  }

  return {
    row: null,
    schemaAdjusted,
  };
}

async function loadCatalog(supabase) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,title');

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return {
    ids: new Set(rows.map((row) => String(row.id || '').trim().toLowerCase()).filter(Boolean)),
    titles: new Set(rows.map((row) => String(row.title || '').trim().toLowerCase()).filter(Boolean)),
  };
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    let supabase;
    try {
      supabase = getSupabase(event);
    } catch (err) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Supabase not configured', code: err.code || 'supabase_unavailable' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const action = String(body.action || '').trim().toLowerCase();
    const ids = uniqueIds(body.ids);

    if (!action) {
      return { statusCode: 400, body: JSON.stringify({ error: 'action required' }) };
    }
    if (!ids.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'at least one job id is required' }) };
    }

    if (action === 'publish' || action === 'unpublish') {
      const published = action === 'publish';
      const { data, error } = await supabase
        .from('jobs')
        .update({ published })
        .in('id', ids)
        .select('*');

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const updatedIds = new Set(rows.map((row) => String(row.id)));
      return {
        statusCode: 200,
        body: JSON.stringify({
          action,
          jobs: rows.map(toJob),
          updatedCount: rows.length,
          missingIds: ids.filter((id) => !updatedIds.has(id)),
        }),
      };
    }

    if (action === 'delete') {
      const { data, error } = await supabase
        .from('jobs')
        .delete()
        .in('id', ids)
        .select('id');

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const deletedIds = rows.map((row) => String(row.id));
      const deletedSet = new Set(deletedIds);
      return {
        statusCode: 200,
        body: JSON.stringify({
          action,
          deletedIds,
          deletedCount: deletedIds.length,
          missingIds: ids.filter((id) => !deletedSet.has(id)),
        }),
      };
    }

    if (action === 'duplicate') {
      const { rows, missingIds } = await fetchJobsByIds(supabase, ids);
      const registries = await loadCatalog(supabase);
      const duplicates = rows.map((row) => createDuplicateJob(row, registries));
      const payloads = duplicates.map((job) => toDbPayload(job));
      const result = await upsertRecords(supabase, payloads);

      return {
        statusCode: 200,
        body: JSON.stringify({
          action,
          jobs: result.rows.map(toJob),
          duplicatedCount: result.rows.length,
          missingIds,
          failures: result.failures.length ? result.failures : undefined,
          schema: result.schemaAdjusted || undefined,
        }),
      };
    }

    if (action === 'edit') {
      const edits = sanitiseBulkEdits(body.edits || body.changes || {});
      if (!Object.keys(edits).length) {
        return { statusCode: 400, body: JSON.stringify({ error: 'at least one bulk edit field is required' }) };
      }

      const { rows, missingIds } = await fetchJobsByIds(supabase, ids);
      const payloads = rows
        .map((row) => applyBulkEditsToJob(row, edits))
        .map((job) => toDbPayload(job));
      const result = await upsertRecords(supabase, payloads);

      return {
        statusCode: 200,
        body: JSON.stringify({
          action,
          jobs: result.rows.map(toJob),
          updatedCount: result.rows.length,
          missingIds,
          failures: result.failures.length ? result.failures : undefined,
          schema: result.schemaAdjusted || undefined,
        }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'unsupported bulk action' }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : (isSchemaError(e) ? 409 : 500);
    return {
      statusCode: status,
      body: JSON.stringify({
        error: e.message || 'Unexpected error',
        code: isSchemaError(e) ? 'schema_mismatch' : undefined,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
