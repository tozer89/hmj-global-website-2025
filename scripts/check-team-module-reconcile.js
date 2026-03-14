#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const TEAM_BUCKET = 'team-images';
const TEAM_TABLE = 'team_members';
const REQUIRED_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'created_by_email',
  'updated_by_email',
  'full_name',
  'slug',
  'role_title',
  'short_caption',
  'full_bio',
  'image_url',
  'image_storage_key',
  'image_alt_text',
  'linkedin_url',
  'email',
  'display_order',
  'is_published',
  'published_at',
  'archived_at',
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function resolveEnv() {
  [
    path.join(ROOT, '.env'),
    path.join(ROOT, '.env.local'),
    path.join(ROOT, 'hmj.env'),
  ].forEach(loadEnvFile);

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE
    || process.env.SUPABASE_SERVICE_KEY
    || ''
  ).trim();

  return { url, serviceKey };
}

function isPlaceholderEnvValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  return /^(your_|replace_|example|changeme|setme)/i.test(raw);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function check(condition, label, detail, { warn = false } = {}) {
  return {
    ok: !!condition,
    warn,
    label,
    detail,
  };
}

function printResults(results) {
  results.forEach((result) => {
    const prefix = result.ok ? (result.warn ? 'WARN' : 'PASS') : 'FAIL';
    process.stdout.write(`${prefix} ${result.label}\n`);
    if (result.detail) {
      process.stdout.write(`     ${result.detail}\n`);
    }
  });
}

function normalisePublicMembers(items = []) {
  return items.map((member) => ({
    id: String(member.id || ''),
    slug: String(member.slug || ''),
    fullName: String(member.fullName || ''),
    roleTitle: String(member.roleTitle || ''),
    shortCaption: String(member.shortCaption || ''),
    displayOrder: Number(member.displayOrder || 0),
    publishedAt: member.publishedAt || null,
  }));
}

function comparePublicCollections(left, right) {
  if (left.length !== right.length) {
    return {
      ok: false,
      detail: `Expected ${left.length} public members from direct Supabase filtering but team-list returned ${right.length}.`,
    };
  }

  for (let index = 0; index < left.length; index += 1) {
    const expected = left[index];
    const actual = right[index];
    const mismatch = ['id', 'slug', 'fullName', 'roleTitle', 'shortCaption', 'displayOrder']
      .find((field) => String(expected[field]) !== String(actual[field]));

    if (mismatch) {
      return {
        ok: false,
        detail: `Mismatch at position ${index + 1} for "${mismatch}": expected "${expected[mismatch]}", got "${actual[mismatch]}".`,
      };
    }
  }

  return {
    ok: true,
    detail: `team-list matches direct Supabase filtering for ${left.length} published member${left.length === 1 ? '' : 's'}.`,
  };
}

async function storageObjectExists(storage, storageKey) {
  const safeKey = String(storageKey || '').trim();
  if (!safeKey) return true;
  const parts = safeKey.split('/').filter(Boolean);
  const fileName = parts.pop();
  const folder = parts.join('/');
  const { data, error } = await storage.list(folder, {
    limit: 100,
    search: fileName,
  });
  if (error) {
    throw error;
  }
  return Array.isArray(data) && data.some((item) => item?.name === fileName);
}

