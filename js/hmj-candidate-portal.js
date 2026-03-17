const CONFIG_ENDPOINT = '/.netlify/functions/candidate-auth-config';
const SYNC_ENDPOINT = '/.netlify/functions/candidate-portal-sync';
const DELETE_ENDPOINT = '/.netlify/functions/candidate-account-delete';
const DOCUMENTS_ENDPOINT = '/.netlify/functions/candidate-documents';
const PAYMENT_DETAILS_ENDPOINT = '/.netlify/functions/candidate-payment-details';
const STORAGE_PREFIX = 'portal';
const CANDIDATE_DOCS_BUCKET = 'candidate-docs';
const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'];

function getGlobalState() {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root.__hmjCandidatePortal) {
    root.__hmjCandidatePortal = {
      configPromise: null,
      clientPromise: null,
      supabaseModulePromise: null,
      authSubscription: null,
    };
  }
  return root.__hmjCandidatePortal;
}

function isLocalCandidateMockMode() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search || '');
  const host = String(window.location.hostname || '').toLowerCase();
  return params.get('candidate_mock') === '1' && (host === 'localhost' || host === '127.0.0.1');
}

function getMockStore() {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root.__hmjCandidatePortalLocalMockState) {
    root.__hmjCandidatePortalLocalMockState = {
      seq: 1,
      usersByEmail: {},
      currentUser: null,
      currentSession: null,
      candidate: null,
      applications: [],
      documents: [],
      paymentDetails: null,
      verificationEmailsSent: 0,
      resetEmailsSent: 0,
      subscribers: new Set(),
    };
  }
  return root.__hmjCandidatePortalLocalMockState;
}

function mockNextId(prefix) {
  const store = getMockStore();
  const id = `${prefix}-${store.seq}`;
  store.seq += 1;
  return id;
}

function mockSessionForUser(user) {
  return {
    access_token: `mock-token-${user.id}`,
    token_type: 'bearer',
    user,
  };
}

function emitMockAuthState(eventName) {
  const store = getMockStore();
  store.subscribers.forEach((callback) => {
    try {
      callback({
        event: eventName,
        session: store.currentSession,
        user: store.currentUser,
      });
    } catch (error) {
      // Ignore individual subscriber failures in local mock mode.
    }
  });
}

function lowerMockEmail(value) {
  return lowerEmail(value);
}

function ensureMockCandidate(seed = {}, user = null) {
  const store = getMockStore();
  const email = lowerMockEmail(seed.email || user?.email);
  if (!email && !store.candidate) {
    throw new Error('candidate_email_required');
  }

  if (!store.candidate) {
    const fullName = trimText(seed.name || seed.full_name || user?.user_metadata?.full_name, 240);
    const split = splitName(fullName);
    store.candidate = {
      id: mockNextId('candidate'),
      auth_user_id: user?.id || null,
      email: email || null,
      first_name: trimText(seed.first_name || split.firstName, 120) || null,
      last_name: trimText(seed.last_name || seed.surname || split.lastName, 120) || null,
      full_name: trimText(fullName || `${split.firstName} ${split.lastName}`.trim(), 240) || null,
      skills: [],
      right_to_work_regions: [],
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  if (email) store.candidate.email = email;
  if (user?.id) {
    store.candidate.auth_user_id = user.id;
  }
  return store.candidate;
}

function cloneMockRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureMockUserForEmail(email) {
  const store = getMockStore();
  return store.usersByEmail[lowerMockEmail(email)] || null;
}

function findMockUserById(userId) {
  const store = getMockStore();
  return Object.values(store.usersByEmail).find((user) => String(user?.id || '') === String(userId || '')) || null;
}

function publicMockUser(user) {
  if (!user) return null;
  const clone = cloneMockRecord(user);
  delete clone.password;
  return clone;
}

function mockPortalConfig() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8765';
  return {
    ok: true,
    supabaseUrl: 'mock://candidate-portal',
    supabaseAnonKey: 'mock-anon-key',
    siteUrl: origin,
    emailRedirectUrl: `${origin}/candidates.html?candidate_auth=verified&candidate_mock=1`,
    recoveryRedirectUrl: `${origin}/candidates.html?candidate_action=recovery&candidate_mock=1`,
    recoveryRedirectPath: '/candidates.html?candidate_action=recovery&candidate_mock=1',
    emailRedirectPath: '/candidates.html?candidate_auth=verified&candidate_mock=1',
  };
}

function applyMockCandidateSeed(seed = {}, user = null) {
  const store = getMockStore();
  const existing = ensureMockCandidate(seed, user);
  const payload = buildCandidateProfilePayload(seed, {
    user,
    includeCreatedAt: !existing?.created_at,
  });
  const merged = {
    ...existing,
    ...payload,
    id: existing.id,
    auth_user_id: user?.id || payload.auth_user_id || existing.auth_user_id || null,
    email: payload.email || existing.email || user?.email || null,
    created_at: existing.created_at || payload.created_at || new Date().toISOString(),
    updated_at: payload.updated_at || new Date().toISOString(),
    status: payload.status || existing.status || 'active',
  };
  store.candidate = merged;
  return merged;
}

function resolveMockUserFromAccessToken(accessToken) {
  const match = /^mock-token-(.+)$/.exec(String(accessToken || ''));
  if (!match) return null;
  return findMockUserById(match[1]);
}

function trimText(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimText(value, 320);
  return email ? email.toLowerCase() : '';
}

function normaliseSkillList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value == null ? '' : value).split(/[\n,]/);

  const out = [];
  const seen = new Set();
  items.forEach((item) => {
    const skill = trimText(item, 80);
    if (!skill) return;
    const key = skill.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(skill);
  });
  return out;
}

