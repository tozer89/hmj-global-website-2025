'use strict';

const { fetchSettings, saveSettings } = require('./_settings-helpers.js');
const { trimString, encryptValue, decryptValue } = require('./_finance-crypto.js');

const BULLHORN_CONNECTION_KEY = 'bullhorn_oauth_connection';
const BULLHORN_RUNTIME_KEY = 'bullhorn_runtime_status';
const BULLHORN_SETTINGS_KEY = 'bullhorn_integration_settings';

const DEFAULT_BULLHORN_SETTINGS = Object.freeze({
  entityMappings: {
    clientCorporation: {},
    clientContact: {},
  },
  emailActivity: {
    enabled: false,
    entityName: '',
    directionField: '',
    statusField: '',
    contactField: '',
    companyField: '',
  },
});

function lowerText(value, maxLength) {
  return trimString(value, maxLength).toLowerCase();
}

function asObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return fallback;
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function defaultSettings() {
  return clone(DEFAULT_BULLHORN_SETTINGS);
}

function normalizeSettings(value = {}) {
  const source = asObject(value, {});
  const next = defaultSettings();

  next.entityMappings.clientCorporation = asObject(source.entityMappings?.clientCorporation, {});
  next.entityMappings.clientContact = asObject(source.entityMappings?.clientContact, {});
  next.emailActivity = {
    ...next.emailActivity,
    ...asObject(source.emailActivity, {}),
  };

  next.emailActivity.enabled = next.emailActivity.enabled === true;
  next.emailActivity.entityName = trimString(next.emailActivity.entityName, 160);
  next.emailActivity.directionField = trimString(next.emailActivity.directionField, 160);
  next.emailActivity.statusField = trimString(next.emailActivity.statusField, 160);
  next.emailActivity.contactField = trimString(next.emailActivity.contactField, 160);
  next.emailActivity.companyField = trimString(next.emailActivity.companyField, 160);
  return next;
}

function normalizeConnectionForStorage(input = {}) {
  return {
    provider: 'bullhorn',
    apiUsername: trimString(input.apiUsername, 320),
    oauthBaseUrl: trimString(input.oauthBaseUrl, 1000),
    restLoginUrl: trimString(input.restLoginUrl, 1000),
    restUrl: trimString(input.restUrl, 1000),
    authType: 'oauth2',
    accessTokenEncrypted: trimString(input.accessToken, 16000) ? encryptValue(input.accessToken) : '',
    refreshTokenEncrypted: trimString(input.refreshToken, 16000) ? encryptValue(input.refreshToken) : '',
    bhRestTokenEncrypted: trimString(input.bhRestToken, 16000) ? encryptValue(input.bhRestToken) : '',
    accessTokenExpiresAt: trimString(input.accessTokenExpiresAt, 80) || '',
    lastTokenRefreshAt: trimString(input.lastTokenRefreshAt, 80) || '',
    lastRestLoginAt: trimString(input.lastRestLoginAt, 80) || '',
    connectedAt: trimString(input.connectedAt, 80) || new Date().toISOString(),
    connectedBy: trimString(input.connectedBy, 240) || '',
    connectedEmail: lowerText(input.connectedEmail, 320),
    status: trimString(input.status, 80) || 'connected',
    lastError: trimString(input.lastError, 1000) || '',
    metadata: asObject(input.metadata, {}),
  };
}

function normalizeConnectionForRead(value = {}) {
  const stored = asObject(value, {});
  return {
    provider: 'bullhorn',
    apiUsername: trimString(stored.apiUsername, 320),
    oauthBaseUrl: trimString(stored.oauthBaseUrl, 1000),
    restLoginUrl: trimString(stored.restLoginUrl, 1000),
    restUrl: trimString(stored.restUrl, 1000),
    accessToken: trimString(stored.accessTokenEncrypted, 20000) ? decryptValue(stored.accessTokenEncrypted) : '',
    refreshToken: trimString(stored.refreshTokenEncrypted, 20000) ? decryptValue(stored.refreshTokenEncrypted) : '',
    bhRestToken: trimString(stored.bhRestTokenEncrypted, 20000) ? decryptValue(stored.bhRestTokenEncrypted) : '',
    accessTokenExpiresAt: trimString(stored.accessTokenExpiresAt, 80),
    lastTokenRefreshAt: trimString(stored.lastTokenRefreshAt, 80),
    lastRestLoginAt: trimString(stored.lastRestLoginAt, 80),
    connectedAt: trimString(stored.connectedAt, 80),
    connectedBy: trimString(stored.connectedBy, 240),
    connectedEmail: lowerText(stored.connectedEmail, 320),
    status: trimString(stored.status, 80) || 'connected',
    lastError: trimString(stored.lastError, 1000),
    metadata: asObject(stored.metadata, {}),
  };
}

