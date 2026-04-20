export function validateCandidatePassword({
  accountEnabled = true,
  password = '',
  confirmPassword = '',
} = {}) {
  if (!accountEnabled) {
    return {
      active: false,
      valid: true,
      tone: 'success',
      text: 'Account creation is off. Your profile will still be sent to HMJ.',
    };
  }

  const cleanPassword = String(password || '');
  const cleanConfirmPassword = String(confirmPassword || '');
  const hasLength = cleanPassword.length >= 8;
  const hasLetter = /[A-Za-z]/.test(cleanPassword);
  const hasNumber = /\d/.test(cleanPassword);
  const matches = !!cleanPassword && cleanPassword === cleanConfirmPassword;

  if (!cleanPassword && !cleanConfirmPassword) {
    return {
      active: true,
      valid: false,
      tone: 'warn',
      text: 'Create a password and confirm it to set up your candidate account.',
    };
  }

  if (!hasLength || !hasLetter || !hasNumber) {
    return {
      active: true,
      valid: false,
      tone: 'warn',
      text: 'Use at least 8 characters, including at least one letter and one number.',
    };
  }

  if (!matches) {
    return {
      active: true,
      valid: false,
      tone: 'error',
      text: 'The password fields do not match yet.',
    };
  }

  return {
    active: true,
    valid: true,
    tone: 'success',
    text: 'Password confirmed. Your account can be created when you submit the form.',
  };
}

function trimText(value, maxLength = 160) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function digitsOnly(value, maxLength = 32) {
  return trimText(value, maxLength).replace(/\D+/g, '');
}

export function normaliseCandidateRegistrationPaymentMethod({
  accountCurrency = 'GBP',
  paymentMethod = '',
} = {}) {
  const currency = trimText(accountCurrency, 12).toUpperCase() || 'GBP';
  const raw = trimText(paymentMethod, 40).toLowerCase();
  if (raw === 'gbp_local' || raw === 'iban_swift') {
    return raw;
  }
  return currency === 'GBP' ? 'gbp_local' : 'iban_swift';
}

export function validateCandidateRegistrationPayment({
  active = false,
  accountCurrency = 'GBP',
  paymentMethod = '',
  accountHolderName = '',
  bankName = '',
  bankLocationOrCountry = '',
  sortCode = '',
  accountNumber = '',
  iban = '',
  swiftBic = '',
} = {}) {
  const normalisedPaymentMethod = normaliseCandidateRegistrationPaymentMethod({
    accountCurrency,
    paymentMethod,
  });

  if (!active) {
    return {
      active: false,
      valid: true,
      tone: 'info',
      text: '',
      paymentMethod: normalisedPaymentMethod,
      focusKey: '',
    };
  }

  let focusKey = '';
  const errors = [];
  const flag = (key, condition, message) => {
    if (condition) return;
    errors.push(message);
    if (!focusKey) {
      focusKey = key;
    }
  };

  flag('accountHolderName', trimText(accountHolderName, 160), 'Enter the account holder name before you submit onboarding.');
  flag('bankName', trimText(bankName, 160), 'Enter the bank name before you submit onboarding.');
  flag('bankLocationOrCountry', trimText(bankLocationOrCountry, 160), 'Enter the bank location or country before you submit onboarding.');

  if (normalisedPaymentMethod === 'gbp_local') {
    flag('sortCode', digitsOnly(sortCode, 16).length === 6, 'Enter a valid 6-digit sort code.');
    const accountNumberDigits = digitsOnly(accountNumber, 16);
    flag('accountNumber', accountNumberDigits.length >= 6 && accountNumberDigits.length <= 10, 'Enter a valid account number.');
  } else {
    const cleanIban = trimText(iban, 64).toUpperCase().replace(/\s+/g, '');
    const cleanSwiftBic = trimText(swiftBic, 32).toUpperCase().replace(/\s+/g, '');
    flag('iban', /^[A-Z]{2}[A-Z0-9]{13,32}$/.test(cleanIban), 'Enter a valid IBAN.');
    flag('swiftBic', /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(cleanSwiftBic), 'Enter a valid SWIFT / BIC code.');
  }

  if (errors.length) {
    return {
      active: true,
      valid: false,
      tone: 'error',
      text: errors[0],
      paymentMethod: normalisedPaymentMethod,
      focusKey,
    };
  }

  return {
    active: true,
    valid: true,
    tone: 'success',
    text: 'Secure payment details are ready for encrypted HMJ payroll storage.',
    paymentMethod: normalisedPaymentMethod,
    focusKey: '',
  };
}

export function classifyCandidateSignupResult(result = {}) {
  const user = result?.user || null;
  const session = result?.session || null;
  const identities = Array.isArray(user?.identities) ? user.identities : null;

  if (user && !session && Array.isArray(identities) && identities.length === 0) {
    return {
      state: 'existing',
      verificationEmailExpected: false,
      autoSignedIn: false,
    };
  }

  if (user) {
    return {
      state: 'created',
      verificationEmailExpected: !session,
      autoSignedIn: !!session,
    };
  }

  return {
    state: 'failed',
    verificationEmailExpected: false,
    autoSignedIn: false,
  };
}
