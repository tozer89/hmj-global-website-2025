'use strict';

const { trimString } = require('./_finance-crypto.js');
const {
  accessTokenExpiryIso,
  bullhornError,
  buildSafeBullhornMeta,
  getLoginInfo,
  logBullhorn,
  loginToRest,
  refreshToken,
  requestBullhornJson,
  resolveBullhornConfig,
} = require('./_bullhorn.js');
const {
  createBullhornSettingsStore,
} = require('./_bullhorn-store.js');

function lowerText(value, maxLength) {
  return trimString(value, maxLength).toLowerCase();
}

function connectionNeedsRefresh(connection = {}) {
  const expiresAt = Date.parse(trimString(connection.accessTokenExpiresAt, 80) || '');
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt < (Date.now() + (5 * 60 * 1000));
}

function isExpiredSessionError(error) {
  const code = Number(error?.statusCode || error?.code || 0);
  const message = lowerText(error?.message, 500);
  return code === 401
    || message.includes('bhresttoken')
    || message.includes('session')
    || message.includes('expired');
}

function sanitizeEntityPayload(input = {}, fieldMap = {}) {
  const mapped = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    if (value == null) return;
    const targetKey = trimString(fieldMap[key], 160) || trimString(key, 160);
    if (!targetKey) return;
    mapped[targetKey] = value;
  });
  return mapped;
}

function quoteTerm(value) {
  const text = trimString(value, 240);
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildSearchQuery(criteria = {}, defaults = {}) {
  if (trimString(criteria.query, 2000)) return trimString(criteria.query, 2000);

  const terms = [];
  const id = trimString(criteria.id, 80);
  if (id) terms.push(`id:${id}`);

  const externalIdField = trimString(defaults.externalIdField, 160);
  const externalIdValue = trimString(criteria.externalID || criteria.externalId, 240);
  if (externalIdField && externalIdValue) {
    terms.push(`${externalIdField}:${quoteTerm(externalIdValue)}`);
  }

  const nameField = trimString(defaults.nameField, 160);
  const nameValue = trimString(criteria.name || criteria.companyName, 240);
  if (nameField && nameValue) {
    terms.push(`${nameField}:${quoteTerm(nameValue)}`);
  }

  const emailField = trimString(defaults.emailField, 160);
  const emailValue = trimString(criteria.email, 320);
  if (emailField && emailValue) {
    terms.push(`${emailField}:${quoteTerm(emailValue)}`);
  }

  const firstName = trimString(criteria.firstName, 120);
  const lastName = trimString(criteria.lastName, 120);
  if (trimString(defaults.firstNameField, 160) && firstName) {
    terms.push(`${defaults.firstNameField}:${quoteTerm(firstName)}`);
  }
  if (trimString(defaults.lastNameField, 160) && lastName) {
    terms.push(`${defaults.lastNameField}:${quoteTerm(lastName)}`);
  }

  return terms.join(' AND ');
}

function ensureConnectionPresent(connection) {
  if (connection) return connection;
  throw bullhornError(
    'Bullhorn has not been authorised yet. Complete the OAuth connection first.',
    'missing_config',
    409
  );
}

async function refreshBullhornConnection(event, options = {}) {
  const store = options.store || createBullhornSettingsStore();
  const config = options.config || resolveBullhornConfig(event);
  const current = ensureConnectionPresent(options.connection || await store.readConnection(event));
  const loginInfo = options.loginInfo || {
    oauthBaseUrl: trimString(current.oauthBaseUrl, 1000),
    restBaseUrl: trimString(current.metadata?.restBaseUrl || current.restLoginUrl, 1000),
  };

  const payload = await refreshToken({
    event,
    config,
    loginInfo,
    refreshToken: current.refreshToken,
    fetchImpl: options.fetchImpl,
  });

  const saved = await store.saveConnection(event, {
    ...current,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken || current.refreshToken,
    accessTokenExpiresAt: accessTokenExpiryIso(payload),
    lastTokenRefreshAt: new Date().toISOString(),
    lastError: '',
    status: 'connected',
    metadata: {
      ...(current.metadata || {}),
      restBaseUrl: trimString(loginInfo.restBaseUrl, 1000),
    },
  });

  logBullhorn('token_refreshed', {
    apiUsername: saved.apiUsername,
    connectedEmail: saved.connectedEmail,
  });
  return saved;
}

async function ensureBullhornSession(event, options = {}) {
  const store = options.store || createBullhornSettingsStore();
  const config = options.config || resolveBullhornConfig(event);
  let connection = ensureConnectionPresent(options.connection || await store.readConnection(event));

  if (connectionNeedsRefresh(connection)) {
    connection = await refreshBullhornConnection(event, {
      ...options,
      connection,
      store,
      config,
      loginInfo: {
        oauthBaseUrl: trimString(connection.oauthBaseUrl, 1000),
        restBaseUrl: trimString(connection.metadata?.restBaseUrl || connection.restLoginUrl, 1000),
      },
    });
  }

  if (trimString(connection.bhRestToken, 16000) && trimString(connection.restUrl, 1000) && !options.forceRestLogin) {
    return connection;
  }

  const loginInfo = {
    oauthBaseUrl: trimString(connection.oauthBaseUrl, 1000),
    restBaseUrl: trimString(connection.metadata?.restBaseUrl || connection.restLoginUrl, 1000),
  };
  const restLogin = await loginToRest(connection.accessToken, loginInfo, {
    fetchImpl: options.fetchImpl,
  });

  const saved = await store.saveConnection(event, {
    ...connection,
    bhRestToken: restLogin.bhRestToken,
    restUrl: restLogin.restUrl,
    restLoginUrl: trimString(loginInfo.restBaseUrl, 1000),
    lastRestLoginAt: new Date().toISOString(),
    lastError: '',
    status: 'connected',
    metadata: {
      ...(connection.metadata || {}),
      restBaseUrl: trimString(loginInfo.restBaseUrl, 1000),
    },
  });

  logBullhorn('rest_session_established', {
    apiUsername: saved.apiUsername,
    restUrl: saved.restUrl,
  });
  return saved;
}

async function bullhornApiRequest(event, options = {}) {
  const store = options.store || createBullhornSettingsStore();
  const config = options.config || resolveBullhornConfig(event);
  let connection = await ensureBullhornSession(event, {
    ...options,
    store,
    config,
  });

  const path = trimString(options.path, 1000).replace(/^\/+/, '');
  if (!path) {
    throw bullhornError('Bullhorn API path is required.', 'runtime_error', 500);
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const url = new URL(path, trimString(connection.restUrl, 1000));
    const params = {
      ...(options.query || {}),
      BhRestToken: connection.bhRestToken,
    };
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return;
      const next = String(value);
      if (!next) return;
      url.searchParams.set(key, next);
    });

    try {
      const headers = {};
      if (options.body) headers['content-type'] = 'application/json';
      const payload = await requestBullhornJson(url.toString(), {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      }, {
        fetchImpl: options.fetchImpl,
        classification: options.classification || 'bullhorn_request_failed',
        maxAttempts: 2,
      });

      if (options.store !== false) {
        await store.saveConnection(event, {
          ...connection,
          lastError: '',
          status: 'connected',
        }).catch(() => null);
      }
      return payload;
    } catch (error) {
      if (attempt < 2 && isExpiredSessionError(error)) {
        connection = await ensureBullhornSession(event, {
          ...options,
          store,
          config,
          forceRestLogin: true,
        });
        continue;
      }

      await store.saveConnection(event, {
        ...connection,
        lastError: trimString(error?.message, 1000),
        status: 'error',
      }).catch(() => null);
      throw error;
    }
  }

  throw bullhornError('Bullhorn request failed.', 'bullhorn_request_failed', 502);
}

