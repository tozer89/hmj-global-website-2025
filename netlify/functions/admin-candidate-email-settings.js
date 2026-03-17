'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  applyCandidateEmailSettingsToSupabase,
  persistCandidateEmailSettings,
  readCandidateEmailSettings,
} = require('./_candidate-email-settings.js');

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch (error) {
    return {};
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const { user } = await getContext(event, context, { requireAdmin: true });
    const body = parseBody(event);
    const action = String(body.action || 'get').trim().toLowerCase();

    if (action === 'get') {
      const current = await readCandidateEmailSettings(event);
      return response(200, {
        ok: true,
        settings: current.redacted,
        diagnostics: current.diagnostics,
        previews: current.previews,
        patchPreview: current.patchPreview,
        source: current.source,
      });
    }

    if (action === 'save') {
      const saved = await persistCandidateEmailSettings(event, body.settings || body, {});
      return response(200, {
        ok: true,
        settings: saved.redacted,
        diagnostics: saved.diagnostics,
        previews: saved.previews,
        patchPreview: saved.patchPreview,
        source: saved.source,
        message: 'Candidate email settings saved.',
      });
    }

    if (action === 'apply') {
      const saved = await persistCandidateEmailSettings(event, body.settings || body, {});
      const applied = await applyCandidateEmailSettingsToSupabase(event, {
        settings: saved.settings,
        managementToken: body.managementToken,
      });
      const refreshed = await persistCandidateEmailSettings(event, {}, {
        appliedAt: new Date().toISOString(),
        appliedBy: user?.email || 'admin',
      });
      return response(200, {
        ok: true,
        settings: refreshed.redacted,
        diagnostics: refreshed.diagnostics,
        previews: refreshed.previews,
        patchPreview: refreshed.patchPreview,
        applyResult: applied,
        source: refreshed.source,
        message: 'Candidate email settings were applied to Supabase Auth.',
      });
    }

    throw coded(400, 'Unknown candidate email settings action.');
  } catch (error) {
    const statusCode = Number(error?.code) || Number(error?.status) || 500;
    return response(statusCode, {
      ok: false,
      error: error?.message || 'Candidate email settings request failed.',
      details: error?.details || null,
    });
  }
});