function normaliseTextList(value, maxLength = 120) {
  const items = Array.isArray(value)
    ? value
    : String(value == null ? '' : value).split(/[\n,]/);

  const out = [];
  const seen = new Set();
  items.forEach((item) => {
    const entry = trimText(item, maxLength);
    if (!entry) return;
    const key = entry.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}

function normaliseSalaryExpectationUnit(value) {
  const raw = trimText(value, 40).toLowerCase();
  if (!raw) return '';
  if (raw === 'hour' || raw === 'hourly' || raw === 'per_hour') return 'hourly';
  if (raw === 'day' || raw === 'daily' || raw === 'per_day') return 'daily';
  if (raw === 'year' || raw === 'annual_salary' || raw === 'per_year') return 'annual';
  return ['annual', 'daily', 'hourly'].includes(raw) ? raw : '';
}

function normaliseBooleanFlag(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = trimText(value, 16).toLowerCase();
  if (!text) return null;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return null;
}

function salaryExpectationSuffix(unit) {
  if (unit === 'hourly') return 'per hour';
  if (unit === 'daily') return 'per day';
  if (unit === 'annual') return 'per year';
  return '';
}

function formatSalaryExpectation(value, unit) {
  const raw = trimText(value, 160);
  if (!raw) return '';
  if (/per\s+(hour|day|year)/i.test(raw)) return raw;
  const normalizedUnit = normaliseSalaryExpectationUnit(unit);
  if (!normalizedUnit) return raw;
  const numeric = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return `${raw} ${salaryExpectationSuffix(normalizedUnit)}`.trim();
  const maxFractionDigits = normalizedUnit === 'annual' || Number.isInteger(numeric) ? 0 : 2;
  const formatted = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(numeric);
  return `${formatted} ${salaryExpectationSuffix(normalizedUnit)}`;
}

function normalisePaymentMethodInput(value, currency) {
  const raw = trimText(value, 40).toLowerCase();
  if (raw === 'gbp_local' || raw === 'gbp') return 'gbp_local';
  if (raw === 'iban_swift' || raw === 'international' || raw === 'eur') return 'iban_swift';
  return trimText(currency, 12).toUpperCase() === 'GBP' ? 'gbp_local' : 'iban_swift';
}

function maskValue(value, visible = 4) {
  const text = trimText(value, 80);
  if (!text) return '';
  if (text.length <= visible) return text;
  return `${'•'.repeat(Math.max(0, text.length - visible))}${text.slice(-visible)}`;
}

function maskSortCode(sortCode) {
  const digits = trimText(sortCode, 24).replace(/\D+/g, '');
  if (!digits) return '';
  return digits.length >= 2 ? `••-••-${digits.slice(-2)}` : maskValue(digits, 1);
}

function maskIban(iban) {
  const clean = trimText(iban, 64).replace(/\s+/g, '').toUpperCase();
  if (!clean) return '';
  if (clean.length <= 8) return maskValue(clean, 4);
  return `${clean.slice(0, 4)} ${'•'.repeat(Math.max(0, clean.length - 8))}${clean.slice(-4)}`;
}

function mockPaymentSummary(input = {}, existing = null) {
  const accountCurrency = trimText(input.account_currency || input.payment_currency || existing?.accountCurrency, 12).toUpperCase() || 'GBP';
  const paymentMethod = normalisePaymentMethodInput(input.payment_method || existing?.paymentMethod, accountCurrency);
  const sortCode = trimText(input.sort_code || '', 24).replace(/\D+/g, '');
  const accountNumber = trimText(input.account_number || '', 24).replace(/\D+/g, '');
  const iban = trimText(input.iban || '', 64).replace(/\s+/g, '').toUpperCase();
  const swiftBic = trimText(input.swift_bic || '', 32).replace(/\s+/g, '').toUpperCase();
  const complete = paymentMethod === 'gbp_local'
    ? !!(trimText(input.account_holder_name || existing?.accountHolderName, 160)
      && trimText(input.bank_name || existing?.bankName, 160)
      && trimText(input.bank_location_or_country || existing?.bankLocationOrCountry, 160)
      && sortCode.length === 6
      && accountNumber.length >= 6)
    : !!(trimText(input.account_holder_name || existing?.accountHolderName, 160)
      && trimText(input.bank_name || existing?.bankName, 160)
      && trimText(input.bank_location_or_country || existing?.bankLocationOrCountry, 160)
      && iban.length >= 15
      && swiftBic.length >= 8);
  return {
    id: existing?.id || `payment-${Date.now()}`,
    candidateId: existing?.candidateId || null,
    accountCurrency,
    paymentMethod,
    accountHolderName: trimText(input.account_holder_name || existing?.accountHolderName, 160),
    bankName: trimText(input.bank_name || existing?.bankName, 160),
    bankLocationOrCountry: trimText(input.bank_location_or_country || existing?.bankLocationOrCountry, 160),
    accountType: trimText(input.account_type || existing?.accountType, 80),
    masked: {
      sortCode: sortCode ? maskSortCode(sortCode) : (existing?.masked?.sortCode || ''),
      accountNumber: accountNumber ? maskValue(accountNumber, 4) : (existing?.masked?.accountNumber || ''),
      iban: iban ? maskIban(iban) : (existing?.masked?.iban || ''),
      swiftBic: swiftBic ? maskValue(swiftBic, 4) : (existing?.masked?.swiftBic || ''),
    },
    lastFour: accountNumber ? accountNumber.slice(-4) : (iban ? iban.slice(-4) : (existing?.lastFour || '')),
    verifiedAt: existing?.verifiedAt || null,
    updatedAt: new Date().toISOString(),
    completion: {
      complete,
      missing: complete ? [] : ['payment_details'],
    },
  };
}

function parsePositiveInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function splitName(value) {
  const full = trimText(value, 240);
  if (!full) {
    return { firstName: '', lastName: '', fullName: '' };
  }
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', fullName: parts[0] };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.slice(-1).join(' '),
    fullName: parts.join(' '),
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyFilename(name) {
  const clean = trimText(name, 240)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'document';
}

function fileExtensionFromName(name) {
  const match = /\.([a-z0-9]+)$/i.exec(trimText(name, 280));
  return match ? match[1].toLowerCase() : '';
}

function normaliseDocumentType(value) {
  const raw = trimText(value, 80).toLowerCase();
  if (!raw) return 'other';
  if (raw === 'cv' || raw === 'resume') return 'cv';
  if (raw === 'cover letter' || raw === 'cover_letter') return 'cover_letter';
  if (raw === 'certification' || raw === 'certificate') return 'certificate';
  if (raw === 'qualification_certificate' || raw === 'qualification / certificate') return 'qualification_certificate';
  if (raw === 'passport') return 'passport';
  if (raw === 'right to work' || raw === 'right_to_work') return 'right_to_work';
  if (raw === 'visa_permit' || raw === 'visa / permit' || raw === 'visa' || raw === 'permit') return 'visa_permit';
  if (raw === 'reference' || raw === 'references') return 'reference';
  if (raw === 'bank_document' || raw === 'bank document') return 'bank_document';
  return 'other';
}

function missingColumnError(error) {
  const message = String(error?.message || '');
  return (
    /column "?[a-zA-Z0-9_]+"? does not exist/i.test(message)
    || /Could not find the '[a-zA-Z0-9_]+' column of '[^']+' in the schema cache/i.test(message)
  );
}

function extractMissingColumnName(error) {
  const message = String(error?.message || '');
  const postgresMatch = /column "?([a-zA-Z0-9_]+)"? does not exist/i.exec(message);
  if (postgresMatch) return postgresMatch[1];
  const schemaCacheMatch = /Could not find the '([a-zA-Z0-9_]+)' column of '[^']+' in the schema cache/i.exec(message);
  return schemaCacheMatch ? schemaCacheMatch[1] : null;
}

function missingRelationError(error) {
  return /relation .+ does not exist/i.test(String(error?.message || ''));
}

async function parseJsonResponse(response) {
  return response.json().catch(() => ({}));
}

function resolveCandidateRedirectUrl(config, fullUrlKey, pathKey) {
  const explicit = trimText(config?.[fullUrlKey], 1000);
  if (explicit) return explicit;

  const path = trimText(config?.[pathKey], 400);
  if (!path) return window.location.origin;

  const base = trimText(config?.siteUrl, 1000) || window.location.origin;
  return new URL(path, base).toString();
}

async function postCandidatePortalJson(url, body, accessToken) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || 'Candidate portal request failed.');
  }
  return payload;
}

