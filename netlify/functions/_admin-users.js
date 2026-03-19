'use strict';

const {
  trimString,
  lowerEmail,
  memberDisplayName,
} = require('./_team-tasks-helpers.js');

const IDENTITY_PAGE_SIZE = 100;
const IDENTITY_MAX_PAGES = 5;

function normaliseRoleList(input) {
  const raw = Array.isArray(input)
    ? input
    : (input == null ? [] : [input]);
  return raw
    .map((value) => trimString(value, 64).toLowerCase())
    .filter(Boolean);
}

function collectRoles(...sources) {
  const raw = [];
  sources.forEach((entry) => {
    if (Array.isArray(entry)) raw.push(...entry);
    else if (entry != null) raw.push(entry);
  });
  return normaliseRoleList(raw);
}

function pickPreferredText(existing, incoming, maxLength = 160) {
  const left = trimString(existing, maxLength);
  const right = trimString(incoming, maxLength);
  if (!left) return right;
  if (!right) return left;
  if (left.includes('@') && !right.includes('@')) return right;
  if (!left.includes(' ') && right.includes(' ')) return right;
  return left.length >= right.length ? left : right;
}

function normaliseMemberRecord(row = {}) {
  const meta = row?.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? row.meta
    : {};
  const email = lowerEmail(row.email || row.actor_email || meta.email);
  const userId = trimString(row.userId || row.user_id || row.id || meta.user_id, 120);
  const roles = collectRoles(
    row.roles,
    row.role,
    row?.app_metadata?.roles,
    row?.app_metadata?.role,
    row?.app_metadata?.authorization?.roles,
    row?.app_metadata?.authorization?.role,
    row?.user_metadata?.roles,
    row?.user_metadata?.role,
    meta.roles,
    meta.netlify_roles,
    meta.role
  );
  const preferredRole = roles.includes('owner')
    ? 'owner'
    : (roles.includes('admin') ? 'admin' : (trimString(row.role || meta.role, 64) || 'admin'));
  return {
    id: trimString(row.id, 120) || userId || email,
    userId: userId || email,
    email,
    displayName: trimString(
      row.displayName
        || row.display_name
        || row.fullName
        || row.full_name
        || row.name
        || meta.display_name
        || meta.full_name
        || meta.name,
      160
    ) || memberDisplayName({ email, userId }),
    role: preferredRole,
    isActive: row.isActive !== false && row.is_active !== false,
    roles: roles.length ? roles : [preferredRole],
    meta,
  };
}

function resolveNetlifyIdentityContext(context = {}) {
  const raw = context?.clientContext?.custom?.netlify;
  if (!raw || typeof raw !== 'object') {
    return { baseUrl: '', token: '' };
  }

  const baseUrl = trimString(
    raw.url
      || raw.identity_url
      || raw.identityUrl
      || raw?.identity?.url,
    500
  )
    .replace(/\/user\/?$/i, '')
    .replace(/\/$/, '');

  return {
    baseUrl,
    token: trimString(
      raw.token
        || raw.identity_token
        || raw.identityToken
        || raw?.identity?.token,
      8000
    ),
  };
}

function normaliseIdentityUser(raw = {}, match = null) {
  const tableMatch = match ? normaliseMemberRecord(match) : null;
  const email = lowerEmail(raw.email || raw.user?.email || tableMatch?.email);
  const userId = trimString(raw.id || raw.user_id || raw.uid || tableMatch?.userId, 120) || email;
  const userMeta = raw?.user_metadata && typeof raw.user_metadata === 'object' && !Array.isArray(raw.user_metadata)
    ? raw.user_metadata
    : {};
  const appMeta = raw?.app_metadata && typeof raw.app_metadata === 'object' && !Array.isArray(raw.app_metadata)
    ? raw.app_metadata
    : {};
  const roles = collectRoles(
    appMeta.roles,
    appMeta.role,
    appMeta?.authorization?.roles,
    appMeta?.authorization?.role,
    raw.roles,
    raw.role,
    userMeta.roles,
    userMeta.role
  );

  const displayName = pickPreferredText(
    tableMatch?.displayName,
    trimString(
      userMeta.display_name
        || userMeta.full_name
        || userMeta.name
        || userMeta.fullName
        || raw.full_name
        || raw.name,
      160
    ) || memberDisplayName({ email, userId })
  );

  return {
    id: trimString(raw.id, 120) || userId || email,
    userId: userId || email,
    email,
    displayName,
    role: roles.includes('owner')
      ? 'owner'
      : (trimString(tableMatch?.role, 64) || roles[0] || 'admin'),
    isActive: raw?.banned !== true
      && raw?.disabled !== true
      && raw?.blocked !== true
      && tableMatch?.isActive !== false,
    roles,
    meta: {
      ...(tableMatch?.meta || {}),
      ...(email ? { email } : {}),
      ...(displayName ? { display_name: displayName } : {}),
      ...(roles.length ? { netlify_roles: roles } : {}),
      netlify_user_id: trimString(raw.id, 120) || null,
      provider: 'netlify-identity',
    },
  };
}