function normalizeConnectionForClient(value = {}) {
  const current = normalizeConnectionForRead(value);
  return {
    provider: current.provider,
    apiUsername: current.apiUsername,
    oauthBaseUrl: current.oauthBaseUrl,
    restLoginUrl: current.restLoginUrl,
    restUrl: current.restUrl,
    accessTokenExpiresAt: current.accessTokenExpiresAt,
    lastTokenRefreshAt: current.lastTokenRefreshAt,
    lastRestLoginAt: current.lastRestLoginAt,
    connectedAt: current.connectedAt,
    connectedBy: current.connectedBy,
    connectedEmail: current.connectedEmail,
    status: current.status,
    lastError: current.lastError,
    connected: !!current.refreshToken,
    metadata: current.metadata,
  };
}

function normalizeRuntimeStatus(value = {}) {
  const source = asObject(value, {});
  return {
    lastEvent: trimString(source.lastEvent, 120),
    lastEventAt: trimString(source.lastEventAt, 80),
    lastError: trimString(source.lastError, 1000),
    lastErrorAt: trimString(source.lastErrorAt, 80),
    lastSuccessAt: trimString(source.lastSuccessAt, 80),
    pendingAuth: asObject(source.pendingAuth, null),
    connectedEmail: lowerText(source.connectedEmail, 320),
    apiUsername: trimString(source.apiUsername, 320),
    restUrl: trimString(source.restUrl, 1000),
    returnTo: trimString(source.returnTo, 1000),
  };
}

function createBullhornSettingsStore(options = {}) {
  const fetchSettingsImpl = options.fetchSettingsImpl || fetchSettings;
  const saveSettingsImpl = options.saveSettingsImpl || saveSettings;

  return {
    async readConnection(event) {
      const result = await fetchSettingsImpl(event, [BULLHORN_CONNECTION_KEY]);
      const stored = result?.settings?.[BULLHORN_CONNECTION_KEY];
      if (!stored || typeof stored !== 'object') return null;
      return normalizeConnectionForRead(stored);
    },

    async saveConnection(event, input = {}) {
      const current = await this.readConnection(event).catch(() => null);
      const next = normalizeConnectionForStorage({
        ...current,
        ...input,
      });
      await saveSettingsImpl(event, {
        [BULLHORN_CONNECTION_KEY]: next,
      });
      return normalizeConnectionForRead(next);
    },

    async clearConnection(event) {
      await saveSettingsImpl(event, {
        [BULLHORN_CONNECTION_KEY]: null,
      });
      return null;
    },

    async readRuntimeStatus(event) {
      const result = await fetchSettingsImpl(event, [BULLHORN_RUNTIME_KEY]);
      return normalizeRuntimeStatus(result?.settings?.[BULLHORN_RUNTIME_KEY]);
    },

    async saveRuntimeStatus(event, input = {}) {
      const current = await this.readRuntimeStatus(event).catch(() => normalizeRuntimeStatus({}));
      const next = normalizeRuntimeStatus({
        ...current,
        ...asObject(input, {}),
      });
      await saveSettingsImpl(event, {
        [BULLHORN_RUNTIME_KEY]: next,
      });
      return next;
    },

    async readIntegrationSettings(event) {
      const result = await fetchSettingsImpl(event, [BULLHORN_SETTINGS_KEY]);
      return normalizeSettings(result?.settings?.[BULLHORN_SETTINGS_KEY]);
    },

    async saveIntegrationSettings(event, input = {}) {
      const current = await this.readIntegrationSettings(event).catch(() => defaultSettings());
      const next = normalizeSettings({
        ...current,
        ...asObject(input, {}),
      });
      await saveSettingsImpl(event, {
        [BULLHORN_SETTINGS_KEY]: next,
      });
      return next;
    },
  };
}

function createMemoryBullhornStore(seed = {}) {
  const state = {
    connection: seed.connection ? normalizeConnectionForStorage(seed.connection) : null,
    runtime: normalizeRuntimeStatus(seed.runtime),
    settings: normalizeSettings(seed.settings),
  };

  return {
    async readConnection() {
      return state.connection ? normalizeConnectionForRead(state.connection) : null;
    },
    async saveConnection(_event, input = {}) {
      const current = state.connection ? normalizeConnectionForRead(state.connection) : {};
      state.connection = normalizeConnectionForStorage({
        ...current,
        ...input,
      });
      return normalizeConnectionForRead(state.connection);
    },
    async clearConnection() {
      state.connection = null;
      return null;
    },
    async readRuntimeStatus() {
      return normalizeRuntimeStatus(state.runtime);
    },
    async saveRuntimeStatus(_event, input = {}) {
      state.runtime = normalizeRuntimeStatus({
        ...state.runtime,
        ...asObject(input, {}),
      });
      return normalizeRuntimeStatus(state.runtime);
    },
    async readIntegrationSettings() {
      return normalizeSettings(state.settings);
    },
    async saveIntegrationSettings(_event, input = {}) {
      state.settings = normalizeSettings({
        ...state.settings,
        ...asObject(input, {}),
      });
      return normalizeSettings(state.settings);
    },
  };
}

module.exports = {
  BULLHORN_CONNECTION_KEY,
  BULLHORN_RUNTIME_KEY,
  BULLHORN_SETTINGS_KEY,
  DEFAULT_BULLHORN_SETTINGS,
  createBullhornSettingsStore,
  createMemoryBullhornStore,
  normalizeConnectionForClient,
  normalizeConnectionForRead,
  normalizeRuntimeStatus,
  normalizeSettings,
};