async function loadSupabaseModule() {
  const state = getGlobalState();
  if (!state.supabaseModulePromise) {
    state.supabaseModulePromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  }
  return state.supabaseModulePromise;
}

export async function getCandidatePortalConfig() {
  if (isLocalCandidateMockMode()) {
    return mockPortalConfig();
  }

  const state = getGlobalState();
  if (!state.configPromise) {
    state.configPromise = fetch(CONFIG_ENDPOINT, {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        const message = payload?.message || 'Candidate account tools are unavailable right now.';
        throw new Error(message);
      }
      return payload;
    });
  }
  return state.configPromise;
}

export async function getCandidatePortalClient() {
  if (isLocalCandidateMockMode()) {
    return null;
  }

  const state = getGlobalState();
  if (!state.clientPromise) {
    state.clientPromise = (async () => {
      const [{ createClient }, config] = await Promise.all([
        loadSupabaseModule(),
        getCandidatePortalConfig(),
      ]);

      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    })();
  }
  return state.clientPromise;
}

export async function getCandidatePortalContext() {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    return {
      client: null,
      config: mockPortalConfig(),
      session: store.currentSession ? cloneMockRecord(store.currentSession) : null,
      user: store.currentUser ? cloneMockRecord(store.currentUser) : null,
    };
  }

  const [client, config] = await Promise.all([
    getCandidatePortalClient(),
    getCandidatePortalConfig(),
  ]);
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const session = data?.session || null;
  return {
    client,
    config,
    session,
    user: session?.user || null,
  };
}

export async function getCandidatePortalSession() {
  const { session, user, client, config } = await getCandidatePortalContext();
  return { session, user, client, config };
}

export async function onCandidateAuthStateChange(callback) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    store.subscribers.add(callback);
    return () => {
      store.subscribers.delete(callback);
    };
  }

  const client = await getCandidatePortalClient();
  const state = getGlobalState();
  if (state.authSubscription) {
    state.authSubscription.unsubscribe();
  }
  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback({
      event,
      session,
      user: session?.user || null,
    });
  });
  state.authSubscription = data?.subscription || null;
  return () => {
    state.authSubscription?.unsubscribe?.();
    state.authSubscription = null;
  };
}

