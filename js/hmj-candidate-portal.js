const CONFIG_ENDPOINT = '/.netlify/functions/candidate-auth-config';
const SYNC_ENDPOINT = '/.netlify/functions/candidate-portal-sync';
const DELETE_ENDPOINT = '/.netlify/functions/candidate-account-delete';
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
  if (raw === 'right to work' || raw === 'right_to_work') return 'right_to_work';
  return 'other';
}

function missingColumnError(error) {
  return /column "?[a-zA-Z0-9_]+"? does not exist/i.test(String(error?.message || ''));
}

function missingRelationError(error) {
  return /relation .+ does not exist/i.test(String(error?.message || ''));
}

async function parseJsonResponse(response) {
  return response.json().catch(() => ({}));
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
          flowType: 'pkce',
        },
      });
    })();
  }
  return state.clientPromise;
}

export async function getCandidatePortalContext() {
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
  const payload = {
    auth_user_id: trimText(options.user?.id || input.auth_user_id, 120) || null,
    email: lowerEmail(input.email || options.user?.email),
    first_name: trimText(input.first_name || split.firstName, 120) || null,
    last_name: trimText(input.last_name || input.surname || split.lastName, 120) || null,
    full_name: trimText(fullName || `${split.firstName} ${split.lastName}`.trim(), 240) || null,
    phone: trimText(input.phone, 80) || null,
    location: trimText(input.location || input.current_location, 240) || null,
    sector_focus: trimText(input.sector_focus || input.discipline, 240) || null,
    skills: normaliseSkillList(input.skills),
    availability: trimText(input.availability || input.notice_period, 160) || null,
    linkedin_url: trimText(input.linkedin_url || input.linkedin, 500) || null,
    summary: trimText(input.summary || input.message, 4000) || null,
    headline_role: trimText(input.headline_role || input.role || input.job_title, 240) || null,
    updated_at: new Date().toISOString(),
  };

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
  const withDeletedFilter = await client
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (!withDeletedFilter.error || !missingColumnError(withDeletedFilter.error)) {
    return withDeletedFilter;
  }

  return client
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .order('created_at', { ascending: false });
}

export async function ensureCandidateProfileRow(seed = {}) {
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
    const { data: inserted, error: insertError } = await client
      .from('candidates')
      .insert(directInsertPayload)
      .select('*')
      .single();
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
  const { client, user } = await getCandidatePortalContext();
  const candidate = await ensureCandidateProfileRow(input);
  const payload = buildCandidateProfilePayload(input, { user });
  const candidateId = String(candidate.id);

  const { data, error } = await client
    .from('candidates')
    .update(payload)
    .eq('id', candidate.id)
    .select('*')
    .single();

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
  const { client } = await getCandidatePortalContext();
  const candidate = candidateIdInput ? { id: candidateIdInput } : await ensureCandidateProfileRow();
  const { data, error } = await client
    .from('job_applications')
    .select('*')
    .eq('candidate_id', String(candidate.id))
    .order('applied_at', { ascending: false });

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
  const { client } = await getCandidatePortalContext();
  const candidate = candidateIdInput ? { id: candidateIdInput } : await ensureCandidateProfileRow();
  const { data, error } = await queryCandidateDocuments(client, candidate.id);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const withUrls = await Promise.all(rows.map(async (row) => ({
    ...row,
    download_url: (row.storage_path || row.storage_key)
      ? await createDocumentDownloadUrl(client, row.storage_path || row.storage_key)
      : (row.url || ''),
  })));

  return withUrls;
}

export async function uploadCandidateDocument({ file, documentType, label }) {
  const { client, user } = await getCandidatePortalContext();
  const candidate = await ensureCandidateProfileRow();
  validateCandidateDocument(file);
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
  const { client, user } = await getCandidatePortalContext();
  const candidate = await ensureCandidateProfileRow();
  const documentId = documentRecord?.id;
  const storageKey = trimText(documentRecord?.storage_path || documentRecord?.storage_key, 500);
  if (!documentId) {
    throw new Error('candidate_document_id_required');
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
  const { client, config } = await getCandidatePortalContext();
  const redirectTo = new URL(config.emailRedirectPath, window.location.origin).toString();
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

export async function requestCandidatePasswordReset(email) {
  const { client, config, user } = await getCandidatePortalContext();
  const redirectTo = new URL(config.recoveryRedirectPath, window.location.origin).toString();
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
  const { client } = await getCandidatePortalContext();
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function updateCandidateEmail(email) {
  const { client } = await getCandidatePortalContext();
  const { data, error } = await client.auth.updateUser({ email: lowerEmail(email) });
  if (error) throw error;
  return data;
}

export async function signOutCandidate() {
  const { client } = await getCandidatePortalContext();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  return true;
}

export async function closeCandidateAccount() {
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

export async function backgroundSyncCandidatePayload(basePayload = {}) {
  const payload = await buildBackgroundSyncPayload(basePayload);
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    const accepted = navigator.sendBeacon(SYNC_ENDPOINT, blob);
    if (accepted) return true;
  }

  try {
    await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    });
    return true;
  } catch (error) {
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
