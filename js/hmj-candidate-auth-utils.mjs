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

export function classifyCandidateSignupResult(result = {}) {
  const user = result?.user || null;
  const session = result?.session || null;
  const identities = Array.isArray(user?.identities) ? user.identities : null;

  if (user && !session && Array.isArray(identities) && identities.length === 0) {
    return {
      state: 'existing',
      verificationEmailExpected: false,
    };
  }

  if (user) {
    return {
      state: 'created',
      verificationEmailExpected: !session,
    };
  }

  return {
    state: 'failed',
    verificationEmailExpected: false,
  };
}