function buildCandidateProfilePayload(input = {}, options = {}) {
  const fullName = trimText(input.full_name || input.name, 240);
  const split = splitName(fullName);
  const salaryExpectationUnit = normaliseSalaryExpectationUnit(input.salary_expectation_unit || input.salary_unit || input.salary_expectation_basis);
  const payload = {
    auth_user_id: trimText(options.user?.id || input.auth_user_id, 120) || null,
    email: lowerEmail(input.email || options.user?.email),
    first_name: trimText(input.first_name || split.firstName, 120) || null,
    last_name: trimText(input.last_name || input.surname || split.lastName, 120) || null,
    full_name: trimText(fullName || `${split.firstName} ${split.lastName}`.trim(), 240) || null,
    phone: trimText(input.phone, 80) || null,
    address1: trimText(input.address1, 240) || null,
    address2: trimText(input.address2, 240) || null,
    town: trimText(input.town, 160) || null,
    county: trimText(input.county, 160) || null,
    postcode: trimText(input.postcode, 32) || null,
    country: trimText(input.country, 120) || null,
    location: trimText(input.location || input.current_location, 240) || null,
    nationality: trimText(input.nationality, 120) || null,
    right_to_work_status: trimText(input.right_to_work_status, 240) || null,
    right_to_work_regions: normaliseTextList(input.right_to_work_regions || input.right_to_work, 120),
    primary_specialism: trimText(input.primary_specialism || input.discipline, 240) || null,
    secondary_specialism: trimText(input.secondary_specialism, 240) || null,
    current_job_title: trimText(input.current_job_title, 240) || null,
    desired_roles: trimText(input.desired_roles || input.roles_looking_for || input.role, 320) || null,
    experience_years: parsePositiveInteger(input.experience_years ?? input.years_experience),
    qualifications: trimText(input.qualifications, 4000) || null,
    sector_experience: trimText(input.sector_experience, 1000) || null,
    relocation_preference: trimText(input.relocation_preference || input.relocation, 120) || null,
    salary_expectation: formatSalaryExpectation(input.salary_expectation, salaryExpectationUnit) || null,
    salary_expectation_unit: salaryExpectationUnit || null,
    sector_focus: trimText(input.sector_focus || input.sector_experience || input.discipline, 240) || null,
    skills: normaliseSkillList(input.skills),
    availability: trimText(input.availability || input.notice_period, 160) || null,
    linkedin_url: trimText(input.linkedin_url || input.linkedin, 500) || null,
    summary: trimText(input.summary || input.message, 4000) || null,
    headline_role: trimText(
      input.headline_role
      || input.desired_roles
      || input.role
      || input.current_job_title
      || input.job_title,
      240
    ) || null,
    updated_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(input, 'onboarding_mode') || Object.prototype.hasOwnProperty.call(input, 'onboardingMode')) {
    payload.onboarding_mode = normaliseBooleanFlag(input.onboarding_mode ?? input.onboardingMode);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'emergency_name') || Object.prototype.hasOwnProperty.call(input, 'next_of_kin_name')) {
    payload.emergency_name = trimText(input.emergency_name || input.next_of_kin_name, 240) || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'emergency_phone') || Object.prototype.hasOwnProperty.call(input, 'next_of_kin_phone')) {
    payload.emergency_phone = trimText(input.emergency_phone || input.next_of_kin_phone, 80) || null;
  }

  if (options.includeCreatedAt) {
    payload.created_at = new Date().toISOString();
    payload.status = trimText(input.status, 80) || 'active';
  }

  return payload;
}

async function syncCandidateProfileViaFunction(seed = {}) {
  const { session } = await getCandidatePortalContext();
  if (!session?.access_token) {
    throw new Error('candidate_not_authenticated');
  }

  return postCandidatePortalJson(SYNC_ENDPOINT, {
    source: 'candidate_portal_bootstrap',
    candidate: seed,
    access_token: session.access_token,
  }, session.access_token);
}

async function candidateDocumentsRequest(action, payload = {}) {
  const { session } = await getCandidatePortalContext();
  if (!session?.access_token) {
    throw new Error('candidate_not_authenticated');
  }
  return postCandidatePortalJson(DOCUMENTS_ENDPOINT, {
    action,
    ...payload,
    access_token: session.access_token,
  }, session.access_token);
}

async function candidatePaymentRequest(action, payload = {}) {
  const { session } = await getCandidatePortalContext();
  if (!session?.access_token) {
    throw new Error('candidate_not_authenticated');
  }
  return postCandidatePortalJson(PAYMENT_DETAILS_ENDPOINT, {
    action,
    ...payload,
    access_token: session.access_token,
  }, session.access_token);
}

async function loadCandidateRowByAuthUserId(client, authUserId) {
  const { data, error } = await client
    .from('candidates')
    .select('*')
    .eq('auth_user_id', authUserId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function tryRecordCandidateActivity(client, payload) {
  if (!payload?.candidate_id || !payload?.activity_type) return;
  try {
    const insertPayload = {
      candidate_id: payload.candidate_id,
      activity_type: payload.activity_type,
      description: payload.description || null,
      actor_role: payload.actor_role || 'candidate',
      actor_identifier: payload.actor_identifier || null,
      meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
      created_at: payload.created_at || new Date().toISOString(),
    };
    const { error } = await client.from('candidate_activity').insert(insertPayload);
    if (error && (missingColumnError(error) || missingRelationError(error))) {
      await client.from('candidate_activity').insert({
        candidate_id: payload.candidate_id,
        activity_type: payload.activity_type,
        description: payload.description || null,
        created_at: payload.created_at || new Date().toISOString(),
      });
      return;
    }
    if (error) throw error;
  } catch (error) {
    if (!missingRelationError(error)) {
      throw error;
    }
  }
}

function buildCandidateDocumentPayload({ file, documentType, label, candidateId, userId, storagePath }) {
  const originalFilename = trimText(file?.name, 280) || 'document';
  const extension = fileExtensionFromName(originalFilename);
  const normalisedType = normaliseDocumentType(documentType);
  return {
    candidate_id: String(candidateId),
    owner_auth_user_id: trimText(userId, 120) || null,
    document_type: normalisedType,
    label: trimText(label, 240) || (normalisedType === 'cv' ? 'CV' : trimText(documentType, 80) || 'Supporting document'),
    original_filename: originalFilename,
    filename: originalFilename,
    file_extension: extension || null,
    mime_type: trimText(file?.type, 120) || null,
    file_size_bytes: Number(file?.size || 0) || null,
    storage_bucket: CANDIDATE_DOCS_BUCKET,
    storage_path: storagePath,
    storage_key: storagePath,
    uploaded_at: new Date().toISOString(),
    meta: {
      uploaded_via: 'candidate_portal',
      owner_user_id: trimText(userId, 120) || null,
    },
  };
}

function validateCandidateDocument(file) {
  if (!(file instanceof File) || !file.name) {
    throw new Error('Choose a file before uploading.');
  }
  const extension = fileExtensionFromName(file.name);
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)) {
    throw new Error('Upload a PDF, Word document, or image file.');
  }
  if (Number(file.size || 0) > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error('Files must be 15 MB or smaller.');
  }
}

