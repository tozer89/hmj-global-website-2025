'use strict';

const { trimString } = require('./_finance-crypto.js');
const { bullhornError } = require('./_bullhorn.js');
const { createBullhornSettingsStore } = require('./_bullhorn-store.js');

function createBullhornEmailActivityAdapter(options = {}) {
  const store = options.store || createBullhornSettingsStore();

  async function loadSettings(event) {
    const settings = await store.readIntegrationSettings(event);
    const config = settings?.emailActivity || {};
    if (!config.enabled || !trimString(config.entityName, 160)) {
      throw bullhornError(
        'Bullhorn email activity sync is not configured yet. Review tenant metadata before enabling activity writes.',
        'missing_config',
        409
      );
    }
    return config;
  }

  return {
    async describe(event) {
      const config = await loadSettings(event);
      return {
        entityName: trimString(config.entityName, 160),
        directionField: trimString(config.directionField, 160),
        statusField: trimString(config.statusField, 160),
        contactField: trimString(config.contactField, 160),
        companyField: trimString(config.companyField, 160),
      };
    },

    async recordOutboundEmail(event, payload = {}) {
      await loadSettings(event);
      throw bullhornError(
        `Bullhorn email activity mapping for outbound email is still pending tenant review (${trimString(payload.subject, 120) || 'unspecified subject'}).`,
        'missing_config',
        409
      );
    },

    async recordInboundEmail(event, payload = {}) {
      await loadSettings(event);
      throw bullhornError(
        `Bullhorn email activity mapping for inbound email is still pending tenant review (${trimString(payload.subject, 120) || 'unspecified subject'}).`,
        'missing_config',
        409
      );
    },
  };
}

module.exports = {
  createBullhornEmailActivityAdapter,
};
