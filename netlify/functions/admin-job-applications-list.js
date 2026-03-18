'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  filterJobApplications,
  normaliseApplicationRow,
  sortJobApplications,
  summariseJobApplications,
} = require('./_job-applications.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const APPLICATION_SELECT = [
  'id',
  'candidate_id',
  'job_id',
  'status',
  'applied_at',
  'created_at',
  'updated_at',
  'notes',
  'job_title',
  'job_location',
  'job_type',
  'job_pay',
  'source',
  'source_submission_id',
  'share_code',
].join(',');

function chunk(values = [], size = 500) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return null;
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function parseBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

async function fetchAllApplications(supabase) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabase
      .from('job_applications')
      .select(APPLICATION_SELECT)
      .order('applied_at', { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!Array.isArray(data) || !data.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (rows.length >= 5000) break;
  }

  return rows;
}

async function fetchCandidateMap(supabase, candidateIds = []) {
  const map = new Map();
  for (const ids of chunk(candidateIds, 400)) {
    const { data, error } = await supabase
      .from('candidates')
      .select('id,full_name,first_name,last_name,email,location')
      .in('id', ids);
    if (error) throw error;
    (data || []).forEach((row) => {
      map.set(String(row.id), row);
    });
  }
  return map;
}

async function fetchJobMap(supabase, jobIds = []) {
  const map = new Map();
  for (const ids of chunk(jobIds, 400)) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .in('id', ids);
    if (error) throw error;
    (data || []).forEach((row) => {
      map.set(String(row.id), row);
    });
  }
  return map;
}

function paginate(rows = [], page = 1, pageSize = 50) {
  const safePageSize = Math.min(250, Math.max(1, Number(pageSize) || 50));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (safePage - 1) * safePageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    pages,
    total,
    rows: rows.slice(start, start + safePageSize),
  };
}

module.exports.handler = withAdminCors(async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  if (!hasSupabase()) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: 'Live applications system unavailable.',
        supabase: supabaseStatus(),
      }),
    };
  }

  const supabase = getSupabase(event);
  const body = parseBody(event);
  const filters = {
    q: trimString(body.q, 240) || '',
    status: trimString(body.status, 40) || 'all',
    source: trimString(body.source, 120) || 'all',
  };
  const sort = {
    key: trimString(body.sort?.key || body.sortKey, 40) || 'applied_at',
    dir: trimString(body.sort?.dir || body.sortDir, 10) || 'desc',
  };

  const applications = await fetchAllApplications(supabase);
  const candidateIds = Array.from(new Set(applications.map((row) => trimString(row.candidate_id, 120)).filter(Boolean)));
  const jobIds = Array.from(new Set(applications.map((row) => trimString(row.job_id, 120)).filter(Boolean)));

  const [candidateMap, jobMap] = await Promise.all([
    fetchCandidateMap(supabase, candidateIds),
    fetchJobMap(supabase, jobIds),
  ]);

  const decorated = applications.map((row) => normaliseApplicationRow(row, candidateMap, jobMap));
  const filtered = sortJobApplications(filterJobApplications(decorated, filters), sort);
  const paged = paginate(filtered, body.page, body.pageSize);
  const sources = Array.from(new Set(decorated.map((row) => row.source).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      rows: paged.rows,
      page: paged.page,
      pageSize: paged.pageSize,
      pages: paged.pages,
      total: paged.total,
      overallTotal: decorated.length,
      summary: summariseJobApplications(filtered),
      overallSummary: summariseJobApplications(decorated),
      sources,
      filters,
      sort,
      supabase: supabaseStatus(),
    }),
  };
});
