import {
  backgroundSyncCandidatePayload,
  candidateDocumentIsPortalOwned,
  closeCandidateAccount,
  deleteCandidateDocument,
  escapeHtml,
  getCandidatePortalContext,
  loadCandidateApplications,
  loadCandidateDocuments,
  loadCandidatePaymentDetails,
  loadCandidateProfile,
  normaliseSkillList,
  onCandidateAuthStateChange,
  requestCandidatePasswordReset,
  resendCandidateVerification,
  saveCandidateProfile,
  signInCandidate,
  signOutCandidate,
  signUpCandidate,
  trimText,
  updateCandidateEmail,
  updateCandidatePassword,
  saveCandidatePaymentDetails,
  uploadCandidateDocument,
} from '../../js/hmj-candidate-portal.js?v=5';
import {
  classifyCandidateSignupResult,
  validateCandidatePassword,
} from '../../js/hmj-candidate-auth-utils.mjs?v=1';

(function () {
  const doc = document;
  const authRoot = doc.getElementById('candidatePortalAuthRoot');
  const authSection = doc.getElementById('candidatePortalAuthSection');
  const applicationView = doc.getElementById('candidateApplicationView');
  const dashboardRoot = doc.getElementById('candidateDashboardRoot');
  const form = doc.getElementById('candForm');
  const formStatusRoot = doc.getElementById('candidateFormStatusRoot');
  const accountToggle = doc.getElementById('candidateCreateAccount');
  const accountRequestedInput = doc.getElementById('candidateAccountRequested');
  const accountModeText = doc.getElementById('candidateAccountModeText');
  const passwordFields = doc.getElementById('candidatePasswordFields');
  const passwordInput = doc.getElementById('candidatePassword');
  const confirmPasswordInput = doc.getElementById('candidateConfirmPassword');
  const passwordStatus = doc.getElementById('candidatePasswordStatus');
  const submitButton = doc.getElementById('submitBtn');
  const paymentGate = doc.getElementById('candidatePaymentGate');
  const paymentToggle = doc.getElementById('candidatePaymentOptIn');
  const paymentPanel = doc.getElementById('candidatePaymentPanel');
  const paymentSummary = doc.getElementById('candidatePaymentGateSummary');
  const paymentStatus = doc.getElementById('candidatePaymentStatus');
  const paymentFields = {
    currency: doc.getElementById('candidatePaymentCurrency'),
    method: doc.getElementById('candidatePaymentMethod'),
    accountHolderName: doc.getElementById('candidatePaymentAccountHolder'),
    bankName: doc.getElementById('candidatePaymentBankName'),
    bankLocationOrCountry: doc.getElementById('candidatePaymentBankLocation'),
    accountType: doc.getElementById('candidatePaymentAccountType'),
    sortCode: doc.getElementById('candidatePaymentSortCode'),
    accountNumber: doc.getElementById('candidatePaymentAccountNumber'),
    iban: doc.getElementById('candidatePaymentIban'),
    swiftBic: doc.getElementById('candidatePaymentSwift'),
  };
  const paymentInputs = Array.from(form.querySelectorAll('[data-payment-input]'));

  if (!authRoot || !applicationView || !dashboardRoot || !form || !formStatusRoot || !accountToggle || !accountRequestedInput || !passwordFields || !passwordInput || !confirmPasswordInput || !passwordStatus || !submitButton) return;

  function readAuthParams() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    return {
      get(key) {
        return search.get(key) ?? hash.get(key);
      },
      has(key) {
        return search.has(key) || hash.has(key);
      },
    };
  }

  function normaliseRequestedDocumentType(value) {
    const raw = trimText(value, 80).toLowerCase();
    if (!raw) return '';
    if (raw === 'right_to_work' || raw === 'right to work' || raw === 'rtw') return 'right_to_work';
    if (raw === 'qualification_certificate' || raw === 'qualification / certificate' || raw === 'certificate') return 'qualification_certificate';
    if (raw === 'visa_permit' || raw === 'visa / permit' || raw === 'visa' || raw === 'permit') return 'visa_permit';
    if (raw === 'bank_document' || raw === 'bank document') return 'bank_document';
    if (raw === 'reference' || raw === 'references') return 'reference';
    if (raw === 'passport') return 'passport';
    if (raw === 'cv') return 'cv';
    return '';
  }

  function parseRequestedDocumentList(value) {
    return String(value || '')
      .split(/[\n,]/)
      .map((entry) => normaliseRequestedDocumentType(entry))
      .filter((entry, index, list) => entry && list.indexOf(entry) === index);
  }

  function requestedDocumentLabel(value) {
    if (value === 'right_to_work') return 'right to work';
    if (value === 'qualification_certificate') return 'qualification / certificate';
    if (value === 'visa_permit') return 'visa / permit';
    if (value === 'bank_document') return 'bank document';
    if (value === 'reference') return 'reference';
    if (value === 'passport') return 'passport';
    return 'document';
  }

  function requestedDocumentListText(list) {
    const labels = (Array.isArray(list) ? list : []).map((item) => requestedDocumentLabel(item));
    if (!labels.length) return '';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels.slice(-1)}`;
  }

  function normaliseSalaryExpectationUnit(value) {
    const raw = trimText(value, 40).toLowerCase();
    if (!raw) return 'annual';
    if (raw === 'hour' || raw === 'hourly' || raw === 'per_hour') return 'hourly';
    if (raw === 'day' || raw === 'daily' || raw === 'per_day') return 'daily';
    if (raw === 'year' || raw === 'annual_salary' || raw === 'per_year') return 'annual';
    return ['annual', 'daily', 'hourly'].includes(raw) ? raw : 'annual';
  }

  function salaryExpectationSuffix(unit) {
    if (unit === 'hourly') return 'per hour';
    if (unit === 'daily') return 'per day';
    return 'per year';
  }

  function formatSalaryExpectation(value, unit) {
    const raw = trimText(value, 80);
    if (!raw) return '';
    const normalisedUnit = normaliseSalaryExpectationUnit(unit);
    if (/per\s+(hour|day|year)/i.test(raw)) return raw;
    const numeric = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(numeric)) {
      return `${raw} ${salaryExpectationSuffix(normalisedUnit)}`.trim();
    }
    const maxFractionDigits = normalisedUnit === 'annual' || Number.isInteger(numeric) ? 0 : 2;
    const formatted = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    }).format(numeric);
    return `${formatted} ${salaryExpectationSuffix(normalisedUnit)}`;
  }

  function digitsOnly(value, maxLength = 32) {
    return trimText(value, maxLength).replace(/\D+/g, '');
  }

  function normaliseRegistrationPaymentMethod(currency, method) {
    const raw = trimText(method, 40).toLowerCase();
    if (raw === 'gbp_local' || raw === 'iban_swift') return raw;
    return trimText(currency, 12).toUpperCase() === 'GBP' ? 'gbp_local' : 'iban_swift';
  }

  function registrationPaymentEnabled() {
    return !!(paymentToggle && paymentToggle.checked);
  }

  function paymentStatusMessage(tone, text) {
    if (!paymentStatus) return;
    paymentStatus.dataset.tone = tone;
    paymentStatus.textContent = text;
  }

  function paymentValidationState() {
    if (!paymentToggle || !paymentPanel) {
      return { active: false, valid: true, tone: 'info', text: '' };
    }

    if (!registrationPaymentEnabled()) {
      return {
        active: false,
        valid: true,
        tone: 'info',
        text: 'Optional secure payroll setup. Open this only if HMJ has already confirmed a new assignment and needs your bank details for onboarding.',
      };
    }

    const accountCurrency = trimText(paymentFields.currency?.value, 12).toUpperCase() || 'GBP';
    const paymentMethod = normaliseRegistrationPaymentMethod(accountCurrency, paymentFields.method?.value);
    const errors = [];
    const firstMissingField = (field) => field instanceof HTMLElement ? field : null;
    let focusField = null;

    function flag(field, test, message) {
      if (test) return;
      errors.push(message);
      if (!focusField) focusField = firstMissingField(field);
    }

    flag(paymentFields.accountHolderName, trimText(paymentFields.accountHolderName?.value, 160), 'Enter the account holder name before you submit.');
    flag(paymentFields.bankName, trimText(paymentFields.bankName?.value, 160), 'Enter the bank name before you submit.');
    flag(paymentFields.bankLocationOrCountry, trimText(paymentFields.bankLocationOrCountry?.value, 160), 'Enter the bank location or country before you submit.');

    if (paymentMethod === 'gbp_local') {
      flag(paymentFields.sortCode, digitsOnly(paymentFields.sortCode?.value, 16).length === 6, 'Enter a valid 6-digit sort code.');
      const accountNumberDigits = digitsOnly(paymentFields.accountNumber?.value, 16);
      flag(paymentFields.accountNumber, accountNumberDigits.length >= 6 && accountNumberDigits.length <= 10, 'Enter a valid account number.');
    } else {
      const iban = trimText(paymentFields.iban?.value, 64).toUpperCase().replace(/\s+/g, '');
      const swiftBic = trimText(paymentFields.swiftBic?.value, 32).toUpperCase().replace(/\s+/g, '');
      flag(paymentFields.iban, /^[A-Z]{2}[A-Z0-9]{13,32}$/.test(iban), 'Enter a valid IBAN.');
      flag(paymentFields.swiftBic, /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swiftBic), 'Enter a valid SWIFT / BIC code.');
    }

    if (errors.length) {
      return {
        active: true,
        valid: false,
        tone: 'error',
        text: errors[0],
        focusField,
      };
    }

    return {
      active: true,
      valid: true,
      tone: 'success',
      text: 'Secure payment details will be sent separately for onboarding and payroll setup.',
      focusField: null,
    };
  }

  function buildRegistrationPaymentDetails() {
    if (!registrationPaymentEnabled()) return null;
    const accountCurrency = trimText(paymentFields.currency?.value, 12).toUpperCase() || 'GBP';
    const paymentMethod = normaliseRegistrationPaymentMethod(accountCurrency, paymentFields.method?.value);
    return {
      account_currency: accountCurrency,
      payment_method: paymentMethod,
      account_holder_name: trimText(paymentFields.accountHolderName?.value, 160),
      bank_name: trimText(paymentFields.bankName?.value, 160),
      bank_location_or_country: trimText(paymentFields.bankLocationOrCountry?.value, 160),
      account_type: trimText(paymentFields.accountType?.value, 80),
      sort_code: trimText(paymentFields.sortCode?.value, 32),
      account_number: trimText(paymentFields.accountNumber?.value, 32),
      iban: trimText(paymentFields.iban?.value, 64).toUpperCase(),
      swift_bic: trimText(paymentFields.swiftBic?.value, 32).toUpperCase(),
    };
  }

  function syncPaymentGateControls() {
    if (!paymentToggle || !paymentPanel || !paymentGate) return;

    const enabled = registrationPaymentEnabled();
    const accountCurrency = trimText(paymentFields.currency?.value, 12).toUpperCase() || 'GBP';
    const paymentMethod = normaliseRegistrationPaymentMethod(accountCurrency, paymentFields.method?.value);

    if (paymentFields.currency && paymentFields.currency.value !== accountCurrency) {
      paymentFields.currency.value = accountCurrency;
    }
    if (paymentFields.method && paymentFields.method.value !== paymentMethod) {
      paymentFields.method.value = paymentMethod;
    }

    paymentGate.dataset.open = enabled ? 'true' : 'false';
    paymentPanel.dataset.open = enabled ? 'true' : 'false';
    paymentPanel.dataset.method = paymentMethod;
    paymentPanel.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    paymentToggle.setAttribute('aria-expanded', enabled ? 'true' : 'false');

    paymentInputs.forEach((input) => {
      input.disabled = !enabled;
    });

    if (paymentSummary) {
      paymentSummary.textContent = enabled
        ? (paymentMethod === 'gbp_local'
          ? 'Secure GBP bank details are open. HMJ will store them separately from your profile.'
          : 'Secure international bank details are open. HMJ will store them separately from your profile.')
        : 'Optional secure payroll setup for workers who are already starting an assignment.';
    }

    const validation = paymentValidationState();
    if (validation.text) {
      paymentStatusMessage(validation.tone, validation.text);
    } else if (paymentStatus) {
      paymentStatus.dataset.tone = 'info';
      paymentStatus.textContent = '';
    }
  }

  function remainingRequestedDocuments(documents, requestedDocuments) {
    const uploaded = new Set((Array.isArray(documents) ? documents : [])
      .map((row) => normaliseRequestedDocumentType(row?.document_type || row?.label || ''))
      .filter(Boolean));
    return (Array.isArray(requestedDocuments) ? requestedDocuments : [])
      .filter((type) => type && !uploaded.has(type));
  }

  function isLocalCandidateMockMode() {
    const search = new URLSearchParams(window.location.search);
    const host = String(window.location.hostname || '').toLowerCase();
    return search.get('candidate_mock') === '1' && (host === 'localhost' || host === '127.0.0.1');
  }

  function authMessageFromParams(params) {
    if (params.get('candidate_auth') === 'verified') {
      return {
        tone: 'success',
        text: 'Your email has been verified. You can now sign in to your candidate dashboard.',
      };
    }

    const errorCode = trimText(params.get('error_code'), 120).toLowerCase();
    const errorDescription = trimText(
      String(params.get('error_description') || params.get('error') || '').replace(/\+/g, ' '),
      400
    );

    if (!errorCode && !errorDescription) {
      return null;
    }

    if (errorCode === 'otp_expired' || /invalid|expired/i.test(errorDescription)) {
      return {
        tone: 'warn',
        text: 'That email link is no longer valid. Use the newest email only. If you already confirmed the account, sign in below. Otherwise create the account again and we will send a fresh email.',
      };
    }

    return {
      tone: 'error',
      text: errorDescription || 'Candidate authentication could not be completed. Please try again.',
    };
  }

  function submissionMessageFromParams(params) {
    if (params.get('submitted') !== '1') {
      return null;
    }

    const accountState = trimText(params.get('candidate_account'), 80).toLowerCase();
    if (accountState === 'created') {
      return {
        tone: 'success',
        text: 'Your profile has been sent to HMJ and your candidate account is nearly ready. Check your inbox and junk folder for the verification email, then sign in above once it is confirmed.',
        showResend: true,
      };
    }

    if (accountState === 'existing') {
      return {
        tone: 'warn',
        text: 'Your profile has been sent to HMJ. That email already has an HMJ candidate account, so please sign in above or reset your password to access it.',
        showResend: false,
      };
    }

    if (accountState === 'failed') {
      return {
        tone: 'warn',
        text: 'Your profile has still been sent to HMJ, but we could not create the candidate account on this attempt. You can submit again later with the account box ticked, or contact HMJ if the issue continues.',
        showResend: false,
      };
    }

    return {
      tone: 'success',
      text: 'Your profile has been sent to HMJ. We will review it and come back to you with suitable opportunities.',
      showResend: false,
    };
  }

  function sessionStorageAvailable() {
    try {
      const key = '__hmj_candidate_portal__';
      window.sessionStorage.setItem(key, '1');
      window.sessionStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  const canUseSessionStorage = sessionStorageAvailable();

  function setPendingCandidateEmail(email) {
    if (!canUseSessionStorage) return;
    const clean = trimText(email, 320).toLowerCase();
    if (!clean) return;
    window.sessionStorage.setItem('hmj.candidate.pending_email', clean);
  }

  function getPendingCandidateEmail() {
    if (!canUseSessionStorage) return '';
    return trimText(window.sessionStorage.getItem('hmj.candidate.pending_email'), 320).toLowerCase();
  }

  function clearPendingCandidateEmail() {
    if (!canUseSessionStorage) return;
    window.sessionStorage.removeItem('hmj.candidate.pending_email');
  }

  const params = readAuthParams();
  const DASHBOARD_TABS = ['profile', 'applications', 'documents', 'payment', 'settings'];
  const RECRUITMENT_PROFILE_TABS = DASHBOARD_TABS.filter((tab) => tab !== 'payment');
  const state = {
    hydrating: true,
    authAvailable: true,
    authMode: params.get('candidate_action') === 'recovery' ? 'recovery' : 'signin',
    authMessage: authMessageFromParams(params),
    formMessage: submissionMessageFromParams(params),
    authBusy: false,
    formBusy: false,
    dashboardBusy: false,
    settingsBusy: false,
    documentsBusy: false,
    paymentBusy: false,
    activeTab: DASHBOARD_TABS.includes(trimText(params.get('candidate_tab'), 40).toLowerCase())
      ? trimText(params.get('candidate_tab'), 40).toLowerCase()
      : 'profile',
    requestedFocus: trimText(params.get('candidate_focus'), 80).toLowerCase(),
    requestedDocuments: parseRequestedDocumentList(params.get('candidate_docs')),
    onboardingPrompt: params.get('candidate_onboarding') === '1',
    draftOnboardingMode: null,
    user: null,
    session: null,
    candidate: null,
    applications: [],
    documents: [],
    paymentDetails: null,
    dashboardError: '',
    unsubscribe: null,
    closeConfirm: false,
    formSyncSent: false,
    allowNativeSubmit: false,
    pendingEmail: getPendingCandidateEmail(),
  };

  const STATUS_COPY = {
    submitted: {
      label: 'Applied',
      tone: 'blue',
      detail: 'Your application has been received by HMJ.',
    },
    reviewing: {
      label: 'Under review',
      tone: 'blue',
      detail: 'A recruiter is checking your experience against the role.',
    },
    shortlisted: {
      label: 'Shortlisted',
      tone: 'green',
      detail: 'You are moving forward on this role.',
    },
    interviewing: {
      label: 'Interview stage',
      tone: 'green',
      detail: 'Interview scheduling or interview feedback is in progress.',
    },
    on_hold: {
      label: 'On hold',
      tone: 'slate',
      detail: 'The role is paused for the moment.',
    },
    rejected: {
      label: 'Not taken forward',
      tone: 'red',
      detail: 'You are not moving forward on this role.',
    },
    offered: {
      label: 'Offer stage',
      tone: 'green',
      detail: 'Offer discussions are underway.',
    },
    hired: {
      label: 'Placed',
      tone: 'green',
      detail: 'You have been placed on this role.',
    },
  };

  function authErrorMessage(mode, error) {
    const text = trimText(error?.message || 'Candidate authentication failed.', 400);
    const lower = text.toLowerCase();
    if (lower.includes('email not confirmed')) {
      return 'Your email is not confirmed yet. Check your inbox or use "Resend verification email" below.';
    }
    if (lower.includes('invalid login credentials')) {
      return 'Those sign-in details did not match our records. Please check your email and password and try again.';
    }
    if (lower.includes('user already registered')) {
      return 'That email already has a candidate account. Sign in below or reset the password if needed.';
    }
    if (lower.includes('too many requests')) {
      return 'Too many attempts were made just now. Please wait a moment and try again.';
    }
    if (mode === 'signup' && lower.includes('redirect')) {
      return 'The account was created, but the email link settings need attention. Please contact HMJ support before trying again.';
    }
    return text;
  }

  function formatDate(value) {
    if (!value) return 'Awaiting update';
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (error) {
      return value;
    }
  }

  function statusTone(status) {
    const key = String(status || '').toLowerCase();
    if (key === 'submitted' || key === 'reviewing') return 'blue';
    if (key === 'shortlisted' || key === 'interviewing' || key === 'offered' || key === 'hired' || key === 'placed') return 'green';
    if (key === 'rejected') return 'red';
    return 'slate';
  }

  function statusCopy(status) {
    const key = String(status || '').toLowerCase();
    return STATUS_COPY[key] || {
      label: key ? key.replace(/_/g, ' ') : 'Pending',
      tone: statusTone(status),
      detail: 'HMJ will update this when the next step is confirmed.',
    };
  }

  function candidateName() {
    return trimText(state.candidate?.full_name, 240)
      || [state.candidate?.first_name, state.candidate?.last_name].filter(Boolean).join(' ')
      || trimText(state.user?.user_metadata?.full_name, 240)
      || trimText(state.user?.email, 240)
      || 'Candidate';
  }

  function firstName() {
    return trimText(state.candidate?.first_name, 120)
      || trimText(candidateName().split(/\s+/)[0], 120)
      || 'there';
  }

  function profileCompletion(candidate) {
    const checks = [
      trimText(candidate?.full_name || `${candidate?.first_name || ''} ${candidate?.last_name || ''}`.trim(), 240),
      trimText(candidate?.phone, 80),
      trimText(candidate?.address1, 240),
      trimText(candidate?.town, 160),
      trimText(candidate?.country, 120),
      trimText(candidate?.location, 240),
      trimText(candidate?.primary_specialism || candidate?.sector_focus, 240),
      trimText(candidate?.current_job_title, 240),
      trimText(candidate?.desired_roles || candidate?.headline_role, 320),
      candidate?.experience_years != null ? String(candidate.experience_years) : '',
      trimText(candidate?.qualifications, 4000),
      Array.isArray(candidate?.skills) && candidate.skills.length ? 'skills' : '',
      trimText(candidate?.availability, 160),
      trimText(candidate?.linkedin_url, 500),
      trimText(candidate?.summary, 4000),
    ];
    const completed = checks.filter(Boolean).length;
    const total = checks.length;
    return {
      completed,
      total,
      percent: Math.round((completed / total) * 100),
    };
  }

  function normaliseBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined || value === '') return false;
    const text = trimText(value, 16).toLowerCase();
    return text === 'true' || text === '1' || text === 'yes' || text === 'on';
  }

  function storedOnboardingMode(candidate = state.candidate) {
    return normaliseBooleanFlag(candidate?.onboarding_mode ?? candidate?.onboardingMode);
  }

  function candidateOnboardingMode(candidate = state.candidate) {
    if (typeof state.draftOnboardingMode === 'boolean') {
      return state.draftOnboardingMode;
    }
    return storedOnboardingMode(candidate) || state.onboardingPrompt || state.requestedDocuments.length > 0;
  }

  function dashboardTabsForCandidate(candidate = state.candidate) {
    return candidateOnboardingMode(candidate) ? DASHBOARD_TABS : RECRUITMENT_PROFILE_TABS;
  }

  function resolveDashboardTab(candidate = state.candidate, requested = state.activeTab) {
    const tabs = dashboardTabsForCandidate(candidate);
    return tabs.includes(requested) ? requested : 'profile';
  }

  function dashboardTabLabel(tab) {
    if (tab === 'payment') return 'Payroll details';
    return tab.charAt(0).toUpperCase() + tab.slice(1);
  }

  function candidateModeLabel(candidate = state.candidate) {
    return candidateOnboardingMode(candidate) ? 'Live assignment onboarding' : 'Recruitment profile';
  }

  function candidateModeDescription(candidate = state.candidate) {
    return candidateOnboardingMode(candidate)
      ? 'You are completing onboarding for a live HMJ placement. Provide your right-to-work, address, payroll, and emergency contact details so HMJ can prepare mobilisation and timesheet/payroll setup.'
      : 'You can use your HMJ profile to apply for jobs and keep your CV and preferences up to date. Bank details and onboarding documents are only needed if you move forward with a live assignment.';
  }

  function emergencyContactComplete(candidate = state.candidate) {
    return !!trimText(candidate?.emergency_name, 240) && !!trimText(candidate?.emergency_phone, 80);
  }

  function onboardingAddressComplete(candidate = state.candidate) {
    return !!trimText(candidate?.address1, 240)
      && !!trimText(candidate?.town, 160)
      && !!trimText(candidate?.postcode, 32)
      && !!trimText(candidate?.country, 120);
  }

  function onboardingChecklist(onboarding = onboardingSummary(), candidate = state.candidate) {
    return [
      {
        label: 'Profile details completed',
        complete: onboardingAddressComplete(candidate),
      },
      {
        label: 'CV uploaded',
        complete: (state.documents || []).some((documentRow) => String(documentRow?.document_type || '').toLowerCase() === 'cv'),
      },
      {
        label: 'Right to work uploaded',
        complete: onboarding.hasRightToWork || onboarding.hasRightToWorkUpload,
      },
      {
        label: 'Address completed',
        complete: onboardingAddressComplete(candidate),
      },
      {
        label: 'Payroll details completed',
        complete: onboarding.hasPayment,
      },
      {
        label: 'Emergency contact added',
        complete: emergencyContactComplete(candidate),
      },
      {
        label: 'Ready for Timesheet Portal',
        complete: onboarding.complete && emergencyContactComplete(candidate) && onboardingAddressComplete(candidate),
      },
    ];
  }

  function onboardingSummary() {
    const onboardingRequired = candidateOnboardingMode();
    const documentTypes = new Set((state.documents || []).map((documentRow) => String(documentRow.document_type || '').toLowerCase()));
    const hasRightToWork = documentTypes.has('right_to_work')
      || documentTypes.has('passport')
      || documentTypes.has('visa_permit')
      || !!trimText(state.candidate?.rtw_url, 2000);
    const hasPayment = state.paymentDetails?.completion?.complete === true;
    const missing = [];
    if (onboardingRequired && !hasRightToWork) missing.push('right_to_work');
    if (onboardingRequired && !hasPayment) missing.push('payment_details');
    return {
      onboardingRequired,
      onboardingMode: onboardingRequired,
      hasRightToWork,
      hasPayment,
      complete: onboardingRequired ? missing.length === 0 : false,
      missing,
    };
  }

  function updateDashboardLocation(tab, focus = state.requestedFocus) {
    if (!window.history?.replaceState) return;
    try {
      const url = new URL(window.location.href);
      if (tab) {
        url.searchParams.set('candidate_tab', tab);
      } else {
        url.searchParams.delete('candidate_tab');
      }
      if (focus) {
        url.searchParams.set('candidate_focus', focus);
      } else {
        url.searchParams.delete('candidate_focus');
      }
      if (state.onboardingPrompt) {
        url.searchParams.set('candidate_onboarding', '1');
      } else {
        url.searchParams.delete('candidate_onboarding');
      }
      if (state.requestedDocuments.length) {
        url.searchParams.set('candidate_docs', state.requestedDocuments.join(','));
      } else {
        url.searchParams.delete('candidate_docs');
      }
      window.history.replaceState({}, '', url.toString());
    } catch (error) {
      // Ignore URL sync issues.
    }
  }

  function renderDashboardSkeleton() {
    dashboardRoot.innerHTML = `
      <section class="candidate-dashboard-shell candidate-dashboard-shell--loading" aria-live="polite">
        <div class="candidate-dashboard-skeleton candidate-dashboard-skeleton--hero"></div>
        <div class="candidate-dashboard-skeleton-grid">
          <div class="candidate-dashboard-skeleton candidate-dashboard-skeleton--nav"></div>
          <div class="candidate-dashboard-skeleton candidate-dashboard-skeleton--panel"></div>
        </div>
      </section>
    `;
    setPageMode('dashboard');
  }

  function setPageMode(mode) {
    const showDashboard = mode === 'dashboard';
    const showForm = mode === 'form';
    authSection.hidden = showDashboard;
    applicationView.hidden = !showForm;
    dashboardRoot.hidden = !showDashboard;
  }

  function renderAuthLoading() {
    authRoot.innerHTML = `
      <div class="candidate-portal-shell">
        <article class="candidate-portal-card candidate-portal-card--muted candidate-portal-card--loading">
          <span class="candidate-portal-eyebrow">Candidate account</span>
          <h2>Checking your candidate account…</h2>
          <p>We are loading the right experience for you now.</p>
        </article>
        <aside class="candidate-portal-card candidate-portal-card--tint">
          <span class="candidate-portal-eyebrow">Candidate account</span>
          <ul class="candidate-portal-list">
            <li>Save your profile once for future HMJ roles</li>
            <li>Track applications in plain English</li>
            <li>Keep CVs and compliance documents in one secure place</li>
          </ul>
        </aside>
      </div>
    `;
    setPageMode('loading');
  }

  function renderFormStatus() {
    if (!state.formMessage) {
      formStatusRoot.hidden = true;
      formStatusRoot.innerHTML = '';
      return;
    }

    formStatusRoot.hidden = false;
    formStatusRoot.innerHTML = `
      <div class="candidate-portal-alert candidate-portal-alert--${escapeHtml(state.formMessage.tone)} candidate-form-status">
        <div class="candidate-form-status__body">
          <p>${escapeHtml(state.formMessage.text)}</p>
          ${state.formMessage.showResend ? '<button type="button" class="candidate-portal-btn candidate-portal-btn--ghost" data-auth-action="resend-verification-from-form">Resend verification email</button>' : ''}
        </div>
      </div>
    `;
  }

  function syncPrimarySubmitLabel() {
    const creatingAccount = accountToggle.checked && state.authAvailable;
    if (accountRequestedInput) {
      accountRequestedInput.value = creatingAccount ? 'yes' : 'no';
    }
    submitButton.textContent = state.formBusy
      ? (creatingAccount ? 'Creating account and sending profile…' : 'Sending profile…')
      : (creatingAccount ? 'Create account and send profile' : 'Send profile');
  }

  function passwordValidationState() {
    return validateCandidatePassword({
      accountEnabled: !!(accountToggle.checked && state.authAvailable),
      password: passwordInput.value || '',
      confirmPassword: confirmPasswordInput.value || '',
    });
  }

  function syncAccountControls() {
    if (!state.authAvailable) {
      accountToggle.checked = false;
      accountToggle.disabled = true;
      accountModeText.textContent = 'Candidate account tools are temporarily unavailable. You can still send your profile and CV to HMJ today.';
    } else {
      accountToggle.disabled = false;
      accountModeText.textContent = accountToggle.checked
        ? 'You will set a password now, receive a verification email after submit, and then sign in once you confirm it.'
        : 'Your details will still go to HMJ without creating a password or login.';
    }

    const accountEnabled = accountToggle.checked && state.authAvailable;
    passwordFields.hidden = !accountEnabled;
    passwordInput.disabled = !accountEnabled;
    confirmPasswordInput.disabled = !accountEnabled;

    const validation = passwordValidationState();
    syncPaymentGateControls();
    const paymentValidation = paymentValidationState();
    passwordStatus.textContent = validation.text;
    passwordStatus.dataset.tone = validation.tone;
    passwordStatus.className = `candidate-password-status is-${validation.tone}`;

    const shouldDisable = state.formBusy || (validation.active && !validation.valid) || (paymentValidation.active && !paymentValidation.valid);
    submitButton.disabled = shouldDisable;
    syncPrimarySubmitLabel();
  }

  function prefillSignInEmail() {
    const signInEmail = authRoot.querySelector('[data-auth-form="signin"] input[name="email"]');
    if (signInEmail && state.pendingEmail) {
      signInEmail.value = state.pendingEmail;
    }
    const resetEmail = authRoot.querySelector('[data-auth-form="reset"] input[name="email"]');
    if (resetEmail && state.pendingEmail) {
      resetEmail.value = state.pendingEmail;
    }
  }

  function renderAuth() {
    renderFormStatus();

    if (!state.authAvailable) {
      authRoot.innerHTML = `
        <div class="candidate-portal-card candidate-portal-card--muted">
          <span class="candidate-portal-eyebrow">Candidate account</span>
          <h2>Portal tools are temporarily unavailable.</h2>
          <p>You can still submit your profile below. The Netlify application workflow will continue as normal.</p>
        </div>
      `;
      setPageMode('form');
      syncAccountControls();
      return;
    }

    const mode = state.authMode;
    const message = state.authMessage
      ? `<div class="candidate-portal-alert candidate-portal-alert--${escapeHtml(state.authMessage.tone)}">${escapeHtml(state.authMessage.text)}</div>`
      : '';
    const isBusy = state.authBusy ? 'disabled' : '';
    const prefillEmail = escapeHtml(state.pendingEmail || '');

    authRoot.innerHTML = `
      <div class="candidate-portal-shell">
        <article class="candidate-portal-card candidate-portal-card--secondary">
          <span class="candidate-portal-eyebrow">Candidate account access</span>
          <h2>Sign in to your HMJ candidate account</h2>
          <p>Create an HMJ candidate account to save your profile, track applications, and upload documents.</p>
          ${message}
          <p class="candidate-portal-note candidate-portal-note--strong">New here? Use the form below as your main registration and profile form.</p>
          <div class="candidate-portal-panel ${mode === 'signin' ? 'is-active' : ''}" data-auth-panel="signin">
            <form class="candidate-portal-form" data-auth-form="signin">
              <label>Email
                <input type="email" name="email" autocomplete="email" required value="${prefillEmail}">
              </label>
              <label>Password
                <input type="password" name="password" autocomplete="current-password" required minlength="8">
              </label>
              <div class="candidate-dashboard-actions">
                <button class="candidate-portal-btn" type="submit" ${isBusy}>${state.authBusy && mode === 'signin' ? 'Signing in…' : 'Sign in'}</button>
                <button class="candidate-portal-btn candidate-portal-btn--ghost" type="button" data-auth-action="resend-verification" ${isBusy}>Resend verification email</button>
              </div>
              <div class="candidate-dashboard-actions">
                <button class="candidate-portal-btn candidate-portal-btn--subtle" type="button" data-auth-mode="reset">Forgot password</button>
                <button class="candidate-portal-btn candidate-portal-btn--ghost" type="button" data-scroll-to-register="true">Register account</button>
              </div>
              <p class="candidate-field-help">If your verification email has expired, enter the same email address here and resend a fresh one.</p>
            </form>
          </div>
          <div class="candidate-portal-panel ${mode === 'reset' ? 'is-active' : ''}" data-auth-panel="reset">
            <form class="candidate-portal-form" data-auth-form="reset">
              <label>Email
                <input type="email" name="email" autocomplete="email" required value="${prefillEmail}">
              </label>
              <div class="candidate-dashboard-actions">
                <button class="candidate-portal-btn candidate-portal-btn--ghost" type="submit" ${isBusy}>${state.authBusy && mode === 'reset' ? 'Sending…' : 'Send reset link'}</button>
                <button class="candidate-portal-btn candidate-portal-btn--subtle" type="button" data-auth-mode="signin">Back to sign in</button>
              </div>
              <p class="candidate-field-help">We will send a secure password reset email back to this candidate page.</p>
            </form>
          </div>
          <div class="candidate-portal-panel ${mode === 'recovery' ? 'is-active' : ''}" data-auth-panel="recovery">
            <form class="candidate-portal-form" data-auth-form="recovery">
              <label>New password
                <input type="password" name="password" autocomplete="new-password" required minlength="8">
              </label>
              <label>Confirm password
                <input type="password" name="confirm_password" autocomplete="new-password" required minlength="8">
              </label>
              <button class="candidate-portal-btn" type="submit" ${isBusy}>${state.authBusy && mode === 'recovery' ? 'Updating…' : 'Set new password'}</button>
              <p class="candidate-field-help">Use at least 8 characters, including a letter and a number.</p>
            </form>
          </div>
        </article>
        <aside class="candidate-portal-card candidate-portal-card--tint">
          <span class="candidate-portal-eyebrow">Why create an account</span>
          <ul class="candidate-portal-list">
            <li>Save your profile so you do not have to start from scratch next time</li>
            <li>See your HMJ applications with plain-English status updates</li>
            <li>Keep your CV and supporting documents ready for future roles</li>
          </ul>
        </aside>
      </div>
    `;
    setPageMode('form');
    prefillSignInEmail();
    syncAccountControls();
  }

  function renderDashboard() {
    const candidate = state.candidate || {};
    const applications = state.applications || [];
    const documents = state.documents || [];
    const paymentDetails = state.paymentDetails || {
      accountCurrency: 'GBP',
      paymentMethod: 'gbp_local',
      accountHolderName: '',
      bankName: '',
      bankLocationOrCountry: '',
      accountType: '',
      masked: {
        sortCode: '',
        accountNumber: '',
        iban: '',
        swiftBic: '',
      },
      lastFour: '',
      updatedAt: null,
      completion: {
        complete: false,
        missing: ['payment_details'],
      },
    };
    const fullName = candidateName();
    const userEmail = trimText(state.user?.email, 320) || trimText(candidate.email, 320);
    const authMessage = state.authMessage
      ? `<div class="candidate-portal-alert candidate-portal-alert--${escapeHtml(state.authMessage.tone)}">${escapeHtml(state.authMessage.text)}</div>`
      : '';
    const profileSkills = Array.isArray(candidate.skills) ? candidate.skills.join(', ') : '';
    const verified = state.user?.email_confirmed_at ? 'Verified' : 'Check your inbox to verify';
    const completion = profileCompletion(candidate);
    const onboarding = onboardingSummary();
    const onboardingMode = candidateOnboardingMode(candidate);
    const activeTab = resolveDashboardTab(candidate, state.activeTab);
    if (state.activeTab !== activeTab) {
      state.activeTab = activeTab;
    }
    const tabs = dashboardTabsForCandidate(candidate);
    const paymentMethod = paymentDetails.paymentMethod || (paymentDetails.accountCurrency === 'GBP' ? 'gbp_local' : 'iban_swift');
    const showGbpFields = paymentMethod === 'gbp_local';
    const requestedDocFocus = state.requestedDocuments[0] || (state.requestedFocus === 'right_to_work' ? 'right_to_work' : '');
    const documentTypeSelection = requestedDocFocus || 'cv';
    const requestedDocsText = requestedDocumentListText(state.requestedDocuments);
    const onboardingBanner = onboardingMode && (!onboarding.complete || state.onboardingPrompt)
      ? `
        <div class="candidate-onboarding-banner">
          <div>
            <p class="candidate-portal-eyebrow">Onboarding</p>
            <h3>${onboarding.complete ? 'Your onboarding profile is ready' : 'Complete the final onboarding details'}</h3>
            <p>${onboarding.complete
              ? 'HMJ has the key information needed in your portal.'
              : `${requestedDocsText ? `HMJ has requested ${requestedDocsText}. ` : ''}${!onboarding.hasRightToWork ? 'Upload passport or right-to-work evidence. ' : ''}${!onboarding.hasPayment ? 'Add your payment details for payroll.' : ''}`}</p>
          </div>
          <div class="candidate-onboarding-banner__actions">
            ${!onboarding.hasRightToWork ? '<button class="candidate-portal-btn candidate-portal-btn--ghost" type="button" data-dashboard-tab="documents" data-dashboard-focus="right_to_work">Upload right-to-work</button>' : ''}
            ${!onboarding.hasPayment ? '<button class="candidate-portal-btn" type="button" data-dashboard-tab="payment" data-dashboard-focus="">Add payment details</button>' : ''}
          </div>
        </div>
      `
      : '';
    const dashboardStatusPanel = onboardingMode
      ? `
        <div class="candidate-inline-panel candidate-inline-panel--priority">
          <strong>Live assignment onboarding</strong>
          <p>${escapeHtml(candidateModeDescription(candidate))}</p>
          <ul class="candidate-checklist">
            ${onboardingChecklist(onboarding, candidate).map((item) => `
              <li class="${item.complete ? 'is-complete' : 'is-pending'}">
                <span>${escapeHtml(item.label)}</span>
                <strong>${item.complete ? 'Done' : 'Needed'}</strong>
              </li>
            `).join('')}
          </ul>
        </div>
      `
      : `
        <div class="candidate-inline-panel candidate-inline-panel--subtle">
          <strong>Recruitment profile active</strong>
          <p>${escapeHtml(candidateModeDescription(candidate))}</p>
        </div>
      `;
    const recruitmentDocumentOptions = [
      { value: 'cv', label: 'CV' },
      { value: 'cover_letter', label: 'Cover letter' },
      { value: 'qualification_certificate', label: 'Qualification / certificate' },
      { value: 'reference', label: 'Reference' },
      { value: 'other', label: 'Other' },
    ];
    const onboardingDocumentOptions = [
      { value: 'passport', label: 'Passport' },
      { value: 'right_to_work', label: 'Right to work' },
      { value: 'visa_permit', label: 'Visa / permit' },
      { value: 'bank_document', label: 'Bank document' },
    ];
    const documentOptions = onboardingMode
      ? recruitmentDocumentOptions.concat(onboardingDocumentOptions)
      : recruitmentDocumentOptions;

    const profilePane = `
      <section class="candidate-dashboard-pane ${activeTab === 'profile' ? 'is-active' : ''}" data-dashboard-pane="profile">
        <div class="candidate-dashboard-card">
          <div class="candidate-dashboard-card__head">
            <h3>Profile</h3>
            <p>${onboardingMode
              ? 'Keep your core profile, onboarding, and mobilisation details current in one place.'
              : 'Keep the details HMJ uses to represent you up to date, from your CV and role focus through to location and availability.'}</p>
          </div>
          ${dashboardStatusPanel}
          <div class="candidate-inline-panel">
            <strong>Profile completion</strong>
            <p>${completion.completed} of ${completion.total} profile areas completed. Adding the missing detail helps recruiters assess fit faster.</p>
            <div class="candidate-meter" aria-hidden="true"><span style="width:${completion.percent}%"></span></div>
          </div>
          <form class="candidate-dashboard-form" data-dashboard-form="profile">
            <div class="candidate-dashboard-form__section-title candidate-dashboard-form__full">Portal path</div>
            <fieldset class="candidate-mode-selector candidate-dashboard-form__full">
              <legend>Are you completing onboarding for a live HMJ placement?</legend>
              <p class="candidate-field-help">Only select Yes if you have already agreed a live role or have been asked by HMJ to complete onboarding. If you are only registering to apply for jobs, leave this set to No.</p>
              <label class="candidate-mode-option">
                <input type="radio" name="onboarding_mode" value="false" ${onboardingMode ? '' : 'checked'}>
                <span>
                  <strong>No — I’m just creating my recruitment profile</strong>
                  <small>Use your HMJ account for job applications, CV storage, and profile updates.</small>
                </span>
              </label>
              <label class="candidate-mode-option">
                <input type="radio" name="onboarding_mode" value="true" ${onboardingMode ? 'checked' : ''}>
                <span>
                  <strong>Yes — I’ve agreed a live role and need to complete onboarding</strong>
                  <small>HMJ will use this to collect the right-to-work, payroll, address, and emergency contact details needed for mobilisation.</small>
                </span>
              </label>
            </fieldset>
            <div class="candidate-dashboard-form__section-title candidate-dashboard-form__full">Core contact details</div>
            <label>Full name
              <input type="text" name="name" value="${escapeHtml(fullName)}" required>
            </label>
            <label>Email
              <input type="email" value="${escapeHtml(userEmail)}" disabled>
              <span class="candidate-field-help">Your login email is managed in Settings.</span>
            </label>
            <label>Phone
              <input type="tel" name="phone" value="${escapeHtml(candidate.phone || '')}" placeholder="+44 7…">
            </label>
            <label>Address line 1
              <input type="text" name="address1" value="${escapeHtml(candidate.address1 || '')}" placeholder="Street address">
            </label>
            <label>Address line 2
              <input type="text" name="address2" value="${escapeHtml(candidate.address2 || '')}" placeholder="Apartment, unit, building">
            </label>
            <label>Town / city
              <input type="text" name="town" value="${escapeHtml(candidate.town || '')}" placeholder="City">
            </label>
            <label>County / region
              <input type="text" name="county" value="${escapeHtml(candidate.county || '')}" placeholder="County or region">
            </label>
            <label>Postcode
              <input type="text" name="postcode" value="${escapeHtml(candidate.postcode || '')}" placeholder="Postcode">
            </label>
            <label>Country
              <input type="text" name="country" value="${escapeHtml(candidate.country || '')}" placeholder="Country">
            </label>
            <label>Location
              <input type="text" name="location" value="${escapeHtml(candidate.location || '')}" placeholder="City, country">
            </label>
            <label>Nationality
              <input type="text" name="nationality" value="${escapeHtml(candidate.nationality || '')}" placeholder="Nationality">
            </label>
            <div class="candidate-dashboard-form__section-title candidate-dashboard-form__full">Recruitment profile</div>
            <label>Primary specialism
              <input type="text" name="primary_specialism" value="${escapeHtml(candidate.primary_specialism || candidate.sector_focus || '')}" placeholder="Commissioning, CSA, Electrical (MEP)…">
            </label>
            <label>Secondary specialism
              <input type="text" name="secondary_specialism" value="${escapeHtml(candidate.secondary_specialism || '')}" placeholder="Optional second discipline">
            </label>
            <label>Current job title
              <input type="text" name="current_job_title" value="${escapeHtml(candidate.current_job_title || '')}" placeholder="Lead Electrical Supervisor">
            </label>
            <label>Roles looking for
              <input type="text" name="desired_roles" value="${escapeHtml(candidate.desired_roles || candidate.headline_role || '')}" placeholder="Commissioning Manager, CSA Package Manager">
            </label>
            <label>Years of experience
              <input type="number" min="0" max="60" step="1" name="experience_years" value="${escapeHtml(candidate.experience_years ?? '')}" placeholder="10">
            </label>
            <label>Sector experience
              <input type="text" name="sector_experience" value="${escapeHtml(candidate.sector_experience || candidate.sector_focus || '')}" placeholder="Data centres, pharma, substations">
            </label>
            <label>Skills
              <input type="text" name="skills" value="${escapeHtml(profileSkills)}" placeholder="IST, LV, BMS, QA/QC">
            </label>
            <label>Availability
              <input type="text" name="availability" value="${escapeHtml(candidate.availability || '')}" placeholder="Immediate, 2 weeks, mid-April">
            </label>
            <label>Relocation preference
              <input type="text" name="relocation_preference" value="${escapeHtml(candidate.relocation_preference || '')}" placeholder="Yes, maybe, or no">
            </label>
            <label>Salary / rate expectation
              <input type="text" name="salary_expectation" value="${escapeHtml(candidate.salary_expectation || '')}" placeholder="e.g. 75000 per year or 450 per day">
            </label>
            <label>LinkedIn
              <input type="url" name="linkedin_url" value="${escapeHtml(candidate.linkedin_url || '')}" placeholder="https://linkedin.com/in/your-profile">
            </label>
            <label class="candidate-dashboard-form__full">Qualifications / certifications
              <textarea name="qualifications" rows="4" placeholder="SSSTS, AP, cleanroom certs, vendor training…">${escapeHtml(candidate.qualifications || '')}</textarea>
            </label>
            <label class="candidate-dashboard-form__full">Summary
              <textarea name="summary" rows="6" placeholder="Tell HMJ about your current focus, preferred rotations and the sites that fit best.">${escapeHtml(candidate.summary || '')}</textarea>
            </label>
            ${onboardingMode ? `
              <div class="candidate-dashboard-form__section-title candidate-dashboard-form__full">Live assignment onboarding</div>
              <label>Right to work status
                <input type="text" name="right_to_work_status" value="${escapeHtml(candidate.right_to_work_status || '')}" placeholder="Full right to work already in place">
              </label>
              <label class="candidate-dashboard-form__full">Right to work regions
                <input type="text" name="right_to_work_regions" value="${escapeHtml(Array.isArray(candidate.right_to_work_regions) ? candidate.right_to_work_regions.join(', ') : '')}" placeholder="United Kingdom, European Union / EEA">
                <span class="candidate-field-help">Separate regions with commas.</span>
              </label>
              <div class="candidate-inline-panel candidate-inline-panel--subtle candidate-dashboard-form__full">
                <strong>Emergency contact (next of kin)</strong>
                <p>Provide a contact HMJ can reach in case of emergency while you are on assignment.</p>
              </div>
              <label>Next of kin full name
                <input type="text" name="emergency_name" value="${escapeHtml(candidate.emergency_name || '')}" placeholder="Emergency contact full name">
              </label>
              <label>Next of kin telephone number
                <input type="tel" name="emergency_phone" value="${escapeHtml(candidate.emergency_phone || '')}" placeholder="+44 7…">
              </label>
            ` : ''}
            <div class="candidate-dashboard-actions candidate-dashboard-form__full">
              <button class="candidate-portal-btn" type="submit" ${state.dashboardBusy ? 'disabled' : ''}>${state.dashboardBusy && activeTab === 'profile' ? 'Saving…' : 'Save profile'}</button>
              <span class="candidate-field-help">We only update your candidate record after you press save.</span>
            </div>
          </form>
        </div>
      </section>
    `;

    const applicationsPane = `
      <section class="candidate-dashboard-pane ${activeTab === 'applications' ? 'is-active' : ''}" data-dashboard-pane="applications">
        <div class="candidate-dashboard-card">
          <div class="candidate-dashboard-card__head">
            <h3>Applications</h3>
            <p>Submitted roles appear here automatically whenever you apply through HMJ forms while signed in.</p>
          </div>
          <div class="candidate-dashboard-stack">
            ${applications.length ? applications.map((application) => {
              const presentation = statusCopy(application.status);
              return `
              <article class="candidate-application-card">
                <div class="candidate-application-card__head">
                  <div>
                    <h4>${escapeHtml(application.job_title || application.job_id || 'HMJ role')}</h4>
                    <p>${escapeHtml(application.job_location || 'Location pending')}</p>
                  </div>
                  <span class="candidate-status-pill candidate-status-pill--${presentation.tone}">${escapeHtml(presentation.label)}</span>
                </div>
                <dl class="candidate-application-meta">
                  <div><dt>Applied</dt><dd>${escapeHtml(formatDate(application.applied_at))}</dd></div>
                  <div><dt>Reference</dt><dd>${escapeHtml(application.job_id || 'Pending')}</dd></div>
                  <div><dt>Type</dt><dd>${escapeHtml(application.job_type || 'Role update pending')}</dd></div>
                  <div><dt>Package</dt><dd>${escapeHtml(application.job_pay || 'To be confirmed')}</dd></div>
                </dl>
                <p class="candidate-application-note">${escapeHtml(presentation.detail)}</p>
                ${application.notes ? `<p class="candidate-application-note">${escapeHtml(application.notes)}</p>` : ''}
              </article>
            `;
            }).join('') : `
              <div class="candidate-empty-state">
                <h4>No tracked applications yet.</h4>
                <p>Apply from the HMJ jobs board while signed in and we’ll log the role here automatically.</p>
                <a class="candidate-portal-btn candidate-portal-btn--ghost" href="/jobs.html">Browse live jobs</a>
              </div>
            `}
          </div>
        </div>
      </section>
    `;

    const documentsPane = `
      <section class="candidate-dashboard-pane ${activeTab === 'documents' ? 'is-active' : ''}" data-dashboard-pane="documents">
        <div class="candidate-dashboard-card">
          <div class="candidate-dashboard-card__head">
            <h3>Documents</h3>
            <p>${onboardingMode
              ? 'Upload recruitment documents and the onboarding evidence HMJ has requested for your live placement.'
              : 'Upload your CV, cover letter, qualifications, and other recruitment profile documents into your private candidate area.'}</p>
          </div>
          ${onboardingMode && (!onboarding.hasRightToWork || state.requestedFocus === 'right_to_work')
            ? `<div class="candidate-inline-panel candidate-inline-panel--priority">
                <strong>Right-to-work documents needed</strong>
                <p>Upload your passport, visa, permit, or right-to-work evidence here so HMJ can complete onboarding.</p>
              </div>`
            : ''}
          ${state.requestedDocuments.length
            ? `<div class="candidate-inline-panel candidate-inline-panel--subtle">
                <strong>Requested documents</strong>
                <p>HMJ has asked you to upload ${escapeHtml(requestedDocsText)}. Upload each file here and label it clearly so the team can review it quickly.</p>
              </div>`
            : ''}
          <div class="candidate-inline-panel candidate-inline-panel--subtle">
            <strong>${onboardingMode ? 'Recruitment and onboarding documents' : 'Recruitment profile documents'}</strong>
            <p>${onboardingMode
              ? 'Use CV, cover letter, qualification, and reference types for your recruitment profile. Use Passport, Right to work, Visa / permit, and Bank document only when HMJ has asked you to complete onboarding.'
              : 'Use this area for your CV, cover letter, qualifications, and supporting documents. Right-to-work and payroll documents are only needed if HMJ asks you to complete live onboarding.'}</p>
          </div>
          <div class="candidate-inline-panel candidate-inline-panel--subtle">
            <strong>Accepted files</strong>
            <p>PDF, DOC, DOCX, PNG, JPG, JPEG, and WEBP files up to 15 MB.</p>
          </div>
          <form class="candidate-dashboard-form candidate-dashboard-form--documents" data-dashboard-form="documents">
            <label>Document type
              <select name="document_type" required>
                ${documentOptions.map((option) => `
                  <option value="${option.value}" ${documentTypeSelection === option.value ? 'selected' : ''}>${option.label}</option>
                `).join('')}
              </select>
            </label>
            <label>Label
              <input type="text" name="label" placeholder="Passport, share code, March CV">
            </label>
            <label class="candidate-dashboard-form__full">File
              <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" required>
              <span class="candidate-field-help">The file will be linked to your candidate record and stored in HMJ's private candidate document area.</span>
            </label>
            <div class="candidate-dashboard-actions candidate-dashboard-form__full">
              <button class="candidate-portal-btn" type="submit" ${state.documentsBusy ? 'disabled' : ''}>${state.documentsBusy ? 'Uploading…' : 'Upload document'}</button>
              ${state.documentsBusy ? '<span class="candidate-field-help">Uploading your file now…</span>' : ''}
            </div>
          </form>
          <div class="candidate-dashboard-stack">
            ${documents.length ? documents.map((documentRow) => {
              const owned = candidateDocumentIsPortalOwned(documentRow, state.user?.id);
              return `
                <article class="candidate-document-card">
                  <div class="candidate-document-card__body">
                    <div class="candidate-document-card__topline">
                      <span class="candidate-document-card__tag">${escapeHtml(String(documentRow.document_type || 'other').replace(/_/g, ' '))}</span>
                      <span class="candidate-field-help">${escapeHtml(formatDate(documentRow.uploaded_at || documentRow.created_at))}</span>
                    </div>
                    <h4>${escapeHtml(documentRow.label || documentRow.original_filename || documentRow.filename || 'Document')}</h4>
                    <p>${escapeHtml(documentRow.original_filename || documentRow.filename || 'File')}</p>
                  </div>
                  <div class="candidate-document-card__actions">
                    ${documentRow.download_url ? `<a class="candidate-portal-btn candidate-portal-btn--ghost" href="${escapeHtml(documentRow.download_url)}" target="_blank" rel="noreferrer">Download</a>` : ''}
                    ${owned ? `<button class="candidate-portal-btn candidate-portal-btn--danger" type="button" data-document-delete="${escapeHtml(documentRow.id)}">Delete</button>` : '<span class="candidate-document-card__tag">HMJ record</span>'}
                  </div>
                </article>
              `;
            }).join('') : `
              <div class="candidate-empty-state">
                <h4>No uploaded documents yet.</h4>
                <p>Add a CV or compliance document here and HMJ will keep it linked to your candidate profile.</p>
              </div>
            `}
          </div>
        </div>
      </section>
    `;

    const paymentPane = onboardingMode ? `
      <section class="candidate-dashboard-pane ${activeTab === 'payment' ? 'is-active' : ''}" data-dashboard-pane="payment">
        <div class="candidate-dashboard-card">
          <div class="candidate-dashboard-card__head">
            <h3>Payroll details</h3>
            <p>HMJ uses this secure area to collect payroll-ready bank details during onboarding.</p>
          </div>
          <div class="candidate-inline-panel candidate-inline-panel--subtle">
            <strong>Security note</strong>
            <p>Bank identifiers are stored for your candidate record and shown back in masked form. If you are only updating bank name or location, leave the masked fields blank.</p>
          </div>
          <div class="candidate-payment-summary">
            <div class="candidate-payment-summary__item">
              <span>Currency</span>
              <strong>${escapeHtml(paymentDetails.accountCurrency || 'GBP')}</strong>
            </div>
            <div class="candidate-payment-summary__item">
              <span>Format</span>
              <strong>${escapeHtml(showGbpFields ? 'Sort code & account number' : 'IBAN & SWIFT/BIC')}</strong>
            </div>
            <div class="candidate-payment-summary__item">
              <span>Stored reference</span>
              <strong>${escapeHtml(paymentDetails.lastFour ? `••••${paymentDetails.lastFour}` : 'Not saved yet')}</strong>
            </div>
            <div class="candidate-payment-summary__item">
              <span>Updated</span>
              <strong>${escapeHtml(paymentDetails.updatedAt ? formatDate(paymentDetails.updatedAt) : 'Not yet')}</strong>
            </div>
          </div>
          <form class="candidate-dashboard-form" data-dashboard-form="payment">
            <label>Account currency
              <select name="account_currency">
                <option value="GBP" ${paymentDetails.accountCurrency === 'GBP' ? 'selected' : ''}>GBP</option>
                <option value="EUR" ${paymentDetails.accountCurrency === 'EUR' ? 'selected' : ''}>EUR</option>
                <option value="USD" ${paymentDetails.accountCurrency === 'USD' ? 'selected' : ''}>USD</option>
                ${!['GBP', 'EUR', 'USD'].includes(paymentDetails.accountCurrency || '') && paymentDetails.accountCurrency ? `<option value="${escapeHtml(paymentDetails.accountCurrency)}" selected>${escapeHtml(paymentDetails.accountCurrency)}</option>` : ''}
              </select>
            </label>
            <label>Payment format
              <select name="payment_method">
                <option value="gbp_local" ${paymentMethod === 'gbp_local' ? 'selected' : ''}>UK bank account</option>
                <option value="iban_swift" ${paymentMethod === 'iban_swift' ? 'selected' : ''}>IBAN / SWIFT</option>
              </select>
            </label>
            <label>Account holder name
              <input type="text" name="account_holder_name" value="${escapeHtml(paymentDetails.accountHolderName || fullName)}" placeholder="Account holder name" required>
            </label>
            <label>Bank name
              <input type="text" name="bank_name" value="${escapeHtml(paymentDetails.bankName || '')}" placeholder="Bank name" required>
            </label>
            <label>Bank country / location
              <input type="text" name="bank_location_or_country" value="${escapeHtml(paymentDetails.bankLocationOrCountry || '')}" placeholder="Bank country or branch location" required>
            </label>
            <label>Account type
              <input type="text" name="account_type" value="${escapeHtml(paymentDetails.accountType || '')}" placeholder="Optional e.g. personal, business">
            </label>
            ${showGbpFields ? `
              <label>Sort code
                <input type="text" name="sort_code" value="" inputmode="numeric" placeholder="${escapeHtml(paymentDetails.masked?.sortCode || '12-34-56')}">
                <span class="candidate-field-help">${paymentDetails.masked?.sortCode ? `Stored: ${escapeHtml(paymentDetails.masked.sortCode)}. Re-enter only if it needs to change.` : 'Enter the 6-digit sort code.'}</span>
              </label>
              <label>Account number
                <input type="text" name="account_number" value="" inputmode="numeric" placeholder="${escapeHtml(paymentDetails.masked?.accountNumber || '12345678')}">
                <span class="candidate-field-help">${paymentDetails.masked?.accountNumber ? `Stored: ${escapeHtml(paymentDetails.masked.accountNumber)}. Re-enter only if it needs to change.` : 'Enter the account number.'}</span>
              </label>
            ` : `
              <label>IBAN
                <input type="text" name="iban" value="" placeholder="${escapeHtml(paymentDetails.masked?.iban || 'DE89 3704 0044 0532 0130 00')}">
                <span class="candidate-field-help">${paymentDetails.masked?.iban ? `Stored: ${escapeHtml(paymentDetails.masked.iban)}. Re-enter only if it needs to change.` : 'Enter the IBAN in full.'}</span>
              </label>
              <label>SWIFT / BIC
                <input type="text" name="swift_bic" value="" placeholder="${escapeHtml(paymentDetails.masked?.swiftBic || 'DEUTDEFF')}">
                <span class="candidate-field-help">${paymentDetails.masked?.swiftBic ? `Stored: ${escapeHtml(paymentDetails.masked.swiftBic)}. Re-enter only if it needs to change.` : 'Enter the SWIFT or BIC code.'}</span>
              </label>
            `}
            <div class="candidate-dashboard-actions candidate-dashboard-form__full">
              <button class="candidate-portal-btn" type="submit" ${state.paymentBusy ? 'disabled' : ''}>${state.paymentBusy ? 'Saving…' : 'Save payment details'}</button>
              <span class="candidate-field-help">${paymentDetails.completion?.complete ? 'Payment details are on file.' : 'HMJ uses these details only for onboarding and payroll setup.'}</span>
            </div>
          </form>
        </div>
      </section>
    ` : '';

    const settingsPane = `
      <section class="candidate-dashboard-pane ${activeTab === 'settings' ? 'is-active' : ''}" data-dashboard-pane="settings">
        <div class="candidate-dashboard-grid candidate-dashboard-grid--settings">
          <article class="candidate-dashboard-card">
            <div class="candidate-dashboard-card__head">
              <h3>Account</h3>
              <p>Your candidate account is separate from HMJ admin access and uses Supabase sign-in.</p>
            </div>
            <dl class="candidate-settings-list">
              <div><dt>Email</dt><dd>${escapeHtml(userEmail)}</dd></div>
              <div><dt>Verification</dt><dd>${escapeHtml(verified)}</dd></div>
            </dl>
            <form class="candidate-dashboard-form" data-dashboard-form="email">
              <label>Update login email
                <input type="email" name="email" value="${escapeHtml(userEmail)}" required>
                <span class="candidate-field-help">Supabase will send confirmation steps if you change this.</span>
              </label>
              <div class="candidate-dashboard-actions">
                <button class="candidate-portal-btn candidate-portal-btn--ghost" type="submit" ${state.settingsBusy ? 'disabled' : ''}>${state.settingsBusy ? 'Saving…' : 'Update email'}</button>
              </div>
            </form>
          </article>
          <article class="candidate-dashboard-card">
            <div class="candidate-dashboard-card__head">
              <h3>Password</h3>
              <p>Need a new password? We’ll email you a secure reset link.</p>
            </div>
            <form class="candidate-dashboard-form" data-dashboard-form="reset-link">
              <label>Reset email destination
                <input type="email" name="email" value="${escapeHtml(userEmail)}" required>
                <span class="candidate-field-help">Use the email address where you want the reset instructions sent.</span>
              </label>
              <div class="candidate-dashboard-actions">
                <button class="candidate-portal-btn candidate-portal-btn--ghost" type="submit" ${state.settingsBusy ? 'disabled' : ''}>Email reset link</button>
                <button class="candidate-portal-btn candidate-portal-btn--subtle" type="button" data-dashboard-action="signout">Sign out</button>
              </div>
            </form>
          </article>
          <article class="candidate-dashboard-card candidate-dashboard-card--danger">
            <div class="candidate-dashboard-card__head">
              <h3>Close portal account</h3>
              <p>This removes your self-service portal access. HMJ may still retain your recruitment record and applications in line with the existing hiring workflow.</p>
            </div>
            <label class="candidate-settings-check" data-dashboard-toggle="close-confirm">
              <input type="checkbox" ${state.closeConfirm ? 'checked' : ''}>
              <span>I understand that closing my portal account is permanent.</span>
            </label>
            <div class="candidate-dashboard-actions">
              <button class="candidate-portal-btn candidate-portal-btn--danger" type="button" data-dashboard-action="close-account" ${state.closeConfirm ? '' : 'disabled'}>Close account</button>
            </div>
          </article>
        </div>
      </section>
    `;

    dashboardRoot.innerHTML = `
      <section class="candidate-dashboard-shell">
        <header class="candidate-dashboard-hero">
          <div class="candidate-dashboard-hero__copy">
            <p class="candidate-portal-eyebrow">Candidate dashboard</p>
            <h2>Welcome back, ${escapeHtml(firstName())}</h2>
            <p>Your profile, applications, and documents live here.</p>
            <div class="candidate-dashboard-hero__status">
              <span class="candidate-hero-chip">${escapeHtml(verified)}</span>
              <span class="candidate-hero-chip">Profile ${completion.percent}% complete</span>
              <span class="candidate-hero-chip">${escapeHtml(candidateModeLabel(candidate))}</span>
            </div>
          </div>
          <div class="candidate-dashboard-hero__meta">
            <span class="candidate-dashboard-stat"><strong>${applications.length}</strong><span>Applications</span></span>
            <span class="candidate-dashboard-stat"><strong>${documents.length}</strong><span>Documents</span></span>
            <span class="candidate-dashboard-stat"><strong>${onboardingMode ? (onboarding.complete ? 'Ready' : 'Action needed') : 'Active'}</strong><span>${onboardingMode ? 'Onboarding' : 'Recruitment profile'}</span></span>
            <a class="candidate-portal-btn candidate-portal-btn--ghost" href="/jobs.html">Browse jobs</a>
            <button class="candidate-portal-btn candidate-portal-btn--subtle" type="button" data-dashboard-action="signout">Sign out</button>
          </div>
        </header>
        ${authMessage}
        ${onboardingBanner}
        <div class="candidate-dashboard-layout">
          <nav class="candidate-dashboard-nav" aria-label="Candidate dashboard sections">
            ${tabs.map((tab) => `
              <button type="button" class="candidate-dashboard-nav__item ${activeTab === tab ? 'is-active' : ''}" data-dashboard-tab="${tab}">${escapeHtml(dashboardTabLabel(tab))}</button>
            `).join('')}
          </nav>
          <div class="candidate-dashboard-content">
            ${profilePane}
            ${applicationsPane}
            ${documentsPane}
            ${paymentPane}
            ${settingsPane}
          </div>
        </div>
      </section>
    `;

    setPageMode('dashboard');
  }

  function render() {
    if (state.hydrating) {
      renderAuthLoading();
      return;
    }
    if (state.user && !state.dashboardError && state.authMode !== 'recovery') {
      if (state.candidate) {
        renderDashboard();
      } else {
        renderDashboardSkeleton();
      }
      return;
    }
    renderAuth();
  }

  async function refreshDashboard() {
    if (!state.user) {
      state.candidate = null;
      state.applications = [];
      state.documents = [];
      state.paymentDetails = null;
      state.dashboardError = '';
      render();
      return;
    }

    state.dashboardBusy = true;
    render();

    try {
      const candidate = await loadCandidateProfile();
      const [applicationsResult, documentsResult, paymentResult] = await Promise.allSettled([
        loadCandidateApplications(candidate.id),
        loadCandidateDocuments(candidate.id),
        loadCandidatePaymentDetails(),
      ]);
      const applications = applicationsResult.status === 'fulfilled' ? applicationsResult.value : [];
      const documents = documentsResult.status === 'fulfilled' ? documentsResult.value : [];
      const paymentDetails = paymentResult.status === 'fulfilled' ? paymentResult.value : null;
      state.candidate = candidate;
      state.applications = applications;
      state.documents = documents;
      state.paymentDetails = paymentDetails;
      state.draftOnboardingMode = null;
      state.requestedDocuments = remainingRequestedDocuments(documents, state.requestedDocuments);
      if (!state.requestedDocuments.length && onboardingSummary().complete) {
        state.onboardingPrompt = false;
      }
      state.dashboardError = '';
      if (
        applicationsResult.status === 'rejected'
        || documentsResult.status === 'rejected'
        || paymentResult.status === 'rejected'
      ) {
        state.authMessage = {
          tone: 'warn',
          text: 'Some candidate dashboard sections are temporarily unavailable, but your profile area is still available.',
        };
      }
    } catch (error) {
      state.dashboardError = error?.message || 'Candidate dashboard unavailable.';
      state.authMessage = {
        tone: 'warn',
        text: 'Candidate dashboard tools are unavailable right now. You can still use the application form below.',
      };
      state.candidate = null;
      state.paymentDetails = null;
    } finally {
      state.dashboardBusy = false;
      render();
    }
  }

  async function initialiseAuthState() {
    try {
      const { user, session } = await getCandidatePortalContext();
      state.user = user;
      state.session = session;
      if (!user) {
        render();
        return;
      }
      await refreshDashboard();
    } catch (error) {
      state.authAvailable = false;
      state.authMessage = {
        tone: 'warn',
        text: 'Candidate portal tools are unavailable at the moment. You can still submit the existing form below.',
      };
    } finally {
      state.hydrating = false;
      syncAccountControls();
      render();
    }
  }

  async function handleAuthForm(event) {
    const formEl = event.target;
    const mode = formEl.getAttribute('data-auth-form');
    if (!mode) return;

    event.preventDefault();
    state.authBusy = true;
    state.authMessage = null;
    render();

    const formData = new FormData(formEl);

    try {
      if (mode === 'signin') {
        state.pendingEmail = trimText(formData.get('email'), 320).toLowerCase();
        const authData = await signInCandidate({
          email: formData.get('email'),
          password: formData.get('password'),
        });
        state.user = authData?.user || authData?.session?.user || state.user;
        state.session = authData?.session || state.session;
        clearPendingCandidateEmail();
        state.pendingEmail = '';
        state.authMessage = { tone: 'success', text: 'Signed in. Loading your candidate dashboard…' };
        if (state.user) {
          await refreshDashboard();
        }
      } else if (mode === 'reset') {
        state.pendingEmail = trimText(formData.get('email'), 320).toLowerCase();
        await requestCandidatePasswordReset(formData.get('email'));
        state.authMessage = {
          tone: 'success',
          text: 'Reset link sent. Check your inbox for the secure recovery email.',
        };
      } else if (mode === 'recovery') {
        const password = trimText(formData.get('password'), 200);
        const confirm = trimText(formData.get('confirm_password'), 200);
        if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
          throw new Error('Use at least 8 characters, including a letter and a number.');
        }
        if (password !== confirm) {
          throw new Error('The password fields do not match.');
        }
        await updateCandidatePassword(password);
        state.authMode = 'signin';
        state.authMessage = {
          tone: 'success',
          text: 'Password updated. Sign in with your new password.',
        };
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('candidate_action');
        window.history.replaceState({}, '', cleanUrl.toString());
      }
    } catch (error) {
      state.authMessage = {
        tone: 'error',
        text: authErrorMessage(mode, error),
      };
    } finally {
      state.authBusy = false;
      render();
    }
  }

  function createAccountRequested() {
    return !!(accountToggle.checked && state.authAvailable);
  }

  function buildCandidateSyncPayload(formData, submissionId, paymentDetails = null) {
    const rightToWorkRegions = normaliseSkillList(formData.get('right_to_work'));
    const salaryExpectationUnit = normaliseSalaryExpectationUnit(formData.get('salary_expectation_unit'));
    const candidate = {
      first_name: formData.get('first_name'),
      surname: formData.get('surname'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      address1: formData.get('address1'),
      address2: formData.get('address2'),
      town: formData.get('town'),
      county: formData.get('county'),
      postcode: formData.get('postcode'),
      country: formData.get('country'),
      location: formData.get('location'),
      nationality: formData.get('nationality'),
      right_to_work_status: formData.get('right_to_work_status'),
      right_to_work_regions: rightToWorkRegions,
      discipline: formData.get('discipline'),
      secondary_specialism: formData.get('secondary_specialism'),
      current_job_title: formData.get('current_job_title'),
      role: formData.get('role'),
      desired_roles: formData.get('role'),
      years_experience: formData.get('years_experience'),
      qualifications: formData.get('qualifications'),
      sector_experience: formData.get('sector_experience'),
      availability: formData.get('availability'),
      notice_period: formData.get('notice_period'),
      salary_expectation: formatSalaryExpectation(formData.get('salary_expectation'), salaryExpectationUnit),
      salary_expectation_unit: salaryExpectationUnit,
      relocation: formData.get('relocation'),
      linkedin: formData.get('linkedin'),
      message: formData.get('message'),
      skills: normaliseSkillList(formData.get('skills')),
      source_submission_id: submissionId,
      onboarding_mode: !!paymentDetails,
    };

    return {
      source: createAccountRequested() ? 'candidate_registration_form' : 'candidate_profile_form',
      submission_id: submissionId,
      candidate,
      payment_details: paymentDetails && typeof paymentDetails === 'object' ? paymentDetails : undefined,
    };
  }

  function buildCandidateReturnUrl(accountState) {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('submitted', '1');
    url.searchParams.set('candidate_account', accountState);
    url.searchParams.delete('candidate_auth');
    url.searchParams.delete('candidate_action');
    url.searchParams.delete('error');
    url.searchParams.delete('error_code');
    url.searchParams.delete('error_description');
    return url.toString();
  }

  function requestNativeFormSubmit(accountState) {
    const formEmail = trimText(form.querySelector('#email')?.value, 320).toLowerCase();
    if (formEmail && accountState !== 'none') {
      setPendingCandidateEmail(formEmail);
      state.pendingEmail = formEmail;
    }
    if (accountState === 'none') {
      clearPendingCandidateEmail();
      state.pendingEmail = '';
    }

    form.action = buildCandidateReturnUrl(accountState);
    accountRequestedInput.value = accountState === 'none' ? 'no' : 'yes';
    state.allowNativeSubmit = true;
    state.formBusy = false;
    syncAccountControls();

    if (isLocalCandidateMockMode()) {
      state.allowNativeSubmit = false;
      window.history.replaceState({}, '', form.action);
      state.formMessage = submissionMessageFromParams(readAuthParams());
      render();
      return;
    }

    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }

    if (doc.getElementById('pageUrlHidden')) {
      doc.getElementById('pageUrlHidden').value = window.location.href;
    }
    HTMLFormElement.prototype.submit.call(form);
  }

  async function resendVerificationForEmail(email, target = 'auth') {
    const cleanEmail = trimText(email, 320).toLowerCase();
    if (!cleanEmail) {
      if (target === 'form') {
        state.formMessage = {
          tone: 'warn',
          text: 'Enter your email address in the form first, then resend the verification email.',
          showResend: true,
        };
        renderFormStatus();
      } else {
        state.authMessage = {
          tone: 'warn',
          text: 'Enter your email address first, then resend the verification email.',
        };
        render();
      }
      return;
    }

    state.authBusy = true;
    if (target === 'auth') {
      render();
    }

    try {
      await resendCandidateVerification(cleanEmail);
      setPendingCandidateEmail(cleanEmail);
      state.pendingEmail = cleanEmail;
      if (target === 'form') {
        state.formMessage = {
          tone: 'success',
          text: 'A fresh verification email has been sent. Please open the newest email only.',
          showResend: true,
        };
        renderFormStatus();
      } else {
        state.authMessage = {
          tone: 'success',
          text: 'A fresh verification email has been sent. Please open the newest email only.',
        };
        render();
      }
    } catch (error) {
      if (target === 'form') {
        state.formMessage = {
          tone: 'error',
          text: authErrorMessage('signin', error),
          showResend: true,
        };
        renderFormStatus();
      } else {
        state.authMessage = {
          tone: 'error',
          text: authErrorMessage('signin', error),
        };
        render();
      }
    } finally {
      state.authBusy = false;
      if (target === 'auth') {
        render();
      } else {
        renderFormStatus();
      }
    }
  }

  async function handleDashboardForm(event) {
    const formEl = event.target;
    const formType = formEl.getAttribute('data-dashboard-form');
    if (!formType) return;

    event.preventDefault();
    const formData = new FormData(formEl);

    try {
      if (formType === 'profile') {
        state.dashboardBusy = true;
        render();
        const name = trimText(formData.get('name'), 240);
        const linkedinUrl = trimText(formData.get('linkedin_url'), 500);
        const onboardingMode = normaliseBooleanFlag(formData.get('onboarding_mode'));
        const emergencyName = trimText(formData.get('emergency_name'), 240);
        const emergencyPhone = trimText(formData.get('emergency_phone'), 80);
        if (!name) {
          throw new Error('Please enter your name before saving.');
        }
        if (linkedinUrl && !/^https?:\/\//i.test(linkedinUrl)) {
          throw new Error('Please enter your LinkedIn URL in full, for example https://linkedin.com/in/your-name.');
        }
        if (onboardingMode) {
          if (!trimText(formData.get('address1'), 240) || !trimText(formData.get('town'), 160) || !trimText(formData.get('postcode'), 32) || !trimText(formData.get('country'), 120)) {
            throw new Error('Add your address details before saving live assignment onboarding.');
          }
          if (!emergencyName || !emergencyPhone) {
            throw new Error('Add your emergency contact name and phone number before saving live assignment onboarding.');
          }
          if (emergencyPhone.replace(/\D/g, '').length < 7) {
            throw new Error('Enter a valid emergency contact telephone number.');
          }
        }
        const saved = await saveCandidateProfile({
          name,
          phone: formData.get('phone'),
          address1: formData.get('address1'),
          address2: formData.get('address2'),
          town: formData.get('town'),
          county: formData.get('county'),
          postcode: formData.get('postcode'),
          country: formData.get('country'),
          location: formData.get('location'),
          nationality: formData.get('nationality'),
          right_to_work_status: formData.get('right_to_work_status'),
          right_to_work_regions: formData.get('right_to_work_regions'),
          primary_specialism: formData.get('primary_specialism'),
          secondary_specialism: formData.get('secondary_specialism'),
          current_job_title: formData.get('current_job_title'),
          desired_roles: formData.get('desired_roles'),
          experience_years: formData.get('experience_years'),
          qualifications: formData.get('qualifications'),
          sector_experience: formData.get('sector_experience'),
          skills: normaliseSkillList(formData.get('skills')),
          availability: formData.get('availability'),
          relocation_preference: formData.get('relocation_preference'),
          salary_expectation: formData.get('salary_expectation'),
          linkedin_url: linkedinUrl,
          summary: formData.get('summary'),
          onboarding_mode: onboardingMode,
          emergency_name: emergencyName,
          emergency_phone: emergencyPhone,
        });
        state.candidate = saved;
        state.draftOnboardingMode = null;
        state.authMessage = { tone: 'success', text: 'Profile saved. HMJ will now see the updated version.' };
      } else if (formType === 'documents') {
        state.documentsBusy = true;
        render();
        const file = formData.get('file');
        if (!(file instanceof File) || !file.name) {
          throw new Error('Select a file to upload.');
        }
        await uploadCandidateDocument({
          file,
          documentType: formData.get('document_type'),
          label: formData.get('label'),
        });
        state.authMessage = { tone: 'success', text: 'Document uploaded and linked to your candidate profile.' };
        state.documents = await loadCandidateDocuments(state.candidate?.id);
        const uploadedType = normaliseRequestedDocumentType(formData.get('document_type'));
        if (uploadedType) {
          state.requestedDocuments = state.requestedDocuments.filter((type) => type !== uploadedType);
        }
        const onboarding = onboardingSummary();
        if (onboarding.hasPayment && onboarding.hasRightToWork) {
          state.onboardingPrompt = false;
        }
        updateDashboardLocation(state.activeTab, state.requestedFocus);
      } else if (formType === 'payment') {
        state.paymentBusy = true;
        render();
        const paymentDetails = await saveCandidatePaymentDetails({
          account_currency: formData.get('account_currency'),
          payment_method: formData.get('payment_method'),
          account_holder_name: formData.get('account_holder_name'),
          bank_name: formData.get('bank_name'),
          bank_location_or_country: formData.get('bank_location_or_country'),
          account_type: formData.get('account_type'),
          sort_code: formData.get('sort_code'),
          account_number: formData.get('account_number'),
          iban: formData.get('iban'),
          swift_bic: formData.get('swift_bic'),
        });
        state.paymentDetails = paymentDetails;
        state.authMessage = {
          tone: 'success',
          text: 'Payment details saved. HMJ can now use them for onboarding and payroll setup.',
        };
        if (onboardingSummary().hasRightToWork && paymentDetails?.completion?.complete) {
          state.onboardingPrompt = false;
          state.requestedFocus = '';
        }
        updateDashboardLocation(state.activeTab, state.requestedFocus);
      } else if (formType === 'email') {
        state.settingsBusy = true;
        render();
        await updateCandidateEmail(formData.get('email'));
        state.authMessage = {
          tone: 'success',
          text: 'Email update requested. Supabase will send confirmation instructions to the new address.',
        };
      } else if (formType === 'reset-link') {
        state.settingsBusy = true;
        render();
        await requestCandidatePasswordReset(formData.get('email'));
        state.authMessage = { tone: 'success', text: 'Password reset email sent. Check your inbox for the secure link.' };
      }
    } catch (error) {
      state.authMessage = {
        tone: 'error',
        text: error?.message || 'Dashboard update failed.',
      };
    } finally {
      state.dashboardBusy = false;
      state.settingsBusy = false;
      state.documentsBusy = false;
      state.paymentBusy = false;
      render();
    }
  }

  async function handleDashboardAction(event) {
    const button = event.target.closest('[data-dashboard-action],[data-dashboard-tab],[data-auth-mode],[data-auth-action],[data-document-delete],[data-dashboard-toggle],[data-scroll-to-register],[data-password-toggle]');
    if (!button) return;

    if (button.hasAttribute('data-password-toggle')) {
      const inputId = button.getAttribute('data-password-toggle');
      const input = doc.getElementById(inputId);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Show' : 'Hide';
      return;
    }

    if (button.hasAttribute('data-auth-mode')) {
      state.authMode = button.getAttribute('data-auth-mode');
      state.authMessage = null;
      render();
      return;
    }

    if (button.hasAttribute('data-scroll-to-register')) {
      accountToggle.checked = true;
      syncAccountControls();
      doc.getElementById('candidateRegisterAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        doc.getElementById('fname')?.focus();
      }, 240);
      return;
    }

    const authAction = button.getAttribute('data-auth-action');
    if (authAction === 'resend-verification') {
      const signInForm = authRoot.querySelector('[data-auth-form="signin"]');
      const email = trimText(signInForm?.elements?.email?.value, 320);
      await resendVerificationForEmail(email, 'auth');
      return;
    }

    if (authAction === 'resend-verification-from-form') {
      await resendVerificationForEmail(state.pendingEmail || form.querySelector('#email')?.value, 'form');
      return;
    }

    if (button.hasAttribute('data-dashboard-tab')) {
      const nextTab = button.getAttribute('data-dashboard-tab');
      const focusAttr = button.getAttribute('data-dashboard-focus');
      state.activeTab = nextTab;
      state.requestedFocus = typeof focusAttr === 'string' ? trimText(focusAttr, 80).toLowerCase() : state.requestedFocus;
      if (nextTab !== 'documents' && !focusAttr) {
        state.requestedFocus = '';
      }
      if (nextTab !== 'payment' && state.requestedFocus === 'payment_details') {
        state.requestedFocus = '';
      }
      if (nextTab !== 'documents' && !state.onboardingPrompt) {
        state.requestedDocuments = [];
      }
      updateDashboardLocation(state.activeTab, state.requestedFocus);
      render();
      return;
    }

    if (button.hasAttribute('data-document-delete')) {
      const documentId = button.getAttribute('data-document-delete');
      const documentRecord = state.documents.find((item) => String(item.id) === String(documentId));
      if (!documentRecord) return;
      if (!window.confirm('Delete this document from your candidate portal?')) return;
      try {
        state.documentsBusy = true;
        render();
        await deleteCandidateDocument(documentRecord);
        state.documents = await loadCandidateDocuments(state.candidate?.id);
        state.authMessage = { tone: 'success', text: 'Document deleted.' };
      } catch (error) {
        state.authMessage = { tone: 'error', text: error?.message || 'Document delete failed.' };
      } finally {
        state.documentsBusy = false;
        render();
      }
      return;
    }

    if (button.hasAttribute('data-dashboard-toggle')) {
      const toggleKey = button.getAttribute('data-dashboard-toggle');
      if (toggleKey === 'close-confirm') {
        state.closeConfirm = !state.closeConfirm;
        render();
      }
      return;
    }

    const action = button.getAttribute('data-dashboard-action');
    if (action === 'signout') {
      try {
        await signOutCandidate();
        state.user = null;
        state.session = null;
        state.candidate = null;
        state.applications = [];
        state.documents = [];
        state.paymentDetails = null;
        state.authMode = 'signin';
        state.closeConfirm = false;
        state.authMessage = { tone: 'success', text: 'Signed out.' };
        render();
      } catch (error) {
        state.authMessage = { tone: 'error', text: error?.message || 'Could not sign out.' };
        render();
      }
      return;
    }

    if (action === 'close-account') {
      if (!state.closeConfirm) return;
      const confirmed = window.confirm('Close your candidate portal account? You will lose self-service access, but HMJ may retain your recruitment record.');
      if (!confirmed) return;
      try {
        state.settingsBusy = true;
        render();
        await closeCandidateAccount();
        try {
          await signOutCandidate();
        } catch (error) {
          // Ignore local sign-out errors after account deletion.
        }
        state.user = null;
        state.session = null;
        state.candidate = null;
        state.applications = [];
        state.documents = [];
        state.paymentDetails = null;
        state.authMode = 'signin';
        state.closeConfirm = false;
        state.authMessage = { tone: 'success', text: 'Candidate portal account closed. You can still use the HMJ application form below.' };
      } catch (error) {
        state.authMessage = { tone: 'error', text: error?.message || 'Could not close the candidate account.' };
      } finally {
        state.settingsBusy = false;
        render();
      }
    }
  }

  function handleDashboardChange(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === 'onboarding_mode') {
      state.draftOnboardingMode = normaliseBooleanFlag(target.value);
      if (state.draftOnboardingMode && state.activeTab === 'settings') {
        state.activeTab = 'profile';
      }
      render();
      return;
    }
    if (!(target instanceof HTMLSelectElement)) return;
    const form = target.closest('[data-dashboard-form="payment"]');
    if (!form) return;

    const accountCurrency = trimText(form.querySelector('[name="account_currency"]')?.value, 12).toUpperCase() || 'GBP';
    const paymentMethod = form.querySelector('[name="payment_method"]')?.value || (accountCurrency === 'GBP' ? 'gbp_local' : 'iban_swift');
    state.paymentDetails = {
      ...(state.paymentDetails || {}),
      accountCurrency,
      paymentMethod,
    };
    render();
  }

  async function handleCandidateFormSubmit(event) {
    if (state.allowNativeSubmit) {
      state.allowNativeSubmit = false;
      state.formBusy = false;
      syncAccountControls();
      return;
    }

    if (!form.checkValidity()) {
      syncAccountControls();
      return;
    }

    const formData = new FormData(form);
    const creatingAccount = createAccountRequested();
    const submissionId = window.crypto?.randomUUID?.() || `candidate-${Date.now()}`;
    const paymentValidation = paymentValidationState();
    if (paymentValidation.active && !paymentValidation.valid) {
      event.preventDefault();
      state.formMessage = {
        tone: 'error',
        text: paymentValidation.text,
      };
      renderFormStatus();
      paymentValidation.focusField?.focus();
      syncAccountControls();
      return;
    }
    const paymentDetails = buildRegistrationPaymentDetails();
    const requiresSecurePaymentSync = !!paymentDetails;
    const payload = buildCandidateSyncPayload(formData, submissionId, paymentDetails);

    if (!creatingAccount) {
      event.preventDefault();
      state.formSyncSent = true;
      if (requiresSecurePaymentSync) {
        state.formBusy = true;
        syncAccountControls();
        try {
          await backgroundSyncCandidatePayload(payload, { awaitResponse: true });
        } catch (error) {
          state.formBusy = false;
          state.formMessage = {
            tone: 'error',
            text: error?.message || 'Secure payment details could not be saved. Please try again or leave the payment section closed if you only need portal access today.',
          };
          renderFormStatus();
          syncAccountControls();
          return;
        }
      } else {
        void backgroundSyncCandidatePayload(payload);
      }
      requestNativeFormSubmit('none');
      return;
    }

    const validation = passwordValidationState();
    if (!validation.valid) {
      event.preventDefault();
      syncAccountControls();
      passwordInput.focus();
      return;
    }

    event.preventDefault();
    state.formBusy = true;
    state.formSyncSent = true;
    syncAccountControls();

    const fullName = [formData.get('first_name'), formData.get('surname')]
      .map((value) => trimText(value, 120))
      .filter(Boolean)
      .join(' ');
    const email = trimText(formData.get('email'), 320).toLowerCase();
    setPendingCandidateEmail(email);
    state.pendingEmail = email;

    let accountState = 'created';
    try {
      const signupResult = await signUpCandidate({
        name: fullName,
        email,
        password: passwordInput.value,
      });
      const signupClassification = classifyCandidateSignupResult(signupResult);
      accountState = signupClassification.state;
      if (accountState === 'existing') {
        state.authMessage = {
          tone: 'warn',
          text: 'That email already has an HMJ candidate account. We will still send your profile now, and you can sign in or resend verification above.',
        };
      }
    } catch (error) {
      const message = authErrorMessage('signup', error);
      if ((error?.message || '').toLowerCase().includes('user already registered')) {
        accountState = 'existing';
      } else {
        accountState = 'failed';
      }
      state.authMessage = {
        tone: accountState === 'existing' ? 'warn' : 'warn',
        text: accountState === 'existing'
          ? 'That email already has an HMJ candidate account. We will still send your profile now.'
          : `${message} Your profile will still be sent to HMJ without blocking the live application workflow.`,
      };
    } finally {
      if (requiresSecurePaymentSync) {
        try {
          await backgroundSyncCandidatePayload(payload, { awaitResponse: true });
          requestNativeFormSubmit(accountState);
        } catch (error) {
          state.formBusy = false;
          state.formMessage = {
            tone: 'error',
            text: error?.message || 'Secure payment details could not be saved. Please try again or untick the payment section if you only need a portal account today.',
          };
          renderFormStatus();
          syncAccountControls();
        }
      } else {
        void backgroundSyncCandidatePayload(payload);
        requestNativeFormSubmit(accountState);
      }
    }
  }

  authRoot.addEventListener('submit', handleAuthForm);
  dashboardRoot.addEventListener('submit', handleDashboardForm);
  dashboardRoot.addEventListener('change', handleDashboardChange);
  authRoot.addEventListener('click', handleDashboardAction);
  form.addEventListener('click', handleDashboardAction);
  dashboardRoot.addEventListener('click', handleDashboardAction);
  formStatusRoot.addEventListener('click', handleDashboardAction);
  form.addEventListener('submit', handleCandidateFormSubmit);
  accountToggle.addEventListener('change', () => {
    syncAccountControls();
  });
  paymentToggle?.addEventListener('change', () => {
    state.formMessage = null;
    renderFormStatus();
    syncAccountControls();
  });
  paymentFields.currency?.addEventListener('change', () => {
    if (paymentFields.method) {
      paymentFields.method.value = trimText(paymentFields.currency?.value, 12).toUpperCase() === 'GBP' ? 'gbp_local' : 'iban_swift';
    }
    syncAccountControls();
  });
  paymentFields.method?.addEventListener('change', () => {
    syncAccountControls();
  });
  paymentInputs.forEach((input) => {
    input.addEventListener('input', () => {
      if (registrationPaymentEnabled()) {
        syncAccountControls();
      }
    });
  });
  [passwordInput, confirmPasswordInput].forEach((input) => {
    input.addEventListener('input', () => {
      syncAccountControls();
    });
  });
  syncAccountControls();

  initialiseAuthState().then(() => {
    onCandidateAuthStateChange(async ({ user, session }) => {
      state.user = user;
      state.session = session;
      if (user) {
        clearPendingCandidateEmail();
        state.pendingEmail = '';
        await refreshDashboard();
      } else {
        state.candidate = null;
        state.applications = [];
        state.documents = [];
        state.paymentDetails = null;
        state.activeTab = 'profile';
        state.requestedDocuments = parseRequestedDocumentList(params.get('candidate_docs'));
        state.closeConfirm = false;
        render();
      }
    }).then((unsubscribe) => {
      state.unsubscribe = unsubscribe;
    }).catch(() => {
      // Ignore subscription failures; the form fallback remains available.
    });
  });
})();
