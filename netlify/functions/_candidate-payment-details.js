'use strict';

const crypto = require('node:crypto');

const PAYMENT_METHODS = {
  gbp_local: 'gbp_local',
  iban_swift: 'iban_swift',
};

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function upperText(value, maxLength) {
  const text = trimString(value, maxLength);
  return text ? text.toUpperCase() : '';
}

function digitsOnly(value, maxLength = 64) {
  return trimString(value, maxLength).replace(/\D+/g, '');
}

function normaliseCurrency(value) {
  const currency = upperText(value, 12);
  if (!currency) return 'GBP';
  if (currency === 'GBP') return 'GBP';
  if (currency === 'EUR') return 'EUR';
  return currency;
}

function normalisePaymentMethod(value, currency) {
  const raw = trimString(value, 40).toLowerCase();
  if (raw === PAYMENT_METHODS.gbp_local || raw === 'gbp') return PAYMENT_METHODS.gbp_local;
  if (raw === PAYMENT_METHODS.iban_swift || raw === 'international' || raw === 'eur') return PAYMENT_METHODS.iban_swift;
  return normaliseCurrency(currency) === 'GBP'
    ? PAYMENT_METHODS.gbp_local
    : PAYMENT_METHODS.iban_swift;
}

function formatSortCode(sortCode) {
  const digits = digitsOnly(sortCode, 16);
  if (digits.length !== 6) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
}

function maskValue(value, visible = 4, prefix = '') {
  const text = trimString(value, 80);
  if (!text) return '';
  if (text.length <= visible) return `${prefix}${text}`;
  return `${prefix}${'•'.repeat(Math.max(0, text.length - visible))}${text.slice(-visible)}`;
}

function maskSortCode(sortCode) {
  const digits = digitsOnly(sortCode, 16);
  if (!digits) return '';
  if (digits.length <= 2) return maskValue(digits, 1);
  return `••-••-${digits.slice(-2)}`;
}

function maskIban(iban) {
  const clean = upperText(iban, 64).replace(/\s+/g, '');
  if (!clean) return '';
  if (clean.length <= 8) return maskValue(clean, 4);
  return `${clean.slice(0, 4)} ${'•'.repeat(Math.max(0, clean.length - 8))}${clean.slice(-4)}`;
}

function paymentSecret() {
  return trimString(
    process.env.HMJ_PAYMENT_DETAILS_SECRET
    || process.env.CANDIDATE_PAYMENT_DETAILS_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_JWT_SECRET,
    4000,
  );
}