async function saveAuthorizedBullhornConnection(event, options = {}) {
  const store = options.store || createBullhornSettingsStore();
  const config = options.config || resolveBullhornConfig(event);
  const loginInfo = options.loginInfo || await getLoginInfo(config.apiUsername, { fetchImpl: options.fetchImpl });
  const tokenPayload = options.tokenPayload;
  const restPayload = options.restPayload;

  return store.saveConnection(event, {
    provider: 'bullhorn',
    apiUsername: config.apiUsername,
    oauthBaseUrl: loginInfo.oauthBaseUrl,
    restLoginUrl: loginInfo.restBaseUrl,
    restUrl: restPayload.restUrl,
    accessToken: tokenPayload.accessToken,
    refreshToken: tokenPayload.refreshToken,
    bhRestToken: restPayload.bhRestToken,
    accessTokenExpiresAt: accessTokenExpiryIso(tokenPayload),
    lastTokenRefreshAt: new Date().toISOString(),
    lastRestLoginAt: new Date().toISOString(),
    connectedAt: new Date().toISOString(),
    connectedBy: trimString(options.connectedBy, 240),
    connectedEmail: trimString(options.connectedEmail, 320),
    status: 'connected',
    lastError: '',
    metadata: {
      restBaseUrl: loginInfo.restBaseUrl,
      tokenType: tokenPayload.tokenType,
      scope: tokenPayload.scope,
    },
  });
}

function buildEntityFields(defaultFields, extraFields = []) {
  const values = new Set();
  defaultFields.forEach((field) => {
    const next = trimString(field, 160);
    if (next) values.add(next);
  });
  extraFields.forEach((field) => {
    const next = trimString(field, 160);
    if (next) values.add(next);
  });
  return Array.from(values).join(',');
}

