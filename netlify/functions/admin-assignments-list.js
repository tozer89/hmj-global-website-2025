// netlify/functions/admin-assignments-list.js
const { supabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { loadStaticAssignments } = require('./_assignments-helpers.js');

function normaliseLike(value = '') {
  return String(value)
    .replace(/[\%_]/g, (m) => `\\${m}`)
    .trim();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toCsv(rows = []) {
  if (!rows.length) return 'id,reference,status,client,candidate,start_date,end_date,pay_rate,currency\n';
  const header = ['ID', 'Reference', 'Status', 'Client', 'Candidate', 'Job title', 'Start date', 'End date', 'Pay rate', 'Charge rate', 'Currency'];
  const lines = rows.map((row) => {
    const cells = [
      row.id,
      row.as_ref || row.po_number || '',
      row.status || '',
      row.client_name || '',
      row.candidate_name || '',
      row.job_title || '',
      row.start_date || '',
      row.end_date || '',
      row.rate_pay || row.rate_std || '',
      row.charge_std || '',
      row.currency || 'GBP',
    ];
    return cells.map((val) => {
      const text = val === null || val === undefined ? '' : String(val);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',');
  });
  return [header.join(','), ...lines].join('\n');
}

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });

    const body = JSON.parse(event.body || '{}');
    const search = normaliseLike(body.q || '');
    const status = String(body.status || '').trim();
    const ids = Array.isArray(body.ids) ? body.ids.filter((v) => v !== null && v !== undefined && v !== '') : [];
    const wantsCsv = String(body.format || '').toLowerCase() === 'csv';
    const page = Math.max(toNumber(body.page, 1), 1);
    const pageSize = Math.min(Math.max(toNumber(body.pageSize, 20), 10), 200);
    const offset = (page - 1) * pageSize;

    const baseFilters = (query) => {
      let q = query;
      if (ids.length) {
        q = q.in('id', ids.map((id) => Number.isFinite(Number(id)) ? Number(id) : id));
      }
      if (status) {
        q = q.ilike('status', status);
      }
      if (search) {
        const like = `%${search}%`;
        q = q.or(
          [
            `job_title.ilike.${like}`,
            `client_name.ilike.${like}`,
            `candidate_name.ilike.${like}`,
            `as_ref.ilike.${like}`,
            `po_number.ilike.${like}`,
          ].join(',')
        );
      }
      return q;
    };

    const respondWithStatic = () => {
      const fallback = loadStaticAssignments();
      const idSet = new Set(ids.map((value) => String(value)));
      const searchLower = search.toLowerCase();
      const filtered = fallback.filter((row) => {
        if (ids.length && !idSet.has(String(row.id))) return false;
        if (status && String(row.status || '').toLowerCase() !== status.toLowerCase()) return false;
        if (searchLower) {
          const haystack = [
            row.job_title,
            row.client_name,
            row.candidate_name,
            row.as_ref,
            row.po_number,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(searchLower)) return false;
        }
        return true;
      });

      const rows = wantsCsv
        ? filtered
          : filtered.slice(offset, offset + pageSize).map((row) => ({
              ...row,
              client_site: row.client_site || null,
            }));

      console.warn('[assignments] using static fallback dataset (%d rows)', filtered.length);

      if (wantsCsv) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="assignments.csv"',
          },
          body: toCsv(filtered),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          rows,
          total: filtered.length,
          readOnly: true,
          source: 'static',
          supabase: supabaseStatus(),
        }),
      };
    };

    const shouldFallback = (err) => {
      if (!err) return false;
      const msg = String(err.message || err);
      return /column .+ does not exist/i.test(msg) || /relation .+ does not exist/i.test(msg);
    };

    if (!hasSupabase()) {
      return respondWithStatic();
    }

    const countQuery = baseFilters(
      supabase
        .from('assignments')
        .select('id', { count: 'exact', head: true })
    );

    const { count, error: countError } = await countQuery;
    if (countError) {
      if (shouldFallback(countError)) {
        console.warn('[assignments] count failed (%s) — falling back to static dataset', countError.message);
        return respondWithStatic();
      }
      throw countError;
    }

    let dataQuery = baseFilters(
      supabase
        .from('assignments')
        .select(
          [
            'id',
            'contractor_id',
            'project_id',
            'site_id',
            'job_title',
            'status',
            'candidate_name',
            'client_name',
            'client_site',
            'as_ref',
            'po_number',
            'po_ref',
            'rate_std',
            'rate_pay',
            'charge_std',
            'charge_ot',
            'rate_charge',
            'start_date',
            'end_date',
            'currency',
            'consultant_name',
            'active',
          ].join(',')
        )
        .order('start_date', { ascending: false })
    );

    if (!wantsCsv) {
      dataQuery = dataQuery.range(offset, offset + pageSize - 1);
    }

    const { data, error } = await dataQuery;
    if (error) {
      if (shouldFallback(error)) {
        console.warn('[assignments] data fetch failed (%s) — falling back to static dataset', error.message);
        return respondWithStatic();
      }
      throw error;
    }

    if (wantsCsv) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="assignments.csv"',
        },
        body: toCsv(data || []),
      };
    }

    const rows = (data || []).map((row) => ({
      ...row,
      client_site: row.client_site || null,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ rows, total: count ?? rows.length }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Failed to load assignments' }) };
  }
};