function encryptionKey() {
  const secret = paymentSecret();
  if (!secret) {
    const error = new Error('Add HMJ_PAYMENT_DETAILS_SECRET before storing payment details.');
    error.code = 'payment_secret_missing';
    throw error;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptValue(value) {
  const plain = trimString(value, 240);
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const key = encryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptValue(payload) {
  const text = trimString(payload, 4000);
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function validateGbpFields(input, errors, options = {}) {
  const sortCodeDigits = digitsOnly(input.sort_code, 16);
  const accountNumberDigits = digitsOnly(input.account_number, 16);
  if (!sortCodeDigits && !accountNumberDigits && options.allowBlank === true) {
    return { sortCodeDigits, accountNumberDigits };
  }
  if (sortCodeDigits.length !== 6) {
    errors.push('Enter a valid 6-digit sort code.');
  }
  if (accountNumberDigits.length < 6 || accountNumberDigits.length > 10) {
    errors.push('Enter a valid account number.');
  }
  return {
    sortCodeDigits,
    accountNumberDigits,
  };
}

function validateIbanFields(input, errors, options = {}) {
  const iban = upperText(input.iban, 64).replace(/\s+/g, '');
  const swiftBic = upperText(input.swift_bic, 32).replace(/\s+/g, '');
  if (!iban && !swiftBic && options.allowBlank === true) {
    return { iban, swiftBic };
  }
  if (!/^[A-Z]{2}[A-Z0-9]{13,32}$/.test(iban)) {
    errors.push('Enter a valid IBAN.');
  }
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swiftBic)) {
    errors.push('Enter a valid SWIFT / BIC code.');
  }
  return {
    iban,
    swiftBic,
  };
}

function normalisePaymentInput(input = {}, options = {}) {
  const accountCurrency = normaliseCurrency(input.account_currency || input.payment_currency);
  const paymentMethod = normalisePaymentMethod(input.payment_method, accountCurrency);
  const accountHolderName = trimString(input.account_holder_name, 160);
  const bankName = trimString(input.bank_name, 160);
  const bankLocationOrCountry = trimString(input.bank_location_or_country || input.bank_country || input.bank_location, 160);
  const accountType = trimString(input.account_type, 80);
  const errors = [];

  if (!accountHolderName) errors.push('Enter the account holder name.');
  if (!bankName) errors.push('Enter the bank name.');
  if (!bankLocationOrCountry) errors.push('Enter the bank country or location.');

  let sortCodeDigits = '';
  let accountNumberDigits = '';
  let iban = '';
  let swiftBic = '';

  if (paymentMethod === PAYMENT_METHODS.gbp_local) {
    ({ sortCodeDigits, accountNumberDigits } = validateGbpFields(input, errors, {
      allowBlank: options.allowBlankSensitive === true,
    }));
  } else {
    ({ iban, swiftBic } = validateIbanFields(input, errors, {
      allowBlank: options.allowBlankSensitive === true,
    }));
  }

  if (errors.length) {
    const error = new Error(errors[0]);
    error.code = 'candidate_payment_validation_failed';
    error.details = errors;
    throw error;
  }

  return {
    accountCurrency,
    paymentMethod,
    accountHolderName,
    bankName,
    bankLocationOrCountry,
    accountType: accountType || null,
    sortCodeDigits,
    accountNumberDigits,
    iban,
    swiftBic,
  };
}

function buildPaymentWritePayload(candidateId, authUserId, input = {}, existing = {}) {
  const normalized = normalisePaymentInput(input, {
    allowBlankSensitive: true,
  });
  const now = new Date().toISOString();
  const preserveGbpValues = normalized.paymentMethod === PAYMENT_METHODS.gbp_local
    && !normalized.sortCodeDigits
    && !normalized.accountNumberDigits
    && trimString(existing.encrypted_sort_code, 4000)
    && trimString(existing.encrypted_account_number, 4000);
  const preserveIbanValues = normalized.paymentMethod === PAYMENT_METHODS.iban_swift
    && !normalized.iban
    && !normalized.swiftBic
    && trimString(existing.encrypted_iban, 4000)
    && trimString(existing.encrypted_swift_bic, 4000);
  return {
    id: existing.id || undefined,
    candidate_id: candidateId,
    auth_user_id: authUserId || existing.auth_user_id || null,
    account_currency: normalized.accountCurrency,
    payment_method: normalized.paymentMethod,
    account_holder_name: normalized.accountHolderName,
    bank_name: normalized.bankName,
    bank_location_or_country: normalized.bankLocationOrCountry,
    account_type: normalized.accountType,
    encrypted_sort_code: preserveGbpValues
      ? existing.encrypted_sort_code
      : (normalized.sortCodeDigits ? encryptValue(normalized.sortCodeDigits) : null),
    encrypted_account_number: preserveGbpValues
      ? existing.encrypted_account_number
      : (normalized.accountNumberDigits ? encryptValue(normalized.accountNumberDigits) : null),
    encrypted_iban: preserveIbanValues
      ? existing.encrypted_iban
      : (normalized.iban ? encryptValue(normalized.iban) : null),
    encrypted_swift_bic: preserveIbanValues
      ? existing.encrypted_swift_bic
      : (normalized.swiftBic ? encryptValue(normalized.swiftBic) : null),
    sort_code_masked: preserveGbpValues
      ? existing.sort_code_masked
      : (normalized.sortCodeDigits ? maskSortCode(normalized.sortCodeDigits) : null),
    account_number_masked: preserveGbpValues
      ? existing.account_number_masked
      : (normalized.accountNumberDigits ? maskValue(normalized.accountNumberDigits, 4) : null),
    iban_masked: preserveIbanValues
      ? existing.iban_masked
      : (normalized.iban ? maskIban(normalized.iban) : null),
    swift_bic_masked: preserveIbanValues
      ? existing.swift_bic_masked
      : (normalized.swiftBic ? maskValue(normalized.swiftBic, 4) : null),
    last_four: normalized.paymentMethod === PAYMENT_METHODS.gbp_local
      ? (preserveGbpValues ? trimString(existing.last_four, 8) : normalized.accountNumberDigits.slice(-4))
      : (preserveIbanValues ? trimString(existing.last_four, 8) : normalized.iban.slice(-4)),
    is_complete: true,
    updated_at: now,
    created_at: existing.created_at || now,
  };
}

function presentCandidatePaymentDetails(row = {}, options = {}) {
  const includeSensitive = options.includeSensitive === true;
  const result = {
    id: trimString(row.id, 120) || null,
    candidateId: trimString(row.candidate_id, 120) || null,
    accountCurrency: upperText(row.account_currency, 12) || 'GBP',
    paymentMethod: normalisePaymentMethod(row.payment_method, row.account_currency),
    accountHolderName: trimString(row.account_holder_name, 160) || '',
    bankName: trimString(row.bank_name, 160) || '',
    bankLocationOrCountry: trimString(row.bank_location_or_country, 160) || '',
    accountType: trimString(row.account_type, 80) || '',
    masked: {
      sortCode: trimString(row.sort_code_masked, 32) || '',
      accountNumber: trimString(row.account_number_masked, 32) || '',
      iban: trimString(row.iban_masked, 64) || '',
      swiftBic: trimString(row.swift_bic_masked, 32) || '',
    },
    lastFour: trimString(row.last_four, 8) || '',
    verifiedAt: row.verified_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    completion: {
      complete: row.is_complete === true,
      missing: row.is_complete === true ? [] : ['payment_details'],
    },
  };

  if (includeSensitive) {
    result.values = {
      sortCode: row.encrypted_sort_code ? decryptValue(row.encrypted_sort_code) : '',
      accountNumber: row.encrypted_account_number ? decryptValue(row.encrypted_account_number) : '',
      iban: row.encrypted_iban ? decryptValue(row.encrypted_iban) : '',
      swiftBic: row.encrypted_swift_bic ? decryptValue(row.encrypted_swift_bic) : '',
    };
  }

  return result;
}

function paymentDetailsSummary(row = {}, legacyCandidate = {}) {
  if (row && (row.id || row.candidate_id)) {
    return presentCandidatePaymentDetails(row, { includeSensitive: false });
  }
  const legacyBankName = trimString(legacyCandidate.bank_name, 160);
  const legacyAccountNumber = digitsOnly(legacyCandidate.bank_account, 32);
  const legacyIban = upperText(legacyCandidate.bank_iban, 64).replace(/\s+/g, '');
  const complete = !!(legacyBankName && (legacyAccountNumber || legacyIban));
  return {
    id: null,
    candidateId: trimString(legacyCandidate.id, 120) || null,
    accountCurrency: legacyIban ? 'EUR' : 'GBP',
    paymentMethod: legacyIban ? PAYMENT_METHODS.iban_swift : PAYMENT_METHODS.gbp_local,
    accountHolderName: '',
    bankName: legacyBankName || '',
    bankLocationOrCountry: '',
    accountType: '',
    masked: {
      sortCode: legacyCandidate.bank_sort_code ? maskSortCode(legacyCandidate.bank_sort_code) : '',
      accountNumber: legacyAccountNumber ? maskValue(legacyAccountNumber, 4) : '',
      iban: legacyIban ? maskIban(legacyIban) : '',
      swiftBic: legacyCandidate.bank_swift ? maskValue(legacyCandidate.bank_swift, 4) : '',
    },
    lastFour: legacyAccountNumber ? legacyAccountNumber.slice(-4) : (legacyIban ? legacyIban.slice(-4) : ''),
    verifiedAt: null,
    updatedAt: legacyCandidate.updated_at || legacyCandidate.created_at || null,
    completion: {
      complete,
      missing: complete ? [] : ['payment_details'],
    },
    legacyFallback: complete,
  };
}

module.exports = {
  PAYMENT_METHODS,
  buildPaymentWritePayload,
  decryptValue,
  encryptValue,
  maskIban,
  maskSortCode,
  maskValue,
  normaliseCurrency,
  normalisePaymentInput,
  normalisePaymentMethod,
  paymentDetailsSummary,
  presentCandidatePaymentDetails,
  trimString,
};