async function insertCandidateDocumentRecord(client, payload) {
  const richInsert = await client
    .from('candidate_documents')
    .insert(payload)
    .select('*')
    .single();

  if (!richInsert.error) return richInsert;
  if (!missingColumnError(richInsert.error)) {
    return richInsert;
  }

  return client
    .from('candidate_documents')
    .insert({
      candidate_id: payload.candidate_id,
      document_type: payload.document_type,
      label: payload.label,
      filename: payload.filename,
      storage_key: payload.storage_key,
      url: null,
      meta: payload.meta,
      created_at: payload.uploaded_at,
    })
    .select('*')
    .single();
}

async function queryCandidateDocuments(client, candidateId) {
  return client
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId));
}

async function retryWithoutUnknownColumns(run, payload) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await run(working);
    if (!result?.error) return result;
    if (!missingColumnError(result.error)) return result;
    const missingColumn = extractMissingColumnName(result.error);
    if (!missingColumn || !(missingColumn in working)) return result;
    delete working[missingColumn];
  }
  return run(working);
}

export async function ensureCandidateProfileRow(seed = {}) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (!store.currentUser?.id) {
      throw new Error('candidate_not_authenticated');
    }
    return cloneMockRecord(applyMockCandidateSeed(seed, store.currentUser));
  }

  const { client, user } = await getCandidatePortalContext();
  if (!user?.id) {
    throw new Error('candidate_not_authenticated');
  }

  const existing = await loadCandidateRowByAuthUserId(client, user.id);
  if (existing) return existing;

  try {
    await syncCandidateProfileViaFunction(buildCandidateProfilePayload(seed, {
      user,
      includeCreatedAt: true,
    }));
  } catch (error) {
    const directInsertPayload = buildCandidateProfilePayload(seed, {
      user,
      includeCreatedAt: true,
    });
    const directInsert = await retryWithoutUnknownColumns(
      (working) => client
        .from('candidates')
        .insert(working)
        .select('*')
        .single(),
      directInsertPayload
    );
    const inserted = directInsert?.data;
    const insertError = directInsert?.error;
    if (!insertError && inserted) {
      return inserted;
    }
    if (insertError && !missingColumnError(insertError)) {
      throw error?.message ? error : insertError;
    }
  }

  const synced = await loadCandidateRowByAuthUserId(client, user.id);
  if (synced) return synced;
  throw new Error('Candidate profile could not be loaded.');
}

export async function loadCandidateProfile() {
  return ensureCandidateProfileRow();
}

export async function saveCandidateProfile(input = {}) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (!store.currentUser?.id) {
      throw new Error('candidate_not_authenticated');
    }
    const saved = applyMockCandidateSeed(input, store.currentUser);
    return cloneMockRecord(saved);
  }

  const { client, user } = await getCandidatePortalContext();
  const candidate = await ensureCandidateProfileRow(input);
  const payload = buildCandidateProfilePayload(input, { user });
  const candidateId = String(candidate.id);

  const updateResult = await retryWithoutUnknownColumns(
    (working) => client
      .from('candidates')
      .update(working)
      .eq('id', candidate.id)
      .select('*')
      .single(),
    payload
  );
  const data = updateResult?.data;
  const error = updateResult?.error;

  if (error) throw error;

  const skills = normaliseSkillList(input.skills);
  const deleteResult = await client
    .from('candidate_skills')
    .delete()
    .eq('candidate_id', candidateId);

  if (deleteResult.error && !/relation .+ does not exist/i.test(deleteResult.error.message || '')) {
    throw deleteResult.error;
  }

  if (skills.length) {
    const insertSkills = await client
      .from('candidate_skills')
      .insert(skills.map((skill) => ({
        candidate_id: candidateId,
        skill,
      })));

    if (insertSkills.error && !/relation .+ does not exist/i.test(insertSkills.error.message || '')) {
      throw insertSkills.error;
    }
  }

  await tryRecordCandidateActivity(client, {
    candidate_id: candidateId,
    activity_type: 'profile_updated',
    description: 'Profile updated from the candidate dashboard.',
    actor_role: 'candidate',
    actor_identifier: user?.id || null,
    meta: {
      source: 'candidate_dashboard',
    },
  }).catch(() => null);

  return data;
}

export async function loadCandidateApplications(candidateIdInput) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const candidateId = String(candidateIdInput || store.candidate?.id || '');
    return cloneMockRecord(
      store.applications
        .filter((application) => !candidateId || String(application.candidate_id) === candidateId)
        .sort((left, right) => String(right.applied_at || '').localeCompare(String(left.applied_at || '')))
    );
  }

  const { client } = await getCandidatePortalContext();
  const candidate = candidateIdInput ? { id: candidateIdInput } : await ensureCandidateProfileRow();
  const { data, error } = await client
    .from('job_applications')
    .select('*')
    .eq('candidate_id', String(candidate.id))
    .order('applied_at', { ascending: false });

  if (error && (missingRelationError(error) || missingColumnError(error))) {
    return [];
  }
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function createDocumentDownloadUrl(client, storageKey) {
  if (!storageKey) return '';
  const { data, error } = await client
    .storage
    .from(CANDIDATE_DOCS_BUCKET)
    .createSignedUrl(storageKey, 3600);
  if (error) return '';
  return data?.signedUrl || '';
}

