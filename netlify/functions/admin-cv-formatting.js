'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { formatClientReadyCv } = require('../../lib/cv-formatter-core.js');

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

function normaliseUpload(file, label) {
  if (!file || typeof file !== 'object') {
    return null;
  }

  const name = trimString(file.name, 180);
  const contentType = trimString(file.contentType || file.type, 120);
  const size = Number(file.size) || 0;
  const data = trimString(file.data);

  if (!name || !data) {
    const error = new Error(`${label} is missing a file name or file content.`);
    error.statusCode = 400;
    throw error;
  }

  if (size <= 0 || size > MAX_FILE_BYTES) {
    const error = new Error(`${label} must be between 1 byte and ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`);
    error.statusCode = 400;
    throw error;
  }

  return {
    name,
    contentType,
    size,
    data,
  };
}

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  const body = safeJsonParse(event.body);
  if (!body) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'invalid_json' }),
    };
  }

  try {
    const candidateFile = normaliseUpload(body.candidateFile, 'Candidate CV');
    const jobSpecFile = body.jobSpecFile ? normaliseUpload(body.jobSpecFile, 'Job spec') : null;
    if (!candidateFile) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'candidate_file_required' }),
      };
    }

    const result = await formatClientReadyCv({
      candidateFile,
      jobSpecFile,
      options: body?.options || {},
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        source: result.source,
        model: result.model,
        analysis: result.analysis,
        profile: result.profile,
        file: {
          name: result.fileName,
          contentType: result.contentType,
          data: result.buffer.toString('base64'),
        },
      }),
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode) || Number(error?.code) || 500;
    return {
      statusCode: statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: trimString(error?.message || 'cv_formatting_failed', 240),
        details: error?.details || null,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