function mergeMemberRecords(rows = []) {
  const merged = [];
  const userIndex = new Map();
  const emailIndex = new Map();

  rows.forEach((row) => {
    const member = normaliseMemberRecord(row);
    const userId = trimString(member.userId, 120);
    const email = lowerEmail(member.email);
    const existingIndex = (
      (userId && userIndex.has(userId) ? userIndex.get(userId) : null)
      ?? (email && emailIndex.has(email) ? emailIndex.get(email) : null)
    );

    if (existingIndex == null) {
      const index = merged.push(member) - 1;
      if (userId) userIndex.set(userId, index);
      if (email) emailIndex.set(email, index);
      return;
    }

    const existing = merged[existingIndex];
    const next = {
      ...existing,
      id: trimString(existing.id, 120) || trimString(member.id, 120) || userId || email,
      userId: trimString(existing.userId, 120) || userId || email,
      email: lowerEmail(existing.email) || email,
      displayName: pickPreferredText(existing.displayName, member.displayName),
      role: (
        normaliseRoleList([existing.role, ...(existing.roles || []), member.role, ...(member.roles || [])]).includes('owner')
          ? 'owner'
          : (trimString(existing.role, 64) || trimString(member.role, 64) || 'admin')
      ),
      isActive: existing.isActive !== false && member.isActive !== false,
      roles: Array.from(new Set([
        ...normaliseRoleList(existing.roles || []),
        ...normaliseRoleList(member.roles || []),
        trimString(existing.role, 64),
        trimString(member.role, 64),
      ].filter(Boolean))),
      meta: {
        ...(existing.meta || {}),
        ...(member.meta || {}),
      },
    };

    merged[existingIndex] = next;
    if (trimString(next.userId, 120)) userIndex.set(trimString(next.userId, 120), existingIndex);
    if (lowerEmail(next.email)) emailIndex.set(lowerEmail(next.email), existingIndex);
  });

  return merged
    .filter((member) => member.isActive !== false && (member.userId || member.email))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'en-GB', { sensitivity: 'base' }));
}

async function fetchNetlifyIdentityUsers(context, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const identity = resolveNetlifyIdentityContext(context);
  if (!identity.baseUrl || !identity.token || typeof fetchImpl !== 'function') {
    return [];
  }

  const users = [];
  const seen = new Set();

  for (let page = 1; page <= IDENTITY_MAX_PAGES; page += 1) {
    const url = new URL(`${identity.baseUrl}/admin/users`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(IDENTITY_PAGE_SIZE));

    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${identity.token}`,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const bodyText = typeof response.text === 'function'
        ? await response.text().catch(() => '')
        : '';
      const reason = trimString(bodyText, 240) || `status ${response.status}`;
      throw new Error(`Netlify Identity user lookup failed (${reason}).`);
    }

    const payload = await response.json().catch(() => null);
    const rows = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.users) ? payload.users : []);

    if (!rows.length) break;

    let freshCount = 0;
    rows.forEach((row) => {
      const key = trimString(row?.id || row?.email, 200).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      users.push(row);
      freshCount += 1;
    });

    const nextPage = Number.parseInt(String(payload?.next_page || payload?.nextPage || ''), 10);
    const total = Number.parseInt(String(payload?.total || ''), 10);
    if (Number.isFinite(nextPage) && nextPage > page) {
      page = nextPage - 1;
      continue;
    }
    if (Number.isFinite(total) && users.length < total) {
      continue;
    }
    if (freshCount < IDENTITY_PAGE_SIZE) break;
  }

  return users;
}

function buildAssignableAdminMembers({ tableRows = [], identityUsers = [], currentUser = null } = {}) {
  const tableMembers = Array.isArray(tableRows)
    ? tableRows.map((row) => normaliseMemberRecord(row)).filter((row) => row.isActive !== false)
    : [];

  const tableByUserId = new Map();
  const tableByEmail = new Map();
  tableMembers.forEach((row) => {
    if (row.userId) tableByUserId.set(row.userId, row);
    if (row.email) tableByEmail.set(row.email, row);
  });

  const identityMembers = Array.isArray(identityUsers)
    ? identityUsers
      .map((row) => {
        const email = lowerEmail(row?.email);
        const userId = trimString(row?.id || row?.user_id || row?.uid, 120);
        const match = (userId && tableByUserId.get(userId)) || (email && tableByEmail.get(email)) || null;
        return normaliseIdentityUser(row, match);
      })
      .filter((row) => row.isActive !== false && (row.userId || row.email))
    : [];

  const currentMember = currentUser ? normaliseMemberRecord(currentUser) : null;
  return mergeMemberRecords([
    ...identityMembers,
    ...tableMembers,
    ...(currentMember ? [currentMember] : []),
  ]);
}

module.exports = {
  buildAssignableAdminMembers,
  fetchNetlifyIdentityUsers,
  mergeMemberRecords,
  normaliseIdentityUser,
  normaliseMemberRecord,
  resolveNetlifyIdentityContext,
};