export async function loadCandidateDocuments(candidateIdInput) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const candidateId = String(candidateIdInput || store.candidate?.id || '');
    return cloneMockRecord(
      store.documents
        .filter((documentRow) => !candidateId || String(documentRow.candidate_id) === candidateId)
        .sort((left, right) => String(right.uploaded_at || '').localeCompare(String(left.uploaded_at || '')))
    );
  }

  const { client, session } = await getCandidatePortalContext();
  if (session?.access_token) {
    try {
      const response = await candidateDocumentsRequest('list');
      const documents = Array.isArray(response?.documents) ? response.documents : [];
      return documents.sort((left, right) => {
        const leftDate = String(left?.uploaded_at || left?.created_at || '');
        const rightDate = String(right?.uploaded_at || right?.created_at || '');
        return rightDate.localeCompare(leftDate);
      });
    } catch (error) {
      console.warn('[candidate-portal] document list endpoint failed, falling back to direct query', error?.message || error);
    }
  }

  const candidate = candidateIdInput ? { id: candidateIdInput } : await ensureCandidateProfileRow();
  const { data, error } = await queryCandidateDocuments(client, candidate.id);

  if (error && (missingRelationError(error) || missingColumnError(error))) {
    return [];
  }
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const withUrls = await Promise.all(rows.map(async (row) => ({
    ...row,
    download_url: (row.storage_path || row.storage_key)
      ? await createDocumentDownloadUrl(client, row.storage_path || row.storage_key)
      : (row.url || ''),
  })));

  return withUrls.sort((left, right) => {
    const leftDate = String(left?.uploaded_at || left?.created_at || '');
    const rightDate = String(right?.uploaded_at || right?.created_at || '');
    return rightDate.localeCompare(leftDate);
  });
}

export async function loadCandidatePaymentDetails() {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    return cloneMockRecord(store.paymentDetails || {
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
      verifiedAt: null,
      updatedAt: null,
      completion: {
        complete: false,
        missing: ['payment_details'],
      },
    });
  }

  const response = await candidatePaymentRequest('get');
  return response?.paymentDetails || null;
}

export async function saveCandidatePaymentDetails(input = {}) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    store.paymentDetails = mockPaymentSummary(input, store.paymentDetails);
    return cloneMockRecord(store.paymentDetails);
  }

  const response = await candidatePaymentRequest('save', {
    paymentDetails: input,
  });
  return response?.paymentDetails || null;
}

export async function uploadCandidateDocument({ file, documentType, label }) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (!store.currentUser?.id) {
      throw new Error('candidate_not_authenticated');
    }
    const candidate = applyMockCandidateSeed({}, store.currentUser);
    validateCandidateDocument(file);
    const safeName = slugifyFilename(file?.name || 'document');
    const uploadedAt = new Date().toISOString();
    const documentRow = {
      id: mockNextId('document'),
      candidate_id: String(candidate.id),
      owner_auth_user_id: store.currentUser.id,
      document_type: normaliseDocumentType(documentType),
      label: trimText(label, 240) || trimText(file?.name, 280) || 'Document',
      original_filename: trimText(file?.name, 280) || 'document',
      filename: trimText(file?.name, 280) || 'document',
      file_extension: fileExtensionFromName(safeName) || null,
      mime_type: trimText(file?.type, 120) || null,
      file_size_bytes: Number(file?.size || 0) || null,
      storage_bucket: CANDIDATE_DOCS_BUCKET,
      storage_path: `${STORAGE_PREFIX}/${store.currentUser.id}/${Date.now()}-${safeName}`,
      storage_key: `${STORAGE_PREFIX}/${store.currentUser.id}/${Date.now()}-${safeName}`,
      uploaded_at: uploadedAt,
      created_at: uploadedAt,
      updated_at: uploadedAt,
      download_url: '#mock-document',
    };
    store.documents.unshift(documentRow);
    return cloneMockRecord(documentRow);
  }

  const { client, user, session } = await getCandidatePortalContext();
  validateCandidateDocument(file);

  let signedUploadCompleted = false;
  let signedUploadPath = '';
  if (session?.access_token && user?.id) {
    try {
      const prepared = await candidateDocumentsRequest('prepare_upload', {
        file_name: trimText(file?.name, 280) || 'document',
        mime_type: trimText(file?.type, 120) || null,
        size_bytes: Number(file?.size || 0) || 0,
        document_type: documentType,
        label,
      });
      const uploadTarget = prepared?.upload || {};
      signedUploadPath = trimText(uploadTarget.path, 500) || '';
      if (!signedUploadPath || !trimText(uploadTarget.token, 2000)) {
        throw new Error('A secure upload link could not be prepared.');
      }

      const signedUpload = await client
        .storage
        .from(trimText(uploadTarget.bucket, 120) || CANDIDATE_DOCS_BUCKET)
        .uploadToSignedUrl(
          signedUploadPath,
          uploadTarget.token,
          file,
          {
            cacheControl: '3600',
            contentType: trimText(file?.type, 120) || undefined,
          }
        );

      if (signedUpload.error) throw signedUpload.error;
      signedUploadCompleted = true;

      const completed = await candidateDocumentsRequest('finalize_upload', {
        storage_path: signedUploadPath,
        file_name: trimText(file?.name, 280) || 'document',
        mime_type: trimText(file?.type, 120) || null,
        size_bytes: Number(file?.size || 0) || 0,
        document_type: documentType,
        label,
      });

      if (!completed?.document) {
        throw new Error('Document upload completed but the candidate record could not be updated.');
      }
      return completed.document;
    } catch (error) {
      if (signedUploadCompleted) {
        throw error;
      }
      console.warn('[candidate-portal] signed document upload failed, falling back to direct Supabase upload', error?.message || error);
    }
  }

  const candidate = await ensureCandidateProfileRow();
  const safeName = slugifyFilename(file?.name || 'document');
  const storageKey = `${STORAGE_PREFIX}/${user.id}/${Date.now()}-${safeName}`;

  const upload = await client
    .storage
    .from(CANDIDATE_DOCS_BUCKET)
    .upload(storageKey, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (upload.error) throw upload.error;

  const documentPayload = buildCandidateDocumentPayload({
    file,
    documentType,
    label,
    candidateId: candidate.id,
    userId: user.id,
    storagePath: storageKey,
  });

  const insert = await insertCandidateDocumentRecord(client, documentPayload);

  if (insert.error) throw insert.error;

  await tryRecordCandidateActivity(client, {
    candidate_id: String(candidate.id),
    activity_type: 'document_uploaded',
    description: `${documentPayload.label || 'Document'} uploaded from the candidate dashboard.`,
    actor_role: 'candidate',
    actor_identifier: user.id,
    meta: {
      source: 'candidate_dashboard',
      document_id: insert.data?.id || null,
      document_type: documentPayload.document_type,
      storage_path: storageKey,
    },
  }).catch(() => null);

  return {
    ...insert.data,
    download_url: await createDocumentDownloadUrl(client, storageKey),
  };
}

