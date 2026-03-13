const { createHmac, timingSafeEqual } = require('node:crypto');

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getSigningSecret() {
  const candidates = [
    process.env.HMJ_JOB_SPEC_SIGNING_SECRET,
    process.env.JOB_SPEC_SIGNING_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ];

  return candidates.find((value) => cleanText(value)) || '';
}

function base64UrlEncode(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signPayload(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function createShareAccessToken({ jobId, expiresAt } = {}) {
  const safeJobId = cleanText(jobId);
  const secret = getSigningSecret();
  if (!safeJobId || !secret) return '';

  const payload = JSON.stringify({
    jobId: safeJobId,
    exp: cleanText(expiresAt) || null,
  });
  const encodedPayload = base64UrlEncode(payload);
  const signature = signPayload(encodedPayload, secret);
  return `v1.${encodedPayload}.${signature}`;
}

function verifyShareAccessToken(token, expectedJobId) {
  const safeToken = cleanText(token);
  const safeJobId = cleanText(expectedJobId);
  const secret = getSigningSecret();
  if (!safeToken || !safeJobId || !secret) return false;

  const [version, encodedPayload, signature] = safeToken.split('.');
  if (version !== 'v1' || !encodedPayload || !signature) return false;

  const expectedSignature = signPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (_) {
    return false;
  }

  if (cleanText(payload?.jobId) !== safeJobId) return false;

  if (payload?.exp) {
    const expiresAt = new Date(payload.exp);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return false;
    }
  }

  return true;
}

function buildTokenizedJobDetailPath({ jobId, token } = {}) {
  const safeJobId = cleanText(jobId);
  if (!safeJobId) return '';

  const params = new URLSearchParams();
  params.set('id', safeJobId);

  const safeToken = cleanText(token);
  if (safeToken) {
    params.set('token', safeToken);
  }

  return `/jobs/spec.html?${params.toString()}`;
}

module.exports = {
  createShareAccessToken,
  verifyShareAccessToken,
  buildTokenizedJobDetailPath,
};