async function main() {
  const env = resolveEnv();
  const results = [];

  if (!env.url || !env.serviceKey || isPlaceholderEnvValue(env.url) || isPlaceholderEnvValue(env.serviceKey) || !isValidHttpUrl(env.url)) {
    results.push(check(
      false,
      'Supabase environment',
      'Missing real SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. This repo\'s hmj.env currently contains placeholder values, so run the script with the real project env loaded or export the variables in your shell first.'
    ));
    printResults(results);
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
  const teamHelpers = require(path.join(ROOT, 'netlify/functions/_team-helpers.js'));
  const teamListHandler = require(path.join(ROOT, 'netlify/functions/team-list.js')).handler;

  const { data: rawRows, error: teamError } = await supabase
    .from(TEAM_TABLE)
    .select('*')
    .order('archived_at', { ascending: true, nullsFirst: true })
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true });

  if (teamError) {
    results.push(check(false, 'Team table query', teamError.message || 'Unable to query public.team_members.'));
    printResults(results);
    process.exitCode = 1;
    return;
  }

  const rows = Array.isArray(rawRows) ? rawRows : [];
  results.push(check(true, 'Team table query', `Loaded ${rows.length} row${rows.length === 1 ? '' : 's'} from public.team_members.`));

  const rowColumns = rows[0] ? Object.keys(rows[0]) : REQUIRED_COLUMNS;
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !rowColumns.includes(column));
  results.push(check(
    missingColumns.length === 0,
    'Required Team columns',
    missingColumns.length
      ? `Missing column(s): ${missingColumns.join(', ')}`
      : `All expected Team columns are present (${REQUIRED_COLUMNS.length} checked).`
  ));

  const bucketResponse = await supabase.storage.listBuckets();
  const bucketError = bucketResponse.error;
  const buckets = Array.isArray(bucketResponse.data) ? bucketResponse.data : [];
  const teamBucket = buckets.find((bucket) => bucket?.id === TEAM_BUCKET) || null;
  results.push(check(
    !!teamBucket && !bucketError,
    'Team image bucket',
    bucketError
      ? (bucketError.message || 'Unable to inspect storage buckets.')
      : teamBucket
        ? `Bucket "${TEAM_BUCKET}" exists and is ${teamBucket.public ? 'public' : 'not public'}.`
        : `Bucket "${TEAM_BUCKET}" was not found.`
  ));

  const duplicateSlugs = [];
  const seenSlugs = new Set();
  rows.forEach((row) => {
    const slug = String(row.slug || '');
    if (!slug) return;
    if (seenSlugs.has(slug)) duplicateSlugs.push(slug);
    seenSlugs.add(slug);
  });
  results.push(check(
    duplicateSlugs.length === 0,
    'Slug uniqueness',
    duplicateSlugs.length
      ? `Duplicate slug(s) found: ${duplicateSlugs.join(', ')}`
      : 'All loaded Team slugs are unique.'
  ));

  const publishIssues = rows.filter((row) => (
    row.is_published
    && (
      !String(row.full_name || '').trim()
      || !String(row.role_title || '').trim()
      || !String(row.short_caption || '').trim()
      || row.archived_at
    )
  ));
  results.push(check(
    publishIssues.length === 0,
    'Published record hygiene',
    publishIssues.length
      ? `Found ${publishIssues.length} published row(s) missing required content or still archived.`
      : 'Every published Team member has the required public fields and is not archived.'
  ));

  const publicRows = teamHelpers.sortTeamCollection(
    rows.map(teamHelpers.toPublicTeamMember).filter(Boolean)
  );
  const publicFromDb = normalisePublicMembers(publicRows);
  results.push(check(true, 'Direct public Team projection', `${publicFromDb.length} published Team member${publicFromDb.length === 1 ? '' : 's'} qualify for the About page.`));

  const handlerResponse = await teamListHandler({ headers: {} });
  const handlerBody = JSON.parse(handlerResponse.body || '{}');
  const handlerMembers = normalisePublicMembers(Array.isArray(handlerBody.members) ? handlerBody.members : []);

  results.push(check(
    handlerResponse.statusCode === 200,
    'team-list HTTP status',
    `team-list returned HTTP ${handlerResponse.statusCode}.`
  ));

  results.push(check(
    handlerBody.source === 'supabase',
    'team-list source',
    `team-list source is "${handlerBody.source || 'unknown'}".`
  ));

  results.push(check(
    handlerBody.schema === false,
    'team-list schema flag',
    handlerBody.schema ? 'team-list still reports schema/setup problems.' : 'team-list reports schema:false.'
  ));

  const collectionComparison = comparePublicCollections(publicFromDb, handlerMembers);
  results.push(check(collectionComparison.ok, 'Public payload reconciliation', collectionComparison.detail));

  const storageBackedRows = rows.filter((row) => String(row.image_storage_key || '').trim());
  const missingObjects = [];
  for (const row of storageBackedRows) {
    try {
      const exists = await storageObjectExists(supabase.storage.from(TEAM_BUCKET), row.image_storage_key);
      if (!exists) {
        missingObjects.push(`${row.full_name || row.id}: ${row.image_storage_key}`);
      }
    } catch (error) {
      missingObjects.push(`${row.full_name || row.id}: unable to verify (${error.message || error})`);
    }
  }
  results.push(check(
    missingObjects.length === 0,
    'Storage-backed image references',
    storageBackedRows.length === 0
      ? 'No Team members currently use Supabase storage-backed images.'
      : missingObjects.length
        ? `Missing or unverifiable storage object(s): ${missingObjects.join('; ')}`
        : `Verified ${storageBackedRows.length} Team storage object${storageBackedRows.length === 1 ? '' : 's'}.`,
    { warn: storageBackedRows.length === 0 }
  ));

  const aboutScript = fs.readFileSync(path.join(ROOT, 'assets/js/about.enhanced.js'), 'utf8');
  const aboutHtml = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  results.push(check(
    aboutScript.includes('/.netlify/functions/team-list'),
    'About page data source wiring',
    aboutScript.includes('/.netlify/functions/team-list')
      ? 'Public About page JS is wired to /.netlify/functions/team-list.'
      : 'Could not find /.netlify/functions/team-list in assets/js/about.enhanced.js.'
  ));
  results.push(check(
    /team/i.test(aboutHtml) && aboutHtml.includes('about.enhanced.js'),
    'About page enhanced script inclusion',
    aboutHtml.includes('about.enhanced.js')
      ? 'about.html includes the enhanced About page script.'
      : 'about.html does not appear to include assets/js/about.enhanced.js.'
  ));

  printResults(results);
  const failures = results.filter((result) => !result.ok && !result.warn);
  if (failures.length) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\nTeam module reconciliation checks passed.\n');
}

main().catch((error) => {
  process.stderr.write(`FAIL Team module reconciliation\n     ${error.message || error}\n`);
  process.exitCode = 1;
});