export async function deleteCandidateDocument(documentRecord) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    store.documents = store.documents.filter((item) => String(item.id) !== String(documentRecord?.id));
    return true;
  }

  const { client, user, session } = await getCandidatePortalContext();
  const candidate = await ensureCandidateProfileRow();
  const documentId = documentRecord?.id;
  const storageKey = trimText(documentRecord?.storage_path || documentRecord?.storage_key, 500);
  if (!documentId) {
    throw new Error('candidate_document_id_required');
  }

  if (session?.access_token) {
    try {
      await candidateDocumentsRequest('delete', {
        document_id: documentId,
      });
      return true;
    } catch (error) {
      console.warn('[candidate-portal] document delete endpoint failed, falling back to direct delete', error?.message || error);
    }
  }

  if (storageKey && storageKey.startsWith(`${STORAGE_PREFIX}/${user.id}/`)) {
    await client.storage.from(CANDIDATE_DOCS_BUCKET).remove([storageKey]);
  }

  const { error } = await client
    .from('candidate_documents')
    .delete()
    .eq('id', documentId);

  if (error) throw error;

  await tryRecordCandidateActivity(client, {
    candidate_id: String(candidate.id),
    activity_type: 'document_deleted',
    description: `${trimText(documentRecord?.label || documentRecord?.original_filename || documentRecord?.filename, 240) || 'Document'} deleted from the candidate dashboard.`,
    actor_role: 'candidate',
    actor_identifier: user.id,
    meta: {
      source: 'candidate_dashboard',
      document_id: documentId,
      storage_path: storageKey || null,
    },
  }).catch(() => null);
  return true;
}

export async function signUpCandidate({ name, email, password }) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const cleanEmail = lowerEmail(email);
    const existing = ensureMockUserForEmail(cleanEmail);
    if (existing) {
      return {
        user: {
          ...publicMockUser(existing),
          identities: [],
        },
        session: null,
      };
    }

    const split = splitName(name);
    const user = {
      id: mockNextId('user'),
      email: cleanEmail,
      password: String(password || ''),
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      user_metadata: {
        full_name: trimText(name, 240) || cleanEmail,
        first_name: split.firstName,
        last_name: split.lastName,
      },
      identities: [{ identity_id: mockNextId('identity'), provider: 'email' }],
    };
    store.usersByEmail[cleanEmail] = user;
    store.verificationEmailsSent += 1;
    applyMockCandidateSeed({ name, email: cleanEmail }, publicMockUser(user));
    return {
      user: publicMockUser(user),
      session: null,
    };
  }

  const { client, config } = await getCandidatePortalContext();
  const redirectTo = resolveCandidateRedirectUrl(config, 'emailRedirectUrl', 'emailRedirectPath');
  const fullName = trimText(name, 240);
  const { data, error } = await client.auth.signUp({
    email: lowerEmail(email),
    password,
    options: {
      emailRedirectTo: redirectTo,
      data: {
        full_name: fullName,
        first_name: splitName(fullName).firstName,
        last_name: splitName(fullName).lastName,
      },
    },
  });

  if (error) throw error;

  if (data?.user && data?.session) {
    await syncCandidateProfileViaFunction({
      name: fullName,
      email,
    }).catch(() => null);
  }

  return data;
}

export async function signInCandidate({ email, password }) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const cleanEmail = lowerEmail(email);
    const user = ensureMockUserForEmail(cleanEmail);
    if (!user || user.password !== String(password || '')) {
      throw new Error('Invalid login credentials');
    }
    if (!user.email_confirmed_at) {
      throw new Error('Email not confirmed');
    }
    const publicUser = publicMockUser(user);
    const session = mockSessionForUser(publicUser);
    store.currentUser = publicUser;
    store.currentSession = session;
    applyMockCandidateSeed({ email: cleanEmail }, publicUser);
    emitMockAuthState('SIGNED_IN');
    return {
      user: cloneMockRecord(publicUser),
      session: cloneMockRecord(session),
    };
  }

  const { client } = await getCandidatePortalContext();
  const { data, error } = await client.auth.signInWithPassword({
    email: lowerEmail(email),
    password,
  });
  if (error) throw error;
  await syncCandidateProfileViaFunction({
    email,
  }).catch(() => null);
  return data;
}

export async function resendCandidateVerification(email) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const user = ensureMockUserForEmail(email);
    if (!user) {
      throw new Error('That email does not have an HMJ candidate account yet.');
    }
    store.verificationEmailsSent += 1;
    return { sent: true };
  }

  const { client, config } = await getCandidatePortalContext();
  const redirectTo = resolveCandidateRedirectUrl(config, 'emailRedirectUrl', 'emailRedirectPath');
  const { data, error } = await client.auth.resend({
    type: 'signup',
    email: lowerEmail(email),
    options: {
      emailRedirectTo: redirectTo,
    },
  });
  if (error) throw error;
  return data;
}

