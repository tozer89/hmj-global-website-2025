'use strict';

const {
  _handlePublicCandidateDocumentEvent,
} = require('./contact-application-documents.js');

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function withRegistrationContext(event = {}) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (method !== 'POST') {
    return event;
  }

  const body = parseBody(event);
  if (!body.source_context && !body.sourceContext && !body.public_context && !body.publicContext && !body.context) {
    body.source_context = 'candidate_registration';
  }

  return {
    ...event,
    body: JSON.stringify(body),
  };
}

async function handler(event = {}) {
  return _handlePublicCandidateDocumentEvent(withRegistrationContext(event));
}

module.exports = {
  handler,
};
