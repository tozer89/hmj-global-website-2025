'use strict';

const crypto = require('node:crypto');

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function resolveFinanceSecret() {
  const raw = trimString(
    process.env.HMJ_FINANCE_SECRET
      || process.env.HMJ_PAYMENT_DETAILS_SECRET
      || process.env.CANDIDATE_PAYMENT_DETAILS_SECRET
      || process.env.SUPABASE_JWT_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || '',
    4000
  );
  if (!raw) {
    const error = new Error('Missing HMJ_FINANCE_SECRET or fallback finance encryption secret.');
    error.code = 500;
    throw error;
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptValue(value) {
  const plain = trimString(value, 16000);
  if (!plain) return '';
  const key = resolveFinanceSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptValue(payload) {
  const raw = trimString(payload, 20000);
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    const error = new Error('Unsupported finance secret payload.');
    error.code = 400;
    throw error;
  }
  const [, ivRaw, tagRaw, bodyRaw] = parts;
  const key = resolveFinanceSecret();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivRaw, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bodyRaw, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

module.exports = {
  trimString,
  encryptValue,
  decryptValue,
};