export async function requestCandidatePasswordReset(email) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const cleanEmail = lowerEmail(email);
    const user = ensureMockUserForEmail(cleanEmail);
    if (!user) {
      throw new Error('That email does not have an HMJ candidate account yet.');
    }
    store.resetEmailsSent += 1;
    return { sent: true };
  }

  const { client, config, user } = await getCandidatePortalContext();
  const redirectTo = resolveCandidateRedirectUrl(config, 'recoveryRedirectUrl', 'recoveryRedirectPath');
  const { data, error } = await client.auth.resetPasswordForEmail(lowerEmail(email), {
    redirectTo,
  });
  if (error) throw error;
  if (user?.id && lowerEmail(user.email) === lowerEmail(email)) {
    try {
      const candidate = await ensureCandidateProfileRow();
      await tryRecordCandidateActivity(client, {
        candidate_id: String(candidate.id),
        activity_type: 'password_reset_requested',
        description: 'Password reset email requested from the candidate portal.',
        actor_role: 'candidate',
        actor_identifier: user.id,
        meta: {
          source: 'candidate_settings',
        },
      });
    } catch (activityError) {
      // Do not block the reset email flow if activity logging fails.
    }
  }
  return data;
}

export async function updateCandidatePassword(password) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (!store.currentUser?.id) {
      throw new Error('candidate_not_authenticated');
    }
    const user = findMockUserById(store.currentUser.id);
    if (!user) {
      throw new Error('candidate_not_authenticated');
    }
    user.password = String(password || '');
    return { user: publicMockUser(user) };
  }

  const { client } = await getCandidatePortalContext();
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function updateCandidateEmail(email) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (!store.currentUser?.id) {
      throw new Error('candidate_not_authenticated');
    }
    const cleanEmail = lowerEmail(email);
    const user = findMockUserById(store.currentUser.id);
    if (!user) {
      throw new Error('candidate_not_authenticated');
    }
    delete store.usersByEmail[lowerMockEmail(user.email)];
    user.email = cleanEmail;
    user.email_confirmed_at = null;
    store.usersByEmail[cleanEmail] = user;
    store.verificationEmailsSent += 1;
    store.currentUser = publicMockUser(user);
    if (store.currentSession) {
      store.currentSession.user = publicMockUser(user);
    }
    applyMockCandidateSeed({ email: cleanEmail }, store.currentUser);
    emitMockAuthState('USER_UPDATED');
    return { user: cloneMockRecord(store.currentUser) };
  }

  const { client } = await getCandidatePortalContext();
  const { data, error } = await client.auth.updateUser({ email: lowerEmail(email) });
  if (error) throw error;
  return data;
}

export async function signOutCandidate() {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    store.currentUser = null;
    store.currentSession = null;
    emitMockAuthState('SIGNED_OUT');
    return true;
  }

  const { client } = await getCandidatePortalContext();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  return true;
}

export async function closeCandidateAccount() {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (!store.currentUser?.id) {
      throw new Error('candidate_not_authenticated');
    }
    const candidate = applyMockCandidateSeed({}, store.currentUser);
    candidate.status = 'archived';
    candidate.portal_account_closed_at = new Date().toISOString();
    store.currentUser = null;
    store.currentSession = null;
    emitMockAuthState('SIGNED_OUT');
    return { ok: true };
  }

  const { session } = await getCandidatePortalContext();
  if (!session?.access_token) {
    throw new Error('candidate_not_authenticated');
  }

  const response = await fetch(DELETE_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || 'Candidate account could not be closed.');
  }

  return payload;
}

export async function buildBackgroundSyncPayload(basePayload = {}) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    if (store.currentSession?.access_token) {
      return {
        ...basePayload,
        access_token: store.currentSession.access_token,
      };
    }
    return { ...basePayload };
  }

  const payload = { ...basePayload };
  try {
    const { session } = await getCandidatePortalContext();
    if (session?.access_token) {
      payload.access_token = session.access_token;
    }
  } catch (error) {
    // Auth is optional for public form syncs.
  }
  return payload;
}

export async function backgroundSyncCandidatePayload(basePayload = {}, options = {}) {
  if (isLocalCandidateMockMode()) {
    const store = getMockStore();
    const payload = await buildBackgroundSyncPayload(basePayload);
    if (payload?.candidate && typeof payload.candidate === 'object') {
      applyMockCandidateSeed(payload.candidate, store.currentUser);
    }
    if (payload?.application && typeof payload.application === 'object' && store.candidate?.id) {
      store.applications.unshift({
        id: mockNextId('application'),
        candidate_id: String(store.candidate.id),
        applied_at: new Date().toISOString(),
        status: 'submitted',
        ...cloneMockRecord(payload.application),
      });
    }
    return true;
  }

  const payload = await buildBackgroundSyncPayload(basePayload);
  const body = JSON.stringify(payload);
  const awaitResponse = options && options.awaitResponse === true;

  if (!awaitResponse && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    const accepted = navigator.sendBeacon(SYNC_ENDPOINT, blob);
    if (accepted) return true;
  }

  try {
    const response = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    });
    if (!awaitResponse) {
      return response.ok;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.message || data?.error || 'Candidate profile sync failed.');
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (awaitResponse) {
      throw error;
    }
    return false;
  }
}

export function candidateDocumentIsPortalOwned(documentRecord, userId) {
  const storageKey = trimText(documentRecord?.storage_path || documentRecord?.storage_key, 500);
  return !!(storageKey && userId && storageKey.startsWith(`${STORAGE_PREFIX}/${userId}/`));
}

export {
  escapeHtml,
  lowerEmail,
  normaliseDocumentType,
  normaliseSkillList,
  splitName,
  trimText,
};