async function searchClientCorporation(event, criteria = {}, options = {}) {
  const fieldMap = options.fieldMap || {};
  const query = buildSearchQuery(criteria, {
    nameField: trimString(fieldMap.name, 160) || 'name',
    externalIdField: trimString(fieldMap.externalID || fieldMap.externalId, 160) || 'externalID',
  });
  return bullhornApiRequest(event, {
    ...options,
    path: 'search/ClientCorporation',
    classification: 'bullhorn_request_failed',
    query: {
      query,
      fields: buildEntityFields(['id', 'name', 'externalID'], options.fields || []),
      count: String(Math.max(1, Number(options.count || 10))),
      start: String(Math.max(0, Number(options.start || 0))),
      sort: trimString(options.sort, 120) || 'id',
    },
  });
}

async function createClientCorporation(event, input = {}, options = {}) {
  const settings = options.integrationSettings || await (options.store || createBullhornSettingsStore()).readIntegrationSettings(event);
  const body = sanitizeEntityPayload(input, settings.entityMappings.clientCorporation);
  return bullhornApiRequest(event, {
    ...options,
    method: 'PUT',
    path: 'entity/ClientCorporation',
    body,
  });
}

async function updateClientCorporation(event, id, input = {}, options = {}) {
  const entityId = trimString(id, 80);
  if (!entityId) throw bullhornError('Bullhorn company id is required.', 'runtime_error', 400);
  const settings = options.integrationSettings || await (options.store || createBullhornSettingsStore()).readIntegrationSettings(event);
  const body = sanitizeEntityPayload(input, settings.entityMappings.clientCorporation);
  return bullhornApiRequest(event, {
    ...options,
    method: 'POST',
    path: `entity/ClientCorporation/${encodeURIComponent(entityId)}`,
    body,
  });
}

async function searchClientContact(event, criteria = {}, options = {}) {
  const fieldMap = options.fieldMap || {};
  const query = buildSearchQuery(criteria, {
    emailField: trimString(fieldMap.email, 160) || 'email',
    firstNameField: trimString(fieldMap.firstName, 160) || 'firstName',
    lastNameField: trimString(fieldMap.lastName, 160) || 'lastName',
    externalIdField: trimString(fieldMap.externalID || fieldMap.externalId, 160) || 'externalID',
  });
  return bullhornApiRequest(event, {
    ...options,
    path: 'search/ClientContact',
    classification: 'bullhorn_request_failed',
    query: {
      query,
      fields: buildEntityFields(['id', 'firstName', 'lastName', 'email', 'clientCorporation(id,name)'], options.fields || []),
      count: String(Math.max(1, Number(options.count || 10))),
      start: String(Math.max(0, Number(options.start || 0))),
      sort: trimString(options.sort, 120) || 'id',
    },
  });
}

async function createClientContact(event, input = {}, options = {}) {
  const settings = options.integrationSettings || await (options.store || createBullhornSettingsStore()).readIntegrationSettings(event);
  const body = sanitizeEntityPayload(input, settings.entityMappings.clientContact);
  return bullhornApiRequest(event, {
    ...options,
    method: 'PUT',
    path: 'entity/ClientContact',
    body,
  });
}

async function updateClientContact(event, id, input = {}, options = {}) {
  const entityId = trimString(id, 80);
  if (!entityId) throw bullhornError('Bullhorn contact id is required.', 'runtime_error', 400);
  const settings = options.integrationSettings || await (options.store || createBullhornSettingsStore()).readIntegrationSettings(event);
  const body = sanitizeEntityPayload(input, settings.entityMappings.clientContact);
  return bullhornApiRequest(event, {
    ...options,
    method: 'POST',
    path: `entity/ClientContact/${encodeURIComponent(entityId)}`,
    body,
  });
}

async function getEntityMeta(event, entityName, options = {}) {
  const safeEntityName = trimString(entityName, 120);
  if (!safeEntityName) throw bullhornError('Bullhorn entity name is required.', 'runtime_error', 400);
  return bullhornApiRequest(event, {
    ...options,
    path: `meta/${encodeURIComponent(safeEntityName)}`,
    query: {
      fields: trimString(options.fields, 500) || '*',
    },
  });
}

module.exports = {
  buildSearchQuery,
  bullhornApiRequest,
  connectionNeedsRefresh,
  createClientContact,
  createClientCorporation,
  ensureBullhornSession,
  getEntityMeta,
  isExpiredSessionError,
  refreshBullhornConnection,
  saveAuthorizedBullhornConnection,
  searchClientContact,
  searchClientCorporation,
  sanitizeEntityPayload,
  updateClientContact,
  updateClientCorporation,
  __test: {
    buildSafeBullhornMeta,
  },
};
