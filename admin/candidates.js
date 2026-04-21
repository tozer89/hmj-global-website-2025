/* eslint-disable no-console */
(function () {
  'use strict';

  const STORAGE_KEY = 'hmj:candidates:filters:v2';
  const SELECTION_KEY = 'hmj:candidates:selection';
  const ROW_HEIGHT = 112;
  const RENDER_PADDING = 6;
  const MAX_LOGS = 10;
  const assignmentHelpers = window.HMJCandidateActiveAssignments || {};

  const STATUS_META = {
    active: { label: 'Active', tone: 'green' },
    'in progress': { label: 'In progress', tone: 'blue' },
    complete: { label: 'Complete', tone: 'green' },
    archived: { label: 'Archived', tone: 'gray' },
    blocked: { label: 'Blocked', tone: 'red' },
    'timesheet portal': { label: 'TSP raw', tone: 'blue' },
    invited: { label: 'Invited — awaiting registration', tone: 'purple' },
    cancelled: { label: 'Cancelled', tone: 'gray' },
  };
  const ONBOARDING_STATUS_META = {
    new: { label: 'New', tone: 'blue' },
    awaiting_documents: { label: 'Awaiting documents', tone: 'orange' },
    awaiting_verification: { label: 'Awaiting verification', tone: 'orange' },
    ready_for_payroll: { label: 'Ready for payroll', tone: 'green' },
    onboarding_complete: { label: 'Onboarding complete', tone: 'green' },
    archived: { label: 'Archived', tone: 'gray' },
  };

  const DEFAULT_FILTERS = Object.freeze({
    query: '',
    candidateType: '',
    onboardingStatus: '',
    status: [],
    role: '',
    region: '',
    skills: [],
    availability: '',
    createdFrom: '',
    createdTo: ''
  });
  const SOURCE_TABS = Object.freeze({
    website: { label: 'Website only' },
    'timesheet-portal-active': { label: 'TSP active assignments' },
    'timesheet-portal': { label: 'Timesheet Portal only' },
    combined: { label: 'Combined / all' }
  });
  const BULK_EMAIL_PRESETS = Object.freeze({
    general_update: {
      subject: 'HMJ Global update for <FIRST_NAME>',
      heading: 'An update from HMJ Global',
      body: 'Hi <FIRST_NAME>,\n\nWe are getting in touch with a quick update on your HMJ candidate profile.\n\nIf anything has changed with your availability, role focus, or current assignment with <CLIENT_NAME>, use the HMJ button below to review the next step in your account.\n\nIf you need anything from the team, reply to this email and we will update your record.',
      primaryAction: 'portal_access',
      includeTimesheets: false,
    },
    onboarding_request: {
      subject: 'HMJ onboarding update for <FIRST_NAME>',
      heading: 'Complete your HMJ onboarding',
      body: 'Hi <FIRST_NAME>,\n\nWe are progressing your HMJ setup for <CLIENT_NAME> and need you to review the next onboarding step.\n\nUse the HMJ button below to open the correct secure area for your documents and profile updates. This is especially important if you are working as <JOB_TITLE> or are already preparing to start.\n\nOnce you have reviewed the requested items, HMJ can keep your mobilisation moving.',
      primaryAction: 'documents_upload',
      includeTimesheets: true,
    },
    availability_check: {
      subject: 'HMJ check-in for <FIRST_NAME>',
      heading: 'A quick HMJ check-in',
      body: 'Hi <FIRST_NAME>,\n\nWe are checking whether your HMJ profile is still current for upcoming work.\n\nIf your availability, location, preferred role, or current client details have changed, use the HMJ button below to review your profile and keep your record up to date.\n\nThis helps the team move faster when the right vacancy or assignment comes in.',
      primaryAction: 'portal_access',
      includeTimesheets: false,
    },
  });

  const elements = {};
  const rowsInner = document.createElement('div');
  rowsInner.className = 'rows-inner';
  rowsInner.style.position = 'relative';
  rowsInner.style.width = '100%';

  const state = {
    helpers: null,
    identity: null,
    raw: [],
    filtered: [],
    selection: new Set(),
    filters: loadFilters(),
    sourceTab: 'website',
    quickSearch: '',
    sort: { key: 'updated_at', dir: 'desc' },
    drawerId: null,
    supabaseMode: 'unknown',
    cacheMode: false,
    lastQueryMs: 0,
    logs: [],
    debugOpen: false,
    metrics: { total: 0, progress: 0, ready: 0, rtwMissing: 0, toVerify: 0, archived: 0, blocked: 0 },
    importFile: null,
    importFileData: '',
    importPreview: null,
    tspCompare: null,
    verificationQueue: null,
    pendingDocRequest: null,
    pendingBulkEmail: null,
    outreachDiagnostics: null,
    assignmentRows: [],
    assignmentLookups: null,
    assignmentLoading: false
  };

  const REQUESTABLE_DOC_TYPES = ['passport', 'qualification_certificate', 'reference', 'right_to_work', 'visa_permit', 'bank_document'];
  const DOCUMENT_TYPE_OPTIONS = [
    { value: 'passport', label: 'Passport' },
    { value: 'right_to_work', label: 'Right to work' },
    { value: 'visa_permit', label: 'Visa / permit' },
    { value: 'qualification_certificate', label: 'Qualification / certificate' },
    { value: 'reference', label: 'Reference' },
    { value: 'bank_document', label: 'Bank document' },
    { value: 'cv', label: 'CV / resume' },
    { value: 'cover_letter', label: 'Cover letter' },
    { value: 'other', label: 'Other' }
  ];
  const DOCUMENT_GROUPS = [
    { title: 'Right to work', description: 'Passports, RTW evidence, visas, and immigration files.', types: ['passport', 'right_to_work', 'visa_permit'] },
    { title: 'Qualifications & certificates', description: 'Tickets, cards, qualifications, and certification evidence.', types: ['qualification_certificate'] },
    { title: 'References', description: 'Reference letters or supporting referee documents.', types: ['reference'] },
    { title: 'Bank documents', description: 'Void cheque or other supporting payroll documents if required.', types: ['bank_document'] },
    { title: 'CV & cover letters', description: 'General candidate profile documents.', types: ['cv', 'cover_letter'] },
    { title: 'Other documents', description: 'Anything that does not fit the core onboarding categories.', types: ['other'] }
  ];

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadFilters() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { ...DEFAULT_FILTERS };
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_FILTERS,
        ...parsed,
        status: Array.isArray(parsed?.status) ? parsed.status.map((v) => String(v).toLowerCase()) : []
      };
    } catch (err) {
      console.warn('[candidates] filter restore failed', err);
      return { ...DEFAULT_FILTERS };
    }
  }

  function saveFilters(filters) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch (err) {
      console.warn('[candidates] filter persist failed', err);
    }
  }

  function loadSelection() {
    try {
      const stored = localStorage.getItem(SELECTION_KEY);
      if (!stored) return;
      const ids = JSON.parse(stored);
      if (Array.isArray(ids)) ids.forEach((id) => state.selection.add(String(id)));
    } catch (err) {
      console.warn('[candidates] selection restore failed', err);
    }
  }

  function readLaunchParams() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return {
        candidateId: String(params.get('candidate_id') || params.get('candidate') || '').trim(),
        query: String(params.get('q') || '').trim(),
      };
    } catch (err) {
      console.warn('[candidates] unable to read launch params', err);
      return { candidateId: '', query: '' };
    }
  }

  function persistSelection() {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(Array.from(state.selection)));
    } catch (err) {
      console.warn('[candidates] selection persist failed', err);
    }
  }

  function pushLog(entry) {
    const record = { ...entry, at: new Date().toISOString() };
    state.logs.unshift(record);
    if (state.logs.length > MAX_LOGS) state.logs.length = MAX_LOGS;
    renderDebugPanel();
  }

  function statusLabel(status) {
    const key = String(status || '').toLowerCase();
    return STATUS_META[key]?.label || (status ? String(status) : 'In progress');
  }

  function statusTone(status) {
    const key = String(status || '').toLowerCase();
    return STATUS_META[key]?.tone || 'orange';
  }

  function onboardingStatusKey(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'awaiting documents' || raw === 'awaiting-documents') return 'awaiting_documents';
    if (raw === 'awaiting verification' || raw === 'awaiting-verification') return 'awaiting_verification';
    if (raw === 'ready for payroll' || raw === 'ready-for-payroll') return 'ready_for_payroll';
    if (raw === 'onboarding complete' || raw === 'complete') return 'onboarding_complete';
    return ONBOARDING_STATUS_META[raw] ? raw : 'new';
  }

  function onboardingStatusLabel(value) {
    return ONBOARDING_STATUS_META[onboardingStatusKey(value)]?.label || 'New';
  }

  function onboardingStatusTone(value) {
    return ONBOARDING_STATUS_META[onboardingStatusKey(value)]?.tone || 'blue';
  }

  function onboardingViewActive() {
    return state.filters.candidateType === 'starter';
  }

  function parseSkills(value) {
    if (!value && value !== 0) return [];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    return String(value)
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function lowerEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    return email || '';
  }

  function normalizeReferenceValue(value) {
    return String(value || '').trim().toLowerCase();
  }

  function sourceTabLabel(tab = state.sourceTab) {
    return SOURCE_TABS[tab]?.label || SOURCE_TABS.website.label;
  }

  function activeAssignmentHelpersReady() {
    return typeof assignmentHelpers.buildAssignmentLookups === 'function'
      && typeof assignmentHelpers.summariseCandidateAssignments === 'function';
  }

  function isRawTimesheetPortalCandidate(candidate) {
    return String(candidate?.source_kind || '').toLowerCase() === 'timesheet-portal';
  }

  function isOutreachSelectableRawCandidate(candidate) {
    return isRawTimesheetPortalCandidate(candidate)
      && !!String(candidate?.email || '').trim()
      && Number(candidate?.active_assignment_count || 0) > 0;
  }

  function isSelectableCandidate(candidate, options = {}) {
    if (!candidate) return false;
    if (!isRawTimesheetPortalCandidate(candidate)) return true;
    return options.allowRaw === true && isOutreachSelectableRawCandidate(candidate);
  }

  function currentSelectionOptions() {
    return state.sourceTab === 'timesheet-portal-active'
      ? { allowRaw: true }
      : {};
  }

  function normalizeAssignmentRecord(row) {
    if (!row) return null;
    if (typeof assignmentHelpers.normaliseAssignmentRow === 'function') {
      return assignmentHelpers.normaliseAssignmentRow(row);
    }
    return {
      id: row.id,
      candidate_id: row.candidate_id || null,
      reference: row.as_ref || row.reference || null,
      as_ref: row.as_ref || null,
      status: String(row.status || 'draft').toLowerCase(),
      active: row.active !== false,
      candidate_name: row.candidate_name || null,
      client_code: row.client_code || null,
      client_name: row.client_name || null,
      job_title: row.job_title || null,
      assignment_description: row.assignment_description || row.job_title || null,
      branch_name: row.branch_name || row.client_site || null,
      cost_centre: row.cost_centre || null,
      ir35_status: row.ir35_status || null,
      assigned_approvers: row.assigned_approvers || null,
      assigned_contractors: row.assigned_contractors || row.candidate_name || null,
      assignment_category: row.assignment_category || null,
      last_modified: row.last_modified || null,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      currency: row.currency || 'GBP',
      rate_pay: row.rate_pay == null ? null : Number(row.rate_pay),
      rate_std: row.rate_std == null ? null : Number(row.rate_std),
    };
  }

  function summarizeCandidateAssignments(candidate) {
    if (!activeAssignmentHelpersReady()) {
      return { assignments: [], count: 0, primary: null };
    }
    return assignmentHelpers.summariseCandidateAssignments(candidate, state.assignmentLookups || {});
  }

  function buildTimesheetPortalLookups(rows) {
    const byEmail = new Map();
    const byReference = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const email = lowerEmail(row?.email);
      const reference = normalizeReferenceValue(row?.reference || row?.accountingReference);
      if (email && !byEmail.has(email)) byEmail.set(email, row);
      if (reference && !byReference.has(reference)) byReference.set(reference, row);
    });
    return { byEmail, byReference };
  }

  function buildWebsiteLookups(rows) {
    const byEmail = new Map();
    const byReference = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const email = lowerEmail(row?.email);
      const reference = normalizeReferenceValue(row?.ref || row?.payroll_ref);
      if (email && !byEmail.has(email)) byEmail.set(email, row);
      if (reference && !byReference.has(reference)) byReference.set(reference, row);
    });
    return { byEmail, byReference };
  }

  function findTimesheetPortalMatch(candidate, lookups) {
    if (!candidate || !lookups) return null;
    const email = lowerEmail(candidate.email);
    if (email && lookups.byEmail?.has(email)) return lookups.byEmail.get(email);
    const reference = normalizeReferenceValue(candidate.ref || candidate.payroll_ref);
    if (reference && lookups.byReference?.has(reference)) return lookups.byReference.get(reference);
    return null;
  }

  function findWebsiteMatch(candidate, lookups) {
    if (!candidate || !lookups) return null;
    const email = lowerEmail(candidate.email);
    if (email && lookups.byEmail?.has(email)) return lookups.byEmail.get(email);
    const reference = normalizeReferenceValue(candidate.ref || candidate.payroll_ref);
    if (reference && lookups.byReference?.has(reference)) return lookups.byReference.get(reference);
    return null;
  }

  function normalizeDocumentRequestType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'qualification' || raw === 'qualification certificate' || raw === 'certificate' || raw === 'certificates') return 'qualification_certificate';
    if (raw === 'right to work' || raw === 'right-to-work' || raw === 'rtw') return 'right_to_work';
    if (raw === 'visa' || raw === 'permit' || raw === 'visa / permit') return 'visa_permit';
    if (raw === 'reference' || raw === 'references' || raw === 'referee') return 'reference';
    if (raw === 'bank' || raw === 'bank document') return 'bank_document';
    if (raw === 'passport') return 'passport';
    return '';
  }

  function documentRequestLabel(value) {
    if (value === 'passport') return 'Passport';
    if (value === 'qualification_certificate') return 'Qualification / certificate';
    if (value === 'right_to_work') return 'Right to work';
    if (value === 'visa_permit') return 'Visa / permit';
    if (value === 'bank_document') return 'Bank document';
    if (value === 'reference') return 'Reference';
    if (value === 'cv') return 'CV / resume';
    if (value === 'cover_letter') return 'Cover letter';
    if (value === 'other') return 'Other';
    return 'Document';
  }

  function documentTypeLabel(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'Other';
    const normalized = normalizeDocumentRequestType(raw) || raw.replace(/\s+/g, '_');
    return documentRequestLabel(normalized);
  }

  function documentVerificationMeta(doc) {
    const status = String(doc?.verification_status || '').trim().toLowerCase();
    if (status === 'verified') return { label: 'Verified', tone: 'green' };
    if (status === 'rejected') return { label: 'Needs re-upload', tone: 'red' };
    if (doc?.verification_required) return { label: 'To verify', tone: 'orange' };
    return { label: 'Stored', tone: 'gray' };
  }

  function evidenceTypeLabel(value) {
    const key = String(value || '').trim().toLowerCase();
    if (key === 'passport') return 'Passport';
    if (key === 'id_card') return 'ID card';
    if (key === 'visa') return 'Visa';
    if (key === 'brp') return 'BRP';
    if (key === 'share_code') return 'Share code';
    if (key === 'settlement') return 'Settlement';
    if (key === 'other') return 'Other';
    return 'Not set';
  }

  function humanizeMissingField(value) {
    const key = String(value || '').trim().toLowerCase();
    const labels = {
      full_name: 'Name',
      email: 'Email',
      phone: 'Mobile',
      address: 'Address',
      location: 'Current location',
      nationality: 'Nationality',
      discipline: 'Discipline',
      current_job_title: 'Current job title',
      assignment_start_date: 'Assignment start date',
      right_to_work_regions: 'Authorised work regions',
      right_to_work_evidence_type: 'Right-to-work evidence type',
      right_to_work_upload: 'Right-to-work upload',
      payment_details: 'Payroll details',
      emergency_contact: 'Emergency contact',
      consent: 'Consent',
      cv: 'CV',
      qualifications: 'Qualifications',
      linkedin: 'LinkedIn',
      summary: 'Summary / notes',
      right_to_work: 'Right to work',
    };
    return labels[key] || key.replace(/_/g, ' ');
  }

  function lastEmailSentAt(history = {}, ...keys) {
    return keys
      .map((key) => history?.[key] || '')
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || '';
  }

  function formatDocumentRequestList(list) {
    const labels = (Array.isArray(list) ? list : []).map((item) => documentRequestLabel(item));
    if (!labels.length) return 'documents';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels.slice(-1)}`;
  }

  function onboardingRequestLabel(requestType, documentTypes = []) {
    const type = String(requestType || '').trim().toLowerCase() || 'rtw';
    if (type === 'general') return 'onboarding reminder';
    if (type === 'verification_complete') return 'verification complete email';
    if (type === 'documents') return `${formatDocumentRequestList(documentTypes).toLowerCase()} request`;
    return 'right-to-work reminder';
  }

  function buildCandidateUploadLink({ requestType = 'documents', documentTypes = [] } = {}) {
    const url = new URL('/candidates', window.location.origin);
    url.searchParams.set('candidate_tab', 'documents');
    url.searchParams.set('candidate_focus', requestType === 'rtw' ? 'right_to_work' : 'documents');
    url.searchParams.set('candidate_onboarding', '1');
    const requested = (Array.isArray(documentTypes) ? documentTypes : [])
      .map((value) => normalizeDocumentRequestType(value))
      .filter((value, index, list) => value && list.indexOf(value) === index);
    if (requested.length) url.searchParams.set('candidate_docs', requested.join(','));
    return url.toString();
  }

  function renderDocumentRequestDialogOptions(selected = []) {
    if (!elements.docRequestOptions) return;
    const chosen = new Set(
      (Array.isArray(selected) ? selected : [])
        .map((value) => normalizeDocumentRequestType(value))
        .filter(Boolean)
    );
    elements.docRequestOptions.innerHTML = REQUESTABLE_DOC_TYPES
      .map((type) => `
        <label class="drawer-field" style="display:flex;align-items:flex-start;gap:10px">
          <input type="checkbox" data-doc-request-type="${type}" ${chosen.has(type) ? 'checked' : ''} />
          <span>
            <strong>${escapeHtml(documentRequestLabel(type))}</strong>
            <span class="muted" style="display:block;font-size:12px">${type === 'right_to_work'
              ? 'Passport, share code, visa, or formal RTW evidence.'
              : type === 'qualification_certificate'
              ? 'Cards, tickets, qualifications, or certification proof.'
              : type === 'reference'
              ? 'Reference letters or referee support documents.'
              : type === 'bank_document'
              ? 'Void cheque or payroll support document.'
              : type === 'passport'
              ? 'Passport ID pages.'
              : 'Visa or permit evidence.'}</span>
          </span>
        </label>
      `)
      .join('');
  }

  function closeDocumentRequestDialog() {
    state.pendingDocRequest = null;
    const dialog = elements.docRequestDialog;
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function selectedDocumentRequestTypes() {
    if (!elements.docRequestOptions) return [];
    return Array.from(elements.docRequestOptions.querySelectorAll('[data-doc-request-type]:checked'))
      .map((input) => normalizeDocumentRequestType(input.dataset.docRequestType || input.value))
      .filter((value, index, list) => value && list.indexOf(value) === index);
  }

  function openDocumentRequestDialog(candidateIds, defaultTypes = []) {
    const ids = (Array.isArray(candidateIds) ? candidateIds : [])
      .map((value) => String(value))
      .filter(Boolean);
    if (!ids.length) {
      showToast('Select candidates first.', 'warn', 2800);
      return;
    }
    const requested = Array.isArray(defaultTypes) && defaultTypes.length
      ? defaultTypes
      : ['passport', 'qualification_certificate', 'reference'];
    state.pendingDocRequest = {
      candidateIds: ids,
      defaultTypes: requested,
    };
    renderDocumentRequestDialogOptions(requested);
    if (elements.docRequestSend) {
      elements.docRequestSend.textContent = `Send request${ids.length === 1 ? '' : ` to ${ids.length} candidates`}`;
      elements.docRequestSend.disabled = false;
    }
    if (elements.docRequestDialog) {
      if (typeof elements.docRequestDialog.showModal === 'function') elements.docRequestDialog.showModal();
      else elements.docRequestDialog.setAttribute('open', 'open');
    }
  }

  function bulkEmailPrimaryActionMeta(action) {
    if (action === 'documents_upload') {
      return {
        value: 'documents_upload',
        label: 'Open HMJ documents',
        previewCopy: 'Use the HMJ button below to open your documents area securely.',
      };
    }
    if (action === 'timesheets') {
      return {
        value: 'timesheets',
        label: 'Open HMJ timesheets / portal access',
        previewCopy: 'Use the HMJ button below to open the HMJ timesheets path.',
      };
    }
    return {
      value: 'portal_access',
      label: 'Open secure HMJ access',
      previewCopy: 'Use the HMJ button below to open the correct secure HMJ access path.',
    };
  }

  function buildBulkEmailRecipient(candidate) {
    const rawNameParts = String(candidate?.name || '').trim().split(/\s+/).filter(Boolean);
    const assignment = candidate?.active_assignment_summary || null;
    const firstName = String(candidate?.first_name || rawNameParts[0] || '').trim();
    const lastName = String(candidate?.last_name || rawNameParts.slice(1).join(' ') || '').trim();
    const fullName = String(candidate?.name || [firstName, lastName].filter(Boolean).join(' ') || '').trim();
    return {
      candidateId: String(candidate?.id || '').trim(),
      firstName,
      lastName,
      fullName,
      email: lowerEmail(candidate?.email),
      reference: String(candidate?.payroll_ref || candidate?.ref || '').trim(),
      role: String(candidate?.role || candidate?.headline_role || '').trim(),
      clientName: String(assignment?.client_name || '').trim(),
      jobTitle: String(assignment?.job_title || candidate?.role || candidate?.headline_role || '').trim(),
      onboardingMode: candidate?.onboarding_mode === true,
      activeAssignmentCount: Number(candidate?.active_assignment_count || 0),
    };
  }

  function preferredBulkEmailCandidate(rows = []) {
    return rows
      .slice()
      .sort((left, right) => {
        const score = (candidate) => {
          let total = 0;
          if (!isRawTimesheetPortalCandidate(candidate)) total += 100;
          if (candidate?.onboarding_mode === true) total += 20;
          if (Number(candidate?.active_assignment_count || 0) > 0) total += 10;
          if (String(candidate?.ref || candidate?.payroll_ref || '').trim()) total += 5;
          if (String(candidate?.phone || '').trim()) total += 2;
          return total;
        };
        return score(right) - score(left);
      })[0] || null;
  }

  function buildBulkEmailAudience(rows = []) {
    const selectedRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const groups = new Map();
    const missingEmail = [];
    selectedRows.forEach((candidate) => {
      const email = lowerEmail(candidate?.email);
      if (!email) {
        missingEmail.push(candidate);
        return;
      }
      const current = groups.get(email) || [];
      current.push(candidate);
      groups.set(email, current);
    });

    const deliverableRows = [];
    const duplicates = [];
    groups.forEach((rowsForEmail) => {
      const preferred = preferredBulkEmailCandidate(rowsForEmail);
      if (preferred) deliverableRows.push(preferred);
      rowsForEmail.forEach((candidate) => {
        if (preferred && String(candidate?.id) !== String(preferred.id)) duplicates.push(candidate);
      });
    });

    return {
      selectedCount: selectedRows.length,
      deliverableRows,
      duplicates,
      missingEmail,
      requiresPromotion: deliverableRows.some((candidate) => isRawTimesheetPortalCandidate(candidate)),
      previewRecipient: deliverableRows.length ? buildBulkEmailRecipient(deliverableRows[0]) : null,
    };
  }

  function bulkEmailTemplateContext(recipient = {}, template = {}) {
    const firstName = String(recipient?.firstName || recipient?.fullName?.split(/\s+/).filter(Boolean)[0] || 'there').trim() || 'there';
    const lastName = String(recipient?.lastName || recipient?.fullName?.split(/\s+/).slice(1).join(' ') || '').trim();
    const fullName = String(recipient?.fullName || [firstName, lastName].filter(Boolean).join(' ') || firstName).trim() || firstName;
    const clientName = String(recipient?.clientName || template?.fallbackClient || 'your HMJ client').trim() || 'your HMJ client';
    const jobTitle = String(recipient?.jobTitle || recipient?.role || template?.fallbackJob || 'your role').trim() || 'your role';
    return {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email_address: String(recipient?.email || '').trim(),
      reference: String(recipient?.reference || '').trim(),
      client_name: clientName,
      job_title: jobTitle,
      support_email: 'info@hmj-global.com',
    };
  }

  function bulkEmailTokenValue(rawToken, context = {}) {
    const normalized = String(rawToken || '')
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    const key = ({
      FIRST_NAME: 'first_name',
      LAST_NAME: 'last_name',
      FULL_NAME: 'full_name',
      EMAIL: 'email_address',
      EMAIL_ADDRESS: 'email_address',
      REFERENCE: 'reference',
      CANDIDATE_REFERENCE: 'reference',
      CLIENT: 'client_name',
      CLIENT_NAME: 'client_name',
      COMPANY: 'client_name',
      JOB_TITLE: 'job_title',
      ROLE: 'job_title',
      SUPPORT_EMAIL: 'support_email',
    })[normalized];
    if (!key) return null;
    return String(context[key] || '').trim();
  }

  function renderBulkEmailTokens(text, context = {}) {
    const source = String(text == null ? '' : text);
    const replaceToken = (match, token) => {
      const value = bulkEmailTokenValue(token, context);
      return value == null ? match : value;
    };
    return source
      .replace(/<\s*([A-Za-z0-9 _-]+?)\s*>/g, replaceToken)
      .replace(/\{\{\s*([A-Za-z0-9 _-]+?)\s*\}\}/g, replaceToken);
  }

  function splitBulkEmailParagraphs(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  function bulkEmailTemplateFromForm() {
    return {
      subject: String(elements.bulkEmailSubject?.value || '').trim(),
      heading: String(elements.bulkEmailHeading?.value || '').trim(),
      body: String(elements.bulkEmailBody?.value || '').trim(),
      fallbackClient: String(elements.bulkEmailFallbackClient?.value || '').trim(),
      fallbackJob: String(elements.bulkEmailFallbackJob?.value || '').trim(),
      primaryAction: String(elements.bulkEmailPrimaryAction?.value || 'portal_access').trim() || 'portal_access',
      includeTimesheets: !!elements.bulkEmailIncludeTimesheets?.checked,
    };
  }

  function renderBulkEmailSummary() {
    if (!elements.bulkEmailSummary || !elements.bulkEmailAudience) return;
    const audience = state.pendingBulkEmail;
    if (!audience) {
      elements.bulkEmailSummary.innerHTML = '';
      elements.bulkEmailAudience.textContent = '0 deliverable';
      return;
    }
    elements.bulkEmailAudience.textContent = `${audience.deliverableRows.length} deliverable`;
    const preview = audience.previewRecipient;
    elements.bulkEmailSummary.innerHTML = [
      `<div class="bulk-email-summary-item"><span>Selected rows</span><strong>${audience.selectedCount}</strong></div>`,
      `<div class="bulk-email-summary-item"><span>Deliverable emails</span><strong>${audience.deliverableRows.length}</strong></div>`,
      `<div class="bulk-email-summary-item"><span>Duplicate emails skipped</span><strong>${audience.duplicates.length}</strong></div>`,
      `<div class="bulk-email-summary-item"><span>Missing email address</span><strong>${audience.missingEmail.length}</strong></div>`,
      preview ? `<div class="bulk-email-summary-item"><span>Previewing recipient</span><strong>${escapeHtml(preview.fullName || preview.email || 'Candidate')}</strong></div>` : '',
      audience.requiresPromotion ? `<div class="bulk-email-summary-item"><span>Website accounts needed</span><strong>Some selected TSP rows will be prepared for secure HMJ access before sending.</strong></div>` : '',
    ].filter(Boolean).join('');
  }

  function renderBulkEmailPreview() {
    if (!elements.bulkEmailPreviewShell || !elements.bulkEmailPreviewSubject || !elements.bulkEmailPreviewRecipient) return;
    const audience = state.pendingBulkEmail;
    const template = bulkEmailTemplateFromForm();
    const preview = audience?.previewRecipient;
    if (!preview) {
      elements.bulkEmailPreviewSubject.textContent = 'HMJ email preview';
      elements.bulkEmailPreviewRecipient.textContent = 'No deliverable candidate is selected yet.';
      elements.bulkEmailPreviewShell.innerHTML = '<div class="bulk-email-help">Select at least one candidate with an email address to preview the branded HMJ email.</div>';
      return;
    }
    const context = bulkEmailTemplateContext(preview, template);
    const subject = renderBulkEmailTokens(template.subject || 'HMJ Global update', context);
    const heading = renderBulkEmailTokens(template.heading || 'An update from HMJ Global', context);
    const paragraphs = splitBulkEmailParagraphs(renderBulkEmailTokens(template.body, context));
    const primaryAction = bulkEmailPrimaryActionMeta(template.primaryAction);
    const actionButtons = [
      `<span class="bulk-email-preview-btn">${escapeHtml(primaryAction.label)}</span>`,
      template.includeTimesheets && primaryAction.value !== 'timesheets'
        ? '<span class="bulk-email-preview-btn secondary">Open HMJ timesheets / portal access</span>'
        : '',
    ].filter(Boolean).join('');
    elements.bulkEmailPreviewSubject.textContent = subject || 'HMJ email preview';
    elements.bulkEmailPreviewRecipient.textContent = `Previewing ${preview.fullName || preview.email} · ${preview.email || 'no email'}`;
    elements.bulkEmailPreviewShell.innerHTML = `
      <div class="bulk-email-preview-hero">
        <span>HMJ Global</span>
        <strong>${escapeHtml(heading || 'An update from HMJ Global')}</strong>
      </div>
      <div class="bulk-email-preview-body">
        ${(paragraphs.length ? paragraphs : ['Write the email message here.']).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
        <p>${escapeHtml(primaryAction.previewCopy)}</p>
      </div>
      <div class="bulk-email-preview-actions">${actionButtons}</div>
      <div class="bulk-email-preview-footer">
        <div>Need help? Email info@hmj-global.com.</div>
        <div>Merge fields are rendered per recipient before delivery.</div>
      </div>
    `;
  }

  function applyBulkEmailPreset(presetName) {
    const preset = BULK_EMAIL_PRESETS[presetName] || BULK_EMAIL_PRESETS.general_update;
    if (elements.bulkEmailPreset) elements.bulkEmailPreset.value = presetName in BULK_EMAIL_PRESETS ? presetName : 'general_update';
    if (elements.bulkEmailSubject) elements.bulkEmailSubject.value = preset.subject;
    if (elements.bulkEmailHeading) elements.bulkEmailHeading.value = preset.heading;
    if (elements.bulkEmailBody) elements.bulkEmailBody.value = preset.body;
    if (elements.bulkEmailPrimaryAction) elements.bulkEmailPrimaryAction.value = preset.primaryAction;
    if (elements.bulkEmailIncludeTimesheets) elements.bulkEmailIncludeTimesheets.checked = !!preset.includeTimesheets;
    renderBulkEmailPreview();
  }

  function preferredBulkEmailPreset(audience) {
    if (!audience?.deliverableRows?.length) return 'general_update';
    if (state.sourceTab === 'timesheet-portal-active') return 'onboarding_request';
    return audience.deliverableRows.some((candidate) => candidate?.onboarding_mode === true || Number(candidate?.active_assignment_count || 0) > 0)
      ? 'onboarding_request'
      : 'general_update';
  }

  function closeBulkEmailDialog() {
    state.pendingBulkEmail = null;
    if (!elements.bulkEmailDialog) return;
    if (typeof elements.bulkEmailDialog.close === 'function' && elements.bulkEmailDialog.open) elements.bulkEmailDialog.close();
    else elements.bulkEmailDialog.removeAttribute('open');
  }

  function openBulkEmailDialog() {
    const rows = selectedCandidates({ allowRaw: true, includeRaw: true });
    if (!rows.length) {
      showToast('Select candidates first.', 'warn', 2800);
      return;
    }
    const audience = buildBulkEmailAudience(rows);
    if (!audience.deliverableRows.length) {
      showToast('Select candidates with a valid email address first.', 'warn', 3200);
      return;
    }
    state.pendingBulkEmail = audience;
    applyBulkEmailPreset(preferredBulkEmailPreset(audience));
    renderBulkEmailSummary();
    renderBulkEmailPreview();
    if (elements.bulkEmailDialog) {
      if (typeof elements.bulkEmailDialog.showModal === 'function') elements.bulkEmailDialog.showModal();
      else elements.bulkEmailDialog.setAttribute('open', 'open');
    }
  }

  function insertBulkEmailToken(token) {
    const field = [elements.bulkEmailSubject, elements.bulkEmailHeading, elements.bulkEmailBody]
      .find((input) => input === document.activeElement)
      || elements.bulkEmailBody
      || elements.bulkEmailSubject;
    if (!field) return;
    const value = String(field.value || '');
    const start = Number.isInteger(field.selectionStart) ? field.selectionStart : value.length;
    const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : value.length;
    field.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const nextCaret = start + token.length;
    if (typeof field.setSelectionRange === 'function') field.setSelectionRange(nextCaret, nextCaret);
    field.focus();
    renderBulkEmailPreview();
  }

  async function sendBulkEmailWizard() {
    const pending = state.pendingBulkEmail;
    if (!pending?.deliverableRows?.length) {
      showToast('Select candidates with email addresses first.', 'warn', 3200);
      return;
    }
    if (state.outreachDiagnostics && state.outreachDiagnostics.publicDeliveryReady !== true) {
      showOutreachConfigurationError(
        state.outreachDiagnostics.smtpStatus === 'invalid_credentials'
          ? (state.outreachDiagnostics.smtpMessage || 'Candidate emails are currently blocked because the saved SMTP login was rejected by the mail server.')
          : state.outreachDiagnostics.resendConfigured && state.outreachDiagnostics.resendReady === false
            ? 'Candidate emails are currently blocked because the configured RESEND_API_KEY is invalid.'
            : state.outreachDiagnostics.smtpCredentialsSaved
              ? (state.outreachDiagnostics.smtpMessage || 'Candidate emails are currently blocked because the saved SMTP configuration could not be verified.')
              : 'Candidate emails are not configured on this website yet.'
      );
      return;
    }

    const template = bulkEmailTemplateFromForm();
    if (!template.subject || !template.heading || !template.body) {
      showToast('Add a subject, heading, and message before sending.', 'warn', 3200);
      return;
    }

    let rows = pending.deliverableRows.slice();
    const needsSecureAccess = template.primaryAction === 'portal_access' || template.primaryAction === 'documents_upload';
    if (needsSecureAccess) {
      rows = await ensureWebsiteCandidatesForOutreach(rows, {
        onboardingMode: template.primaryAction === 'documents_upload' || rows.some((candidate) => candidate?.onboarding_mode === true || Number(candidate?.active_assignment_count || 0) > 0),
      });
    }

    const dedupedAudience = buildBulkEmailAudience(rows);
    const sendRows = dedupedAudience.deliverableRows.filter((candidate) => !!lowerEmail(candidate?.email));
    if (!sendRows.length) {
      showToast('No deliverable candidate email targets are available.', 'warn', 3200);
      return;
    }

    if (elements.bulkEmailSend) {
      elements.bulkEmailSend.disabled = true;
      elements.bulkEmailSend.textContent = `Sending 0 of ${sendRows.length}…`;
    }
    if (elements.bulkEmailCancel) elements.bulkEmailCancel.disabled = true;

    const failures = [];
    let sent = 0;
    let completed = 0;
    let cursor = 0;
    const concurrency = Math.min(4, sendRows.length);
    const payloadTemplate = {
      subject: template.subject,
      heading: template.heading,
      body: template.body,
      fallback_client_name: template.fallbackClient,
      fallback_job_title: template.fallbackJob,
      primary_action: template.primaryAction,
      include_timesheets_button: template.includeTimesheets,
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < sendRows.length) {
        const currentIndex = cursor;
        cursor += 1;
        const candidate = sendRows[currentIndex];
        try {
          await state.helpers.api('admin-candidate-bulk-email', 'POST', {
            candidate_id: candidate?.id || null,
            recipient: buildBulkEmailRecipient(candidate),
            template: payloadTemplate,
          });
          sent += 1;
        } catch (error) {
          failures.push({
            candidate,
            error: error?.message || 'send_failed',
          });
        } finally {
          completed += 1;
          if (elements.bulkEmailSend) {
            elements.bulkEmailSend.textContent = `Sending ${completed} of ${sendRows.length}…`;
          }
        }
      }
    });

    await Promise.all(workers);

    if (elements.bulkEmailSend) {
      elements.bulkEmailSend.disabled = false;
      elements.bulkEmailSend.textContent = 'Send HMJ email';
    }
    if (elements.bulkEmailCancel) elements.bulkEmailCancel.disabled = false;

    const skipped = dedupedAudience.duplicates.length + pending.missingEmail.length;
    pushLog({
      action: 'email:bulk',
      detail: `${sent} accepted${failures.length ? `, ${failures.length} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`,
    });

    renderBulkEmailSummary();
    renderBulkEmailPreview();

    if (!failures.length) {
      closeBulkEmailDialog();
    }

    showToast(
      failures.length
        ? `Accepted ${sent} HMJ email${sent === 1 ? '' : 's'} for delivery. ${failures.length} failed.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`
        : `Accepted ${sent} HMJ email${sent === 1 ? '' : 's'} for delivery.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`,
      failures.length ? 'warn' : 'info',
      4600,
    );
  }

  function parseDocumentRequestList(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
    const out = [];
    source.forEach((entry) => {
      const type = normalizeDocumentRequestType(entry);
      if (type && !out.includes(type)) out.push(type);
    });
    return out;
  }

  function normalisePaymentSummary(row) {
    const summary = row?.payment_summary && typeof row.payment_summary === 'object'
      ? row.payment_summary
      : null;
    const lastFour = String(summary?.lastFour || '').trim();
    const complete = summary?.completion?.complete === true
      || (!!String(row?.bank_name || '').trim() && !!(String(row?.bank_account || '').trim() || String(row?.bank_iban || '').trim()));
    return {
      id: String(summary?.id || '').trim(),
      accountCurrency: String(summary?.accountCurrency || (row?.bank_iban ? 'EUR' : 'GBP') || 'GBP').trim() || 'GBP',
      paymentMethod: String(summary?.paymentMethod || (row?.bank_iban ? 'iban_swift' : 'gbp_local') || 'gbp_local').trim() || 'gbp_local',
      bankName: String(summary?.bankName || row?.bank_name || '').trim(),
      bankLocationOrCountry: String(summary?.bankLocationOrCountry || '').trim(),
      accountHolderName: String(summary?.accountHolderName || '').trim(),
      lastFour,
      legacyFallback: summary?.legacyFallback === true,
      updatedAt: summary?.updatedAt || row?.updated_at || row?.created_at || '',
      completion: {
        complete,
        missing: complete ? [] : ['payment_details'],
      },
      masked: {
        sortCode: String(summary?.masked?.sortCode || '').trim(),
        accountNumber: String(summary?.masked?.accountNumber || '').trim(),
        iban: String(summary?.masked?.iban || '').trim(),
        swiftBic: String(summary?.masked?.swiftBic || '').trim(),
      },
    };
  }

  function normaliseOnboarding(row, docs, paymentSummary) {
    const existing = row?.onboarding && typeof row.onboarding === 'object' ? row.onboarding : null;
    const onboardingMode = candidateOnboardingMode(row) || existing?.onboardingMode === true || existing?.onboardingRequired === true;
    const docRows = Array.isArray(docs) ? docs : [];
    const docTypes = new Set(docRows.map((doc) => String(doc?.document_type || doc?.kind || '').toLowerCase()));
    const rightToWorkDocs = docRows.filter((doc) => ['right_to_work', 'passport', 'visa_permit'].includes(String(doc?.document_type || doc?.kind || '').toLowerCase()));
    const hasRightToWorkUpload = existing?.hasRightToWorkUpload === true
      || rightToWorkDocs.length > 0
      || !!String(row?.rtw_url || '').trim();
    const hasRightToWork = existing?.hasRightToWork === true
      || rightToWorkDocs.some((doc) => String(doc?.verification_status || '').toLowerCase() === 'verified')
      || !!String(row?.rtw_url || '').trim();
    const hasRightToWorkPendingVerification = existing?.hasRightToWorkPendingVerification === true
      || (!hasRightToWork && hasRightToWorkUpload);
    const hasPaymentDetails = existing?.hasPaymentDetails === true || paymentSummary?.completion?.complete === true;
    const pendingVerificationCount = typeof existing?.pendingVerificationCount === 'number'
      ? existing.pendingVerificationCount
      : docRows.filter((doc) => doc?.verification_required && String(doc?.verification_status || '').toLowerCase() !== 'verified').length;
    const missing = [];
    if (onboardingMode && !hasRightToWork) missing.push('right_to_work');
    if (onboardingMode && !hasPaymentDetails) missing.push('payment_details');
    return {
      onboardingMode,
      onboardingRequired: onboardingMode,
      hasRightToWork,
      hasRightToWorkUpload,
      hasRightToWorkPendingVerification,
      hasPaymentDetails,
      onboardingComplete: onboardingMode ? (existing?.onboardingComplete === true || missing.length === 0) : false,
      missing,
      missingCore: Array.isArray(existing?.missingCore) ? existing.missingCore : missing,
      missingRecommended: Array.isArray(existing?.missingRecommended) ? existing.missingRecommended : [],
      missingFlags: existing?.missingFlags && typeof existing.missingFlags === 'object' ? existing.missingFlags : {},
      missingCount: typeof existing?.missingCount === 'number'
        ? existing.missingCount
        : (missing.length + (Array.isArray(existing?.missingRecommended) ? existing.missingRecommended.length : 0)),
      documentTypes: Array.isArray(existing?.documentTypes) ? existing.documentTypes : Array.from(docTypes),
      pendingVerificationCount,
      status: onboardingStatusKey(existing?.status || row?.onboarding_status || ''),
      statusLabel: existing?.statusLabel || onboardingStatusLabel(existing?.status || row?.onboarding_status || ''),
      statusUpdatedAt: existing?.statusUpdatedAt || row?.onboarding_status_updated_at || '',
      statusUpdatedBy: existing?.statusUpdatedBy || row?.onboarding_status_updated_by || '',
      rightToWork: existing?.rightToWork && typeof existing.rightToWork === 'object' ? existing.rightToWork : {},
      emailHistory: existing?.emailHistory && typeof existing.emailHistory === 'object' ? existing.emailHistory : {},
      cvPresent: existing?.cvPresent === true || docTypes.has('cv'),
      rightToWorkRegions: Array.isArray(existing?.rightToWorkRegions)
        ? existing.rightToWorkRegions
        : (Array.isArray(row?.right_to_work_regions) ? row.right_to_work_regions : []),
      consentCaptured: existing?.consentCaptured === true || row?.consent_captured === true,
      consentCapturedAt: existing?.consentCapturedAt || row?.consent_captured_at || '',
      duplicate: existing?.duplicate && typeof existing.duplicate === 'object'
        ? existing.duplicate
        : { duplicateEmailCount: 0, duplicateEmails: [] },
    };
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return value;
    }
  }

  function formatDateTime(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString();
    } catch {
      return value;
    }
  }

  function formatMoneyAmount(value, currency = 'GBP') {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: String(currency || 'GBP').toUpperCase(),
        maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      }).format(amount);
    } catch {
      return `${amount} ${currency || 'GBP'}`.trim();
    }
  }

  function formatAssignmentPay(row) {
    const pay = row?.rate_pay ?? row?.rate_std;
    const text = formatMoneyAmount(pay, row?.currency || 'GBP');
    return text ? `${text} pay` : 'Rate pending';
  }

  function primaryActiveAssignment(candidate) {
    const summary = candidate?.active_assignment_summary;
    if (summary && typeof summary === 'object') return summary;
    const first = Array.isArray(candidate?.active_assignments) ? candidate.active_assignments[0] : null;
    return first && typeof first === 'object' ? first : null;
  }

  function formatAssignmentDateCell(value, fallback = '—') {
    return value ? formatDate(value) : fallback;
  }

  function assignmentSearchUrl(assignment) {
    const ref = String(assignment?.as_ref || assignment?.reference || '').trim();
    const url = new URL('/admin/assignments.html', window.location.origin);
    if (ref) {
      url.searchParams.set('q', ref);
      url.searchParams.set('assignment', ref);
    }
    return url.toString();
  }

  function timesheetsSearchUrl(assignment, candidate) {
    const ref = String(assignment?.as_ref || assignment?.reference || '').trim();
    const candidateName = String(candidate?.name || candidate?.email || '').trim();
    const url = new URL('/admin/timesheets.html', window.location.origin);
    if (ref) url.searchParams.set('assignment', ref);
    if (candidateName) url.searchParams.set('candidate', candidateName);
    return url.toString();
  }

  function formatActiveAssignmentMeta(candidate) {
    const summary = candidate?.active_assignment_summary || null;
    const count = Number(candidate?.active_assignment_count || 0);
    if (!summary || count <= 0) return '';
    const bits = [
      count === 1 ? '1 active assignment' : `${count} active assignments`,
      summary.client_name || null,
      summary.job_title || null,
      summary.reference || summary.as_ref || null,
    ].filter(Boolean);
    return bits.join(' • ');
  }

  function ensureDebugPanel() {
    let panel = qs('#debug-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'debug-panel';
      panel.innerHTML = `
        <button id="debug-toggle" class="btn ghost" type="button">Show debug</button>
        <div class="dbg-body">
          <div class="dbg-row"><strong>Identity</strong><span id="dbg-ident-value">-</span></div>
          <div class="dbg-row"><strong>Token</strong><span id="dbg-token-value">-</span></div>
          <div class="dbg-row"><strong>Supabase</strong><span id="dbg-sb-value">-</span></div>
          <div class="dbg-row"><strong>Last query</strong><span id="dbg-query">-</span></div>
          <div class="dbg-row"><strong>Logs</strong></div>
          <ul id="dbg-logs" class="dbg-logs"></ul>
          <button id="dbg-export" class="btn" type="button" style="margin-top:12px">Export logs</button>
        </div>`;
      document.body.appendChild(panel);
    } else if (!qs('#dbg-logs', panel)) {
      panel.innerHTML = `
        <button id="debug-toggle" class="btn ghost" type="button">Show debug</button>
        <div class="dbg-body">
          <div class="dbg-row"><strong>Identity</strong><span id="dbg-ident-value">-</span></div>
          <div class="dbg-row"><strong>Token</strong><span id="dbg-token-value">-</span></div>
          <div class="dbg-row"><strong>Supabase</strong><span id="dbg-sb-value">-</span></div>
          <div class="dbg-row"><strong>Last query</strong><span id="dbg-query">-</span></div>
          <div class="dbg-row"><strong>Logs</strong></div>
          <ul id="dbg-logs" class="dbg-logs"></ul>
          <button id="dbg-export" class="btn" type="button" style="margin-top:12px">Export logs</button>
        </div>`;
    }

    if (!panel.dataset.bound) {
      const toggle = qs('#debug-toggle', panel);
      if (toggle) toggle.addEventListener('click', () => toggleDebug());
      const exportBtn = qs('#dbg-export', panel);
      if (exportBtn) exportBtn.addEventListener('click', exportLogs);
      panel.dataset.bound = 'true';
    }
  }

  function toggleDebug(force) {
    state.debugOpen = force !== undefined ? !!force : !state.debugOpen;
    const panel = qs('#debug-panel');
    if (!panel) return;
    panel.classList.toggle('open', state.debugOpen);
    const btn = qs('#debug-toggle', panel);
    if (btn) btn.textContent = state.debugOpen ? 'Hide debug' : 'Show debug';
  }

  function renderDebugPanel() {
    ensureDebugPanel();
    const list = qs('#dbg-logs');
    if (!list) return;
    list.innerHTML = '';
    state.logs.forEach((log) => {
      const li = document.createElement('li');
      li.textContent = `[${new Date(log.at).toLocaleTimeString()}] ${log.action || 'event'}: ${log.detail || ''}`;
      list.appendChild(li);
    });
    const info = qs('#dbg-query');
    if (info) {
      const last = state.logs[0];
      info.textContent = last ? last.detail || '' : '-';
    }
  }

  function exportLogs() {
    if (!state.logs.length) return;
    const rows = state.logs.map((log) => `${log.at}\t${log.action}\t${log.detail || ''}`);
    const blob = new Blob([rows.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'candidate-debug.log';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function tokenize(query) {
    const tokens = [];
    const text = String(query || '');
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (/\s/.test(char)) { i += 1; continue; }
      if (char === '"' || char === '\'') {
        const quote = char;
        i += 1;
        let buf = '';
        while (i < text.length && text[i] !== quote) { buf += text[i]; i += 1; }
        i += 1;
        tokens.push({ type: 'term', value: buf.toLowerCase() });
        continue;
      }
      if (char === '(' || char === ')') {
        tokens.push({ type: char });
        i += 1;
        continue;
      }
      let buf = '';
      while (i < text.length && !/['"()\s]/.test(text[i])) { buf += text[i]; i += 1; }
      const upper = buf.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') tokens.push({ type: upper });
      else tokens.push({ type: 'term', value: buf.toLowerCase() });
    }
    return tokens;
  }

  function toRpn(tokens) {
    const output = [];
    const stack = [];
    const precedence = { OR: 1, AND: 2, NOT: 3 };
    tokens.forEach((token) => {
      if (token.type === 'term') { output.push(token); return; }
      if (token.type === 'NOT') { stack.push(token); return; }
      if (token.type === 'AND' || token.type === 'OR') {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if ((top.type === 'AND' || top.type === 'OR' || top.type === 'NOT') && precedence[top.type] >= precedence[token.type]) output.push(stack.pop());
          else break;
        }
        stack.push(token);
        return;
      }
      if (token.type === '(') { stack.push(token); return; }
      if (token.type === ')') {
        while (stack.length && stack[stack.length - 1].type !== '(') output.push(stack.pop());
        stack.pop();
      }
    });
    while (stack.length) output.push(stack.pop());
    return output;
  }

  function evaluateRpn(tokens, haystack) {
    const stack = [];
    tokens.forEach((token) => {
      if (token.type === 'term') stack.push(haystack.includes(token.value));
      else if (token.type === 'NOT') stack.push(!stack.pop());
      else if (token.type === 'AND' || token.type === 'OR') {
        const b = stack.pop();
        const a = stack.pop();
        stack.push(token.type === 'AND' ? (a && b) : (a || b));
      }
    });
    return stack.pop() ?? true;
  }

  function booleanMatch(text, query) {
    if (!query) return true;
    const haystack = String(text || '').toLowerCase();
    try {
      const tokens = tokenize(query);
      const rpn = toRpn(tokens);
      return evaluateRpn(rpn, haystack);
    } catch (err) {
      console.warn('[candidates] boolean query fallback', err);
      return query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((token) => haystack.includes(token));
    }
  }

  function normalizeCandidate(row) {
    if (!row) return null;
    const first = row.first_name || row.firstName || '';
    const last = row.last_name || row.lastName || '';
    const storedFullName = row.full_name || row.fullName || '';
    const derivedFullName = `${first} ${last}`.trim();
    const displayName = storedFullName || derivedFullName || 'Candidate';
    const status = String(row.status || 'in progress').toLowerCase();
    const docs = Array.isArray(row.docs)
      ? row.docs.slice()
      : [
          row.rtw_url && { kind: 'Right to work', url: row.rtw_url },
          row.contract_url && { kind: 'Contract', url: row.contract_url }
        ]
          .filter(Boolean)
          .map((doc, idx) => ({ id: `${row.id}-doc-${idx}`, ...doc }));
    const notes = Array.isArray(row.notes)
      ? row.notes.map((note, idx) => ({
          id: note.id || `${row.id}-note-${idx}`,
          body: note.body || note.text || note.note || '',
          author_email: note.author_email || note.author || '',
          created_at: note.created_at || note.at || row.updated_at || new Date().toISOString()
        }))
      : row.notes
        ? [{ id: `${row.id}-note`, body: row.notes, author_email: row.author || '', created_at: row.updated_at || row.created_at }]
        : [];
    const skillList = parseSkills(row.skills || row.skill_tags || row.tags);
    const tags = skillList.map((skill) => ({ id: `${row.id}-tag-${skill}`, name: skill, color: '#3a66b3' }));
    const portalAuth = row.portal_auth && typeof row.portal_auth === 'object'
      ? row.portal_auth
      : {
          exists: !!(row.has_portal_account || row.auth_user_id),
          user_id: row.auth_user_id || null,
          email: row.email || null,
          email_confirmed_at: null,
          last_sign_in_at: row.last_portal_login_at || null,
          created_at: null,
          updated_at: null,
          full_name: storedFullName || derivedFullName || null,
        };
    const paymentSummary = normalisePaymentSummary(row);
    const paymentDetailsAdmin = row.payment_details_admin && typeof row.payment_details_admin === 'object'
      ? { ...row.payment_details_admin }
      : null;
    const onboarding = normaliseOnboarding(row, docs, paymentSummary);
    return {
      ...row,
      id: row.id ?? row.ref ?? `tmp-${Math.random().toString(36).slice(2)}`,
      ref: row.ref || row.payroll_ref || null,
      auth_user_id: row.auth_user_id || portalAuth.user_id || null,
      has_portal_account: !!(row.has_portal_account || row.auth_user_id || portalAuth.exists),
      portal_account_state: row.portal_account_state || (row.auth_user_id ? 'linked' : 'none'),
      portal_auth: portalAuth,
      last_portal_login_at: row.last_portal_login_at || portalAuth.last_sign_in_at || '',
      first_name: first,
      last_name: last,
      full_name: storedFullName || '',
      name: displayName,
      email: row.email || '',
      phone: row.phone || '',
      address1: row.address1 || row.address_1 || row.address || '',
      address2: row.address2 || row.address_2 || '',
      town: row.town || row.city || '',
      county: row.county || '',
      postcode: row.postcode || '',
      country: row.country || '',
      onboarding_mode: candidateOnboardingMode(row),
      onboarding_status: row.onboarding_status || '',
      onboarding_status_updated_at: row.onboarding_status_updated_at || '',
      onboarding_status_updated_by: row.onboarding_status_updated_by || '',
      emergency_name: row.emergency_name || '',
      emergency_phone: row.emergency_phone || '',
      status,
      role: row.role || row.job_title || row.headline_role || '',
      region: row.region || row.location || row.county || row.country || '',
      headline_role: row.headline_role || row.role || row.job_title || '',
      location: row.location || row.region || row.county || row.country || '',
      nationality: row.nationality || '',
      primary_specialism: row.primary_specialism || row.discipline || '',
      secondary_specialism: row.secondary_specialism || '',
      current_job_title: row.current_job_title || row.job_title || '',
      desired_roles: row.desired_roles || row.role || '',
      qualifications: row.qualifications || '',
      sector_experience: row.sector_experience || '',
      sector_focus: row.sector_focus || '',
      salary_expectation: row.salary_expectation || '',
      salary_expectation_unit: row.salary_expectation_unit || '',
      experience_years: row.experience_years || row.years_experience || '',
      relocation_preference: row.relocation_preference || row.relocation || '',
      availability: row.availability || row.availability_date || '',
      right_to_work_status: row.right_to_work_status || '',
      right_to_work_regions: Array.isArray(row.right_to_work_regions) ? row.right_to_work_regions.slice() : parseSkills(row.right_to_work_regions || ''),
      right_to_work_evidence_type: row.right_to_work_evidence_type || '',
      linkedin_url: row.linkedin_url || row.linkedin || '',
      summary: row.summary || row.message || '',
      consent_captured: row.consent_captured === true,
      consent_captured_at: row.consent_captured_at || '',
      skills: skillList,
      tags,
      docs,
      assignments: Array.isArray(row.assignments) ? row.assignments.slice() : [],
      assignment_options: Array.isArray(row.assignment_options) ? row.assignment_options.slice() : [],
      assignment_linking_available: row.assignment_linking_available !== false,
      onboarding,
      payment_summary: paymentSummary,
      payment_details_admin: paymentDetailsAdmin,
      notes,
      audit: Array.isArray(row.audit) ? row.audit : [],
      applications: Array.isArray(row.applications) ? row.applications : [],
      active_assignments: Array.isArray(row.active_assignments) ? row.active_assignments.slice() : [],
      active_assignment_count: Number(row.active_assignment_count || 0),
      active_assignment_summary: row.active_assignment_summary || null,
      availability_on: row.availability_on || row.availability_date || row.availability || row.start_date || '',
      created_at: row.created_at || row.createdAt || '',
      updated_at: row.updated_at || row.updatedAt || row.created_at || '',
      source: row.source || (state.cacheMode ? 'cache' : 'supabase')
    };
  }

  function normalizeTimesheetPortalCandidate(row) {
    if (!row) return null;
    const firstName = row.firstName || row.first_name || '';
    const lastName = row.lastName || row.last_name || '';
    const name = row.name || `${firstName} ${lastName}`.trim() || row.email || 'Timesheet Portal candidate';
    const reference = row.reference || row.accountingReference || '';
    const seed = row.id || row.email || reference || name;
    return normalizeCandidate({
      id: `tsp:${seed}`,
      ref: reference || null,
      payroll_ref: reference || null,
      first_name: firstName,
      last_name: lastName,
      full_name: name,
      email: row.email || '',
      phone: row.mobile || '',
      role: row.role || row.jobTitle || '',
      region: row.region || row.location || row.country || '',
      location: row.location || row.region || row.country || '',
      status: 'timesheet portal',
      source: 'timesheet_portal',
      source_kind: 'timesheet-portal',
      source_label: 'Timesheet Portal',
      source_badges: ['Timesheet Portal'],
      source_record_id: row.id || null,
      updated_at: row.updated_at || row.updatedAt || state.tspCompare?.comparedAt || '',
      onboarding: {
        hasRightToWork: false,
        hasRightToWorkUpload: false,
        hasRightToWorkPendingVerification: false,
        hasPaymentDetails: false,
        onboardingComplete: false,
        missing: [],
        documentTypes: [],
        pendingVerificationCount: 0,
      },
      payment_summary: {
        completion: { complete: false },
      },
      docs: [],
      notes: [],
      assignments: [],
      assignment_options: [],
      applications: [],
      audit: [],
      assignment_linking_available: false,
    });
  }

  function decorateWebsiteCandidate(candidate, contractor) {
    if (!candidate) return null;
    return {
      ...candidate,
      source_kind: contractor ? 'combined' : 'website',
      source_label: contractor ? 'Website + TSP' : 'Website only',
      source_badges: contractor ? ['Website', 'Timesheet Portal'] : ['Website'],
      timesheet_portal_match: contractor || null,
      timesheet_portal_reference: contractor?.reference || contractor?.accountingReference || '',
    };
  }

  function decorateCandidateAssignments(candidate) {
    if (!candidate) return null;
    const summary = summarizeCandidateAssignments(candidate);
    return {
      ...candidate,
      active_assignments: Array.isArray(summary.assignments) ? summary.assignments.slice() : [],
      active_assignment_count: Number(summary.count || 0),
      active_assignment_summary: summary.primary || null,
    };
  }

  function buildSourceDatasets() {
    const rawTimesheetPortalRows = Array.isArray(state.tspCompare?.timesheetPortalCandidates)
      ? state.tspCompare.timesheetPortalCandidates
      : [];
    const timesheetPortalLookups = buildTimesheetPortalLookups(rawTimesheetPortalRows);
    const websiteRows = state.raw
      .map((candidate) => decorateWebsiteCandidate(candidate, findTimesheetPortalMatch(candidate, timesheetPortalLookups)))
      .map((candidate) => decorateCandidateAssignments(candidate))
      .filter(Boolean);
    const timesheetPortalRows = rawTimesheetPortalRows
      .map((row) => normalizeTimesheetPortalCandidate(row))
      .map((candidate) => decorateCandidateAssignments(candidate))
      .filter(Boolean);
    const websiteLookups = buildWebsiteLookups(websiteRows);
    const websiteOnlyRows = websiteRows.filter((candidate) => !candidate?.timesheet_portal_match);
    const timesheetPortalOnlyRows = timesheetPortalRows.filter((candidate) => !findWebsiteMatch(candidate, websiteLookups));
    const activeAssignmentRows = websiteRows
      .filter((candidate) => Number(candidate?.active_assignment_count || 0) > 0)
      .concat(timesheetPortalOnlyRows.filter((candidate) => Number(candidate?.active_assignment_count || 0) > 0));
    const combinedRows = websiteRows.concat(timesheetPortalOnlyRows);
    return {
      website: websiteOnlyRows,
      'timesheet-portal-active': activeAssignmentRows,
      'timesheet-portal': timesheetPortalOnlyRows,
      combined: combinedRows,
    };
  }

  function updateSupabaseBadge() {
    const pill = qs('#dbg-sb');
    if (!pill) return;
    const dbg = qs('#dbg-sb-value');
    if (state.supabaseMode === 'live') {
      pill.textContent = 'supabase: live';
      pill.className = 'pill ok';
      if (dbg) dbg.textContent = 'live';
    } else if (state.supabaseMode === 'cache') {
      pill.textContent = 'supabase: cache';
      pill.className = 'pill warn';
      if (dbg) dbg.textContent = 'cache';
    } else if (state.supabaseMode === 'error') {
      pill.textContent = 'supabase: error';
      pill.className = 'pill err';
      if (dbg) dbg.textContent = 'error';
    } else {
      pill.textContent = 'supabase: …';
      pill.className = 'pill';
      if (dbg) dbg.textContent = '…';
    }
  }

  function updateIdentityBadges(info) {
    const identityPill = qs('#dbg-identity');
    const tokenPill = qs('#dbg-token');
    const rolePill = qs('#dbg-role');
    if (identityPill) {
      identityPill.textContent = info?.ok ? 'identity: ok' : 'identity: none';
      identityPill.className = info?.ok ? 'pill ok' : 'pill warn';
    }
    if (tokenPill) {
      if (info?.token) {
        tokenPill.textContent = 'token: ok';
        tokenPill.className = 'pill ok';
      } else if (info?.ok) {
        tokenPill.textContent = 'auth: cookie session';
        tokenPill.className = 'pill ok';
      } else {
        tokenPill.textContent = 'token: missing';
        tokenPill.className = 'pill warn';
      }
    }
    if (rolePill) {
      rolePill.textContent = `role: ${info?.role || 'unknown'}`;
      rolePill.className = info?.ok ? 'pill ok' : 'pill warn';
    }
    const identDetail = qs('#dbg-ident-value');
    if (identDetail) identDetail.textContent = info?.email || '—';
    const tokenDetail = qs('#dbg-token-value');
    if (tokenDetail) {
      tokenDetail.textContent = info?.token ? 'attached' : (info?.ok ? 'cookie-backed session' : 'missing');
    }
  }

  async function detectVersion() {
    const pill = qs('#dbg-version');
    if (!pill) return;
    try {
      const res = await fetch('/netlify/git.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('git meta missing');
      const json = await res.json();
      const sha = json.commit?.slice(0, 8) || json.sha?.slice(0, 8) || '-';
      pill.textContent = `build: ${sha}`;
    } catch {
      pill.textContent = 'build: dev';
    }
  }

  function applyFilterInputs() {
    elements.query.value = state.filters.query || '';
    if (elements.candidateType) elements.candidateType.value = state.filters.candidateType || '';
    Array.from(elements.status.options).forEach((opt) => {
      opt.selected = state.filters.status.includes(opt.value.toLowerCase());
    });
    elements.role.value = state.filters.role || '';
    elements.region.value = state.filters.region || '';
    elements.skills.value = state.filters.skills.join(', ');
    elements.availability.value = state.filters.availability || '';
    elements.createdFrom.value = state.filters.createdFrom || '';
    elements.createdTo.value = state.filters.createdTo || '';
  }

  function captureFilters() {
    state.filters = {
      query: elements.query.value.trim(),
      candidateType: elements.candidateType ? elements.candidateType.value : '',
      onboardingStatus: state.filters.onboardingStatus || '',
      status: Array.from(elements.status.selectedOptions).map((opt) => opt.value.toLowerCase()),
      role: elements.role.value.trim(),
      region: elements.region.value.trim(),
      skills: parseSkills(elements.skills.value),
      availability: elements.availability.value || '',
      createdFrom: elements.createdFrom.value || '',
      createdTo: elements.createdTo.value || ''
    };
    saveFilters(state.filters);
  }

  function countActiveFilters() {
    const f = state.filters;
    let total = 0;
    if (f.query) total += 1;
    if (f.onboardingStatus) total += 1;
    if (f.status.length) total += 1;
    if (f.role) total += 1;
    if (f.region) total += 1;
    if (f.skills.length) total += 1;
    if (f.availability) total += 1;
    if (f.createdFrom || f.createdTo) total += 1;
    return total;
  }

  function updateFilterCount() {
    const label = elements.filterCount;
    if (!label) return;
    const count = state.filtered.length;
    const active = countActiveFilters();
    label.textContent = `${count} results — ${sourceTabLabel()}${active ? ` — ${active} filter${active === 1 ? '' : 's'}` : ''}`;
    renderActiveFilterChips();
  }

  function activeFilterChipItems() {
    const chips = [{
      key: 'source',
      label: `View: ${sourceTabLabel()}`,
      static: true,
    }];
    if (state.filters.query) chips.push({ key: 'query', label: `Search: ${state.filters.query}` });
    if (state.filters.candidateType) chips.push({ key: 'candidateType', label: `Type: ${state.filters.candidateType === 'starter' ? 'New starters' : 'Job seekers'}` });
    if (state.filters.onboardingStatus) chips.push({ key: 'onboardingStatus', label: `Onboarding: ${onboardingStatusLabel(state.filters.onboardingStatus)}` });
    if (state.filters.status.length) chips.push({ key: 'status', label: `Status: ${state.filters.status.join(', ')}` });
    if (state.filters.role) chips.push({ key: 'role', label: `Role: ${state.filters.role}` });
    if (state.filters.region) chips.push({ key: 'region', label: `Region: ${state.filters.region}` });
    if (state.filters.skills.length) chips.push({ key: 'skills', label: `Skills: ${state.filters.skills.join(', ')}` });
    if (state.filters.availability) chips.push({ key: 'availability', label: `Availability: ${state.filters.availability}` });
    if (state.filters.createdFrom || state.filters.createdTo) {
      chips.push({
        key: 'dates',
        label: `Dates: ${state.filters.createdFrom || '…'} to ${state.filters.createdTo || '…'}`,
      });
    }
    return chips;
  }

  function clearFilterChip(key) {
    switch (String(key || '')) {
      case 'query':
        state.filters.query = '';
        break;
      case 'candidateType':
        state.filters.candidateType = '';
        break;
      case 'onboardingStatus':
        state.filters.onboardingStatus = '';
        break;
      case 'status':
        state.filters.status = [];
        break;
      case 'role':
        state.filters.role = '';
        break;
      case 'region':
        state.filters.region = '';
        break;
      case 'skills':
        state.filters.skills = [];
        break;
      case 'availability':
        state.filters.availability = '';
        break;
      case 'dates':
        state.filters.createdFrom = '';
        state.filters.createdTo = '';
        break;
      default:
        return;
    }
    saveFilters(state.filters);
    applyFilterInputs();
    applyFilters();
  }

  function renderActiveFilterChips() {
    const host = elements.activeFilterChips;
    if (!host) return;
    const chips = activeFilterChipItems();
    host.innerHTML = chips.map((chip) => chip.static
      ? `<span class="filter-chip static">${escapeHtml(chip.label)}</span>`
      : `<span class="filter-chip">${escapeHtml(chip.label)}<button type="button" data-filter-clear="${escapeHtml(chip.key)}" aria-label="Clear ${escapeHtml(chip.label)}">×</button></span>`
    ).join('');
    host.querySelectorAll('[data-filter-clear]').forEach((button) => {
      button.addEventListener('click', () => clearFilterChip(button.dataset.filterClear));
    });
  }

  function matchesFilters(candidate) {
    const { filters } = state;
    if (!candidate) return false;
    const haystack = [
      candidate.ref,
      candidate.name,
      candidate.email,
      candidate.phone,
      candidate.role,
      candidate.region,
      (candidate.skills || []).join(' '),
      (candidate.notes || []).map((note) => note.body).join(' ')
    ].join(' ').toLowerCase();
    if (filters.query && !booleanMatch(haystack, filters.query)) return false;
    if (state.quickSearch && !haystack.includes(state.quickSearch)) return false;
    // Candidate type filter
    if (filters.candidateType === 'starter' && !candidateOnboardingMode(candidate)) return false;
    // Seekers = candidates registered with a recruitment profile (onboarding_mode false).
    // has_application is an informational flag (applied to a specific job posting) but
    // is NOT required to be classed as a job seeker — registration alone qualifies them.
    // Requiring has_application caused the tab count to be lower than the badge, which
    // was confusing and excluded legitimate seekers who registered directly.
    if (filters.candidateType === 'seeker' && candidateOnboardingMode(candidate)) return false;
    if (filters.onboardingStatus && onboardingStatusKey(candidate.onboarding?.status) !== filters.onboardingStatus) return false;
    if (filters.status.length && !filters.status.includes(candidate.status)) return false;
    if (filters.role && !(candidate.role || '').toLowerCase().includes(filters.role.toLowerCase())) return false;
    if (filters.region && !(candidate.region || '').toLowerCase().includes(filters.region.toLowerCase())) return false;
    if (filters.skills.length) {
      const candSkills = (candidate.skills || []).map((skill) => skill.toLowerCase());
      if (!filters.skills.every((skill) => candSkills.includes(skill.toLowerCase()))) return false;
    }
    if (filters.availability) {
      const available = candidate.availability_on ? new Date(candidate.availability_on) : null;
      if (!available || available.getTime() < new Date(filters.availability).getTime()) return false;
    }
    if (filters.createdFrom) {
      const created = candidate.created_at ? new Date(candidate.created_at) : null;
      if (!created || created < new Date(filters.createdFrom)) return false;
    }
    if (filters.createdTo) {
      const created = candidate.created_at ? new Date(candidate.created_at) : null;
      if (!created || created > new Date(filters.createdTo)) return false;
    }
    return true;
  }

  function renderSourceTabs(counts = {}) {
    const tabs = Array.isArray(elements.sourceTabs) ? elements.sourceTabs : [];
    tabs.forEach((button) => {
      const key = button.dataset.sourceTab;
      const active = key === state.sourceTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      const countHost = qs(`[data-source-count="${key}"]`, button);
      if (countHost) countHost.textContent = String(counts[key] || 0);
    });
  }

  function applyFilters() {
    const datasets = buildSourceDatasets();
    const activeSet = Array.isArray(datasets[state.sourceTab]) ? datasets[state.sourceTab] : datasets.website;
    renderSourceTabs({
      website: datasets.website.length,
      'timesheet-portal-active': datasets['timesheet-portal-active'].length,
      'timesheet-portal': datasets['timesheet-portal'].length,
      combined: datasets.combined.length,
    });
    state.filtered = activeSet.filter((candidate) => matchesFilters(candidate));
    state.filtered.sort((a, b) => {
      const dir = state.sort.dir === 'asc' ? 1 : -1;
      if (state.sort.key === 'name') {
        return String(a.name || '').localeCompare(String(b.name || '')) * dir;
      }
      const av = a[state.sort.key] || '';
      const bv = b[state.sort.key] || '';
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
    updateFilterCount();
    recomputeMetrics();
    renderOnboardingModule();
    renderTableHeader();
    refreshRows(true);
    syncHeaderCheckbox();
  }

  function recomputeMetrics() {
    const total = state.filtered.length;
    const websiteBackedRows = state.filtered.filter((row) => !isRawTimesheetPortalCandidate(row));
    const countStatus = (status) => websiteBackedRows.filter((row) => row.status === status).length;
    const countBy = (predicate) => websiteBackedRows.filter(predicate).length;
    state.metrics = {
      total,
      seekers: countBy((row) => !candidateOnboardingMode(row)),
      starters: countBy((row) => candidateOnboardingMode(row)),
      // 'Invited' = provisional new starters awaiting registration (created via send-intro-email)
      invited: countBy((row) => candidateOnboardingMode(row) && String(row.status || '').toLowerCase() === 'invited'),
      progress: countStatus('in progress'),
      ready: countBy((row) => row.onboarding?.onboardingComplete === true),
      rtwMissing: countBy((row) => row.onboarding?.hasRightToWork !== true && row.onboarding?.hasRightToWorkUpload !== true),
      toVerify: countBy((row) => (row.onboarding?.pendingVerificationCount || 0) > 0),
      archived: countStatus('archived'),
      blocked: countStatus('blocked')
    };
    updateTotals();
  }

  function updateTotals() {
    if (elements.total) elements.total.textContent = state.metrics.total;
    const showWorkflowCounts = state.sourceTab !== 'timesheet-portal';
    if (elements.tSeekers) elements.tSeekers.textContent = showWorkflowCounts ? state.metrics.seekers : '—';
    if (elements.tStarters) elements.tStarters.textContent = showWorkflowCounts ? state.metrics.starters : '—';
    if (elements.tInvited) elements.tInvited.textContent = showWorkflowCounts ? state.metrics.invited : '—';
    if (elements.progress) elements.progress.textContent = showWorkflowCounts ? state.metrics.progress : '—';
    if (elements.ready) elements.ready.textContent = showWorkflowCounts ? state.metrics.ready : '—';
    if (elements.rtwMissing) elements.rtwMissing.textContent = showWorkflowCounts ? state.metrics.rtwMissing : '—';
    if (elements.toVerify) elements.toVerify.textContent = showWorkflowCounts ? state.metrics.toVerify : '—';
    if (elements.archived) elements.archived.textContent = showWorkflowCounts ? state.metrics.archived : '—';
    if (elements.blocked) elements.blocked.textContent = showWorkflowCounts ? state.metrics.blocked : '—';
  }

  function onboardingRowsInView() {
    return state.filtered.filter((row) => !isRawTimesheetPortalCandidate(row) && candidateOnboardingMode(row));
  }

  function setOnboardingStatusFilter(statusKey) {
    state.filters.onboardingStatus = state.filters.onboardingStatus === statusKey ? '' : statusKey;
    saveFilters(state.filters);
    applyFilters();
  }

  function renderOnboardingModule() {
    if (!elements.onboardingModule || !elements.onboardingStatusStrip || !elements.onboardingModuleSummary) return;
    const active = onboardingViewActive();
    elements.onboardingModule.hidden = !active;
    if (!active) return;
    const rows = onboardingRowsInView();
    const actionableRows = rows.filter((row) => !!String(row?.email || '').trim() && !isArchived(row));
    const selectedRows = selectedCandidates({ allowRaw: true, includeRaw: true })
      .filter((row) => !isRawTimesheetPortalCandidate(row) && candidateOnboardingMode(row) && !!String(row?.email || '').trim() && !isArchived(row));
    const actionCount = selectedRows.length || actionableRows.length;
    const counts = rows.reduce((acc, row) => {
      const key = onboardingStatusKey(row.onboarding?.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const urgent = rows.filter((row) => (row.onboarding?.missingCount || 0) > 0 || (row.onboarding?.pendingVerificationCount || 0) > 0).length;
    const lastEmail = rows
      .map((row) => row.onboarding?.emailHistory?.lastSentAt || '')
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || '';
    elements.onboardingModuleSummary.textContent = rows.length
      ? `${rows.length} new starter record${rows.length === 1 ? '' : 's'} in this view. ${urgent} need action${lastEmail ? ` · last onboarding email ${formatDateTime(lastEmail)}` : ''}.`
      : 'No new starter records match the current filters.';
    const buttons = [
      { key: '', label: 'All starters', count: rows.length, tone: 'gray' },
    ].concat(Object.keys(ONBOARDING_STATUS_META).map((key) => ({
      key,
      label: ONBOARDING_STATUS_META[key].label,
      count: counts[key] || 0,
      tone: ONBOARDING_STATUS_META[key].tone,
    })));
    elements.onboardingStatusStrip.innerHTML = buttons.map((item) => `
      <button class="btn ${state.filters.onboardingStatus === item.key || (!state.filters.onboardingStatus && !item.key) ? '' : 'ghost'} small" type="button" data-onboarding-status-filter="${item.key}" style="display:flex;align-items:center;gap:8px">
        <span class="chip ${item.tone}">${escapeHtml(item.label)}</span>
        <strong>${item.count}</strong>
      </button>
    `).join('');
    if (elements.onboardingBulkIntro) elements.onboardingBulkIntro.disabled = actionCount === 0;
    if (elements.onboardingBulkReminder) elements.onboardingBulkReminder.disabled = actionCount === 0;
    if (elements.onboardingBulkDocs) elements.onboardingBulkDocs.disabled = actionCount === 0;
    if (elements.onboardingBulkVerified) elements.onboardingBulkVerified.disabled = actionCount === 0;
    elements.onboardingStatusStrip.querySelectorAll('[data-onboarding-status-filter]').forEach((button) => {
      button.addEventListener('click', () => setOnboardingStatusFilter(button.dataset.onboardingStatusFilter || ''));
    });
  }

  function ensureRowsContainer() {
    if (!elements.rows.contains(rowsInner)) {
      elements.rows.innerHTML = '';
      elements.rows.appendChild(rowsInner);
    }
  }

  function tableMode() {
    return state.sourceTab === 'timesheet-portal-active' ? 'assignments' : 'candidates';
  }

  function renderTableHeader() {
    if (!elements.table || !elements.thead) return;
    const assignmentsView = tableMode() === 'assignments';
    const onboardingView = !assignmentsView && onboardingViewActive();
    elements.table.classList.toggle('assignments-view', assignmentsView);
    elements.thead.innerHTML = assignmentsView
      ? `
        <div><input type="checkbox" id="chk-all"/></div>
        <div>Ref</div>
        <div>Assignment code</div>
        <div>Candidate</div>
        <div>Client</div>
        <div>Description</div>
        <div>Branch</div>
        <div>Start date</div>
        <div>End date</div>
        <div>Cost centre</div>
        <div>IR35</div>
        <div>Assigned approvers</div>
        <div>Assigned contractors</div>
        <div>Actions</div>
      `
      : onboardingView
      ? `
        <div><input type="checkbox" id="chk-all"/></div>
        <div>Ref</div>
        <div>New starter</div>
        <div>Assignment / contact</div>
        <div>Onboarding</div>
        <div>Right to work / payroll</div>
        <div>Actions</div>
      `
      : `
        <div><input type="checkbox" id="chk-all"/></div>
        <div>Ref</div>
        <div>Candidate</div>
        <div>Contact</div>
        <div>Type / Onboarding</div>
        <div>Status</div>
        <div>Actions</div>
      `;
    elements.chkAll = qs('#chk-all', elements.thead);
    syncHeaderCheckbox();
  }

  function renderSkeleton() {
    ensureRowsContainer();
    rowsInner.innerHTML = '';
    const count = 12;
    rowsInner.style.height = `${count * ROW_HEIGHT}px`;
    for (let i = 0; i < count; i += 1) {
      const row = document.createElement('div');
      row.className = 'trow skeleton';
      row.style.position = 'absolute';
      row.style.top = `${i * ROW_HEIGHT}px`;
      row.innerHTML = '<div class="skeleton-bar"></div>'.repeat(7);
      rowsInner.appendChild(row);
    }
  }

  function refreshRows(force = false) {
    ensureRowsContainer();
    const total = state.filtered.length;
    rowsInner.style.height = `${total * ROW_HEIGHT}px`;
    if (!total) {
      const loadingTsp = state.sourceTab !== 'website' && !state.tspCompare;
      const loadingAssignments = state.sourceTab === 'timesheet-portal-active' && state.assignmentLoading;
      const configured = state.tspCompare?.configured !== false;
      const message = loadingTsp
        ? 'Loading Timesheet Portal data…'
        : loadingAssignments
        ? 'Loading active assignment data…'
        : state.sourceTab === 'timesheet-portal' && !configured
        ? (state.tspCompare?.message || 'Timesheet Portal is not configured for this environment.')
        : `No ${sourceTabLabel().toLowerCase()} rows match the filters.`;
      rowsInner.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
      return;
    }
    if (force) rowsInner.innerHTML = '';
    updateVisibleRows();
  }

  function updateVisibleRows() {
    const viewport = elements.rows;
    if (!viewport) return;
    const scrollTop = viewport.scrollTop;
    const height = viewport.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - RENDER_PADDING);
    const end = Math.min(state.filtered.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + RENDER_PADDING);
    rowsInner.innerHTML = '';
    for (let i = start; i < end; i += 1) {
      const candidate = state.filtered[i];
      const row = buildRow(candidate, i);
      rowsInner.appendChild(row);
    }
  }

  function selectionHas(id) {
    return state.selection.has(String(id));
  }

  function isArchived(candidate) {
    return String(candidate?.status || '').toLowerCase() === 'archived';
  }

  function isBlocked(candidate) {
    return String(candidate?.status || '').toLowerCase() === 'blocked';
  }

  function onboardingTone(candidate) {
    if (candidate?.onboarding?.onboardingComplete) return 'green';
    if (candidate?.onboarding?.hasRightToWork === false) return 'orange';
    return 'gray';
  }

  function rightToWorkChip(candidate) {
    const onboarding = candidate?.onboarding || {};
    if (onboarding.hasRightToWork === true) return { label: 'RTW verified', tone: 'green' };
    if (onboarding.hasRightToWorkPendingVerification === true || onboarding.pendingVerificationCount > 0) {
      return { label: 'RTW to verify', tone: 'orange' };
    }
    if (onboarding.hasRightToWorkUpload === true) return { label: 'RTW uploaded', tone: 'orange' };
    return { label: 'RTW missing', tone: 'orange' };
  }

  function paymentReference(candidate) {
    const lastFour = String(candidate?.payment_summary?.lastFour || '').trim();
    return lastFour ? `••••${lastFour}` : 'Pending';
  }

  function normaliseBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined || value === '') return false;
    const text = String(value).trim().toLowerCase();
    return text === 'true' || text === '1' || text === 'yes' || text === 'on';
  }

  function candidateOnboardingMode(candidate) {
    if (normaliseBooleanFlag(candidate?.onboarding_mode ?? candidate?.onboardingMode)) return true;
    // Fallback: 'Invited' status = provisionally created via send-intro-email flow.
    // This catches records where onboarding_mode failed to save (e.g. column missing from schema).
    const status = String(candidate?.status || '').toLowerCase().trim();
    return status === 'invited';
  }

  function candidateModeLabel(candidate) {
    return candidateOnboardingMode(candidate) ? 'Live onboarding' : 'Recruitment profile';
  }

  function candidateModeDescription(candidate) {
    return candidateOnboardingMode(candidate)
      ? 'HMJ is collecting onboarding, right-to-work, payroll, and mobilisation details for a live placement.'
      : 'Candidate is registered on the website for recruitment, applications, CV storage, and profile updates only.';
  }

  function candidateReference(candidate) {
    return String(candidate?.ref || candidate?.payroll_ref || candidate?.internal_ref || '').trim() || '—';
  }

  function displayCandidateReference(candidate) {
    return String(
      candidate?.ref
      || candidate?.payroll_ref
      || candidate?.internal_ref
      || candidate?.timesheet_portal_reference
      || candidate?.timesheet_portal_match?.reference
      || candidate?.timesheet_portal_match?.accountingReference
      || candidate?.active_assignment_summary?.reference
      || ''
    ).trim() || '—';
  }

  function referenceChip(candidate) {
    const reference = displayCandidateReference(candidate);
    if (!reference || reference === '—') return '';
    return `<span class="chip gray">Ref ${escapeHtml(reference)}</span>`;
  }

  function renderReferenceCell(candidate) {
    const reference = displayCandidateReference(candidate);
    return reference === '—'
      ? '<span class="row-subtle">—</span>'
      : `<span class="row-ref">${escapeHtml(reference)}</span>`;
  }

  function sourceMetaChips(candidate) {
    const activeChip = Number(candidate?.active_assignment_count || 0) > 0
      ? `<span class="chip green">${candidate.active_assignment_count} active</span>`
      : '';
    if (isRawTimesheetPortalCandidate(candidate)) {
      return `${activeChip}<span class="chip blue">Timesheet Portal</span>`;
    }
    if (candidate?.timesheet_portal_match) {
      return `${activeChip}<span class="chip blue">TSP matched</span>`;
    }
    if (state.sourceTab === 'combined') {
      return `${activeChip}<span class="chip gray">Website</span>`;
    }
    return activeChip;
  }

  function paymentMethodLabel(value) {
    return String(value || '').toLowerCase() === 'iban_swift' ? 'IBAN / SWIFT' : 'Sort code / account number';
  }

  function documentGroupKey(type) {
    const raw = normalizeDocumentRequestType(type) || String(type || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (raw === 'passport' || raw === 'right_to_work' || raw === 'visa_permit') return 'right_to_work';
    if (raw === 'qualification_certificate') return 'qualifications';
    if (raw === 'reference') return 'references';
    if (raw === 'bank_document') return 'bank';
    if (raw === 'cv' || raw === 'cover_letter') return 'cv';
    return 'other';
  }

  function groupDocuments(docs) {
    const groups = new Map(DOCUMENT_GROUPS.map((group) => [documentGroupKey(group.types[0]), { ...group, items: [] }]));
    (Array.isArray(docs) ? docs : []).forEach((doc) => {
      const key = documentGroupKey(doc?.document_type || doc?.kind);
      const group = groups.get(key) || groups.get('other');
      if (group) group.items.push(doc);
    });
    return Array.from(groups.values());
  }

  function buildPaymentDraft(candidate) {
    const existing = candidate?.payment_details_admin && typeof candidate.payment_details_admin === 'object'
      ? candidate.payment_details_admin
      : null;
    const summary = candidate?.payment_summary || {};
    const method = String(existing?.paymentMethod || summary.paymentMethod || 'gbp_local').toLowerCase() === 'iban_swift'
      ? 'iban_swift'
      : 'gbp_local';
    return {
      id: existing?.id || summary.id || '',
      accountCurrency: String(existing?.accountCurrency || summary.accountCurrency || 'GBP').trim() || 'GBP',
      paymentMethod: method,
      accountHolderName: String(existing?.accountHolderName || summary.accountHolderName || '').trim(),
      bankName: String(existing?.bankName || summary.bankName || '').trim(),
      bankLocationOrCountry: String(existing?.bankLocationOrCountry || summary.bankLocationOrCountry || '').trim(),
      accountType: String(existing?.accountType || '').trim(),
      values: {
        sortCode: String(existing?.values?.sortCode || '').trim(),
        accountNumber: String(existing?.values?.accountNumber || '').trim(),
        iban: String(existing?.values?.iban || '').trim(),
        swiftBic: String(existing?.values?.swiftBic || '').trim(),
      },
      masked: {
        sortCode: String(existing?.masked?.sortCode || summary.masked?.sortCode || '').trim(),
        accountNumber: String(existing?.masked?.accountNumber || summary.masked?.accountNumber || '').trim(),
        iban: String(existing?.masked?.iban || summary.masked?.iban || '').trim(),
        swiftBic: String(existing?.masked?.swiftBic || summary.masked?.swiftBic || '').trim(),
      },
      lastFour: String(existing?.lastFour || summary.lastFour || '').trim(),
      verifiedAt: existing?.verifiedAt || summary.verifiedAt || null,
      updatedAt: existing?.updatedAt || summary.updatedAt || '',
      loadedSensitive: existing?.loadedSensitive === true,
      legacyFallback: existing?.legacyFallback === true || summary.legacyFallback === true,
      completion: summary.completion || existing?.completion || { complete: false, missing: ['payment_details'] },
    };
  }

  function ensurePaymentDraft(candidate) {
    candidate.payment_details_admin = buildPaymentDraft(candidate);
    return candidate.payment_details_admin;
  }

  function hasDirtyPaymentFields() {
    return !!elements.dwPayment?.querySelector('[data-payment-field][data-dirty="true"]');
  }

  function buildRow(candidate, index) {
    if (state.sourceTab === 'timesheet-portal-active') {
      const assignment = primaryActiveAssignment(candidate);
      if (assignment) return buildActiveAssignmentRow(candidate, assignment, index);
    }
    return buildCandidateRow(candidate, index);
  }

  function buildActiveAssignmentRow(candidate, assignment, index) {
    const row = document.createElement('div');
    row.className = 'trow';
    row.dataset.id = candidate.id;
    row.style.position = 'absolute';
    row.style.top = `${index * ROW_HEIGHT}px`;
    const selected = selectionHas(candidate.id) ? 'checked' : '';
    const selectable = isSelectableCandidate(candidate, currentSelectionOptions());
    const sourceChip = sourceMetaChips(candidate);
    const rawCandidate = isRawTimesheetPortalCandidate(candidate);
    const assignmentRef = String(assignment?.as_ref || assignment?.reference || '—').trim() || '—';
    const clientName = assignment?.client_name || assignment?.client_code || '—';
    const branchName = assignment?.branch_name || assignment?.client_site || '—';
    const description = assignment?.assignment_description || assignment?.job_title || candidate?.role || '—';
    const approvers = assignment?.assigned_approvers || candidate?.consultant_name || '—';
    const contractors = assignment?.assigned_contractors || candidate?.name || '—';
    const assignmentStatus = statusLabel(assignment?.status || 'live');
    const candidateActionRole = rawCandidate ? 'promote' : 'open';
    const candidateActionLabel = rawCandidate ? 'Prepare' : 'Candidate';
    row.innerHTML = `
      <div><input type="checkbox" data-role="select" data-id="${candidate.id}" ${selected} ${!selectable ? 'disabled' : ''}></div>
      <div>${renderReferenceCell(candidate)}</div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(assignmentRef)}">${escapeHtml(assignmentRef)}</div>
        <div class="row-subtle">${escapeHtml(assignment?.assignment_category || assignment?.job_title || 'Live assignment')}</div>
        <div class="row-meta">
          ${sourceChip}
          <span class="chip ${statusTone(assignment?.status || 'live')}">${escapeHtml(assignmentStatus)}</span>
        </div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(candidate.name || 'Candidate')}">${escapeHtml(candidate.name || '—')}</div>
        <div class="row-subtle">${escapeHtml(candidate.role || 'Role pending')}</div>
        <div class="row-subtle">${escapeHtml(candidate.email || 'No email')}${candidate.phone ? ` · ${escapeHtml(candidate.phone)}` : ''}</div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(clientName)}">${escapeHtml(clientName)}</div>
        <div class="row-subtle">${escapeHtml(candidateModeLabel(candidate))}</div>
        <div class="row-subtle">${candidate.active_assignment_count > 1 ? `${candidate.active_assignment_count} active assignments` : 'Single active assignment'}</div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(description)}">${escapeHtml(description)}</div>
        <div class="row-subtle">${assignment?.last_modified ? `Updated ${escapeHtml(formatDate(assignment.last_modified))}` : 'Assignment summary'}</div>
      </div>
      <div class="row-card">
        <div class="row-title">${escapeHtml(branchName)}</div>
        <div class="row-subtle">${escapeHtml(assignment?.assignment_category || 'Branch / business unit')}</div>
      </div>
      <div class="row-card">
        <div class="row-title">${escapeHtml(formatAssignmentDateCell(assignment?.start_date))}</div>
        <div class="row-subtle">${escapeHtml(formatAssignmentPay(assignment))}</div>
      </div>
      <div class="row-card">
        <div class="row-title">${escapeHtml(formatAssignmentDateCell(assignment?.end_date, 'Open'))}</div>
        <div class="row-subtle">${rawCandidate ? 'TSP mirrored worker' : 'Website candidate linked'}</div>
      </div>
      <div class="row-card">
        <div class="row-title">${escapeHtml(assignment?.cost_centre || '—')}</div>
        <div class="row-subtle">${escapeHtml(assignment?.client_code || 'Cost centre')}</div>
      </div>
      <div class="row-card">
        <div class="row-title">${escapeHtml(assignment?.ir35_status || '—')}</div>
        <div class="row-subtle">IR35</div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(approvers)}">${escapeHtml(approvers)}</div>
        <div class="row-subtle">Assigned approvers</div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(contractors)}">${escapeHtml(contractors)}</div>
        <div class="row-subtle">Assigned contractors</div>
      </div>
      <div class="row-actions">
        <button class="btn ghost small" type="button" data-role="${candidateActionRole}" data-id="${candidate.id}">${candidateActionLabel}</button>
        <button class="btn ghost small" type="button" data-role="open-assignment" data-id="${candidate.id}" ${assignmentRef === '—' ? 'disabled' : ''}>Assignment</button>
        <button class="btn ghost small" type="button" data-role="open-timesheets" data-id="${candidate.id}" ${assignmentRef === '—' ? 'disabled' : ''}>Timesheets</button>
        <button class="btn ghost small" type="button" data-role="copy-assignment-code" data-id="${candidate.id}" ${assignmentRef === '—' ? 'disabled' : ''}>Copy code</button>
      </div>`;
    return row;
  }

  function buildCandidateRow(candidate, index) {
    if (onboardingViewActive() && candidateOnboardingMode(candidate) && !isRawTimesheetPortalCandidate(candidate)) {
      return buildStarterCandidateRow(candidate, index);
    }
    const row = document.createElement('div');
    row.className = 'trow';
    row.dataset.id = candidate.id;
    row.style.position = 'absolute';
    row.style.top = `${index * ROW_HEIGHT}px`;
    const selected = selectionHas(candidate.id) ? 'checked' : '';
    const selectable = isSelectableCandidate(candidate);
    const disabledActions = isBlocked(candidate) || !selectable;
    const sourceChip = sourceMetaChips(candidate);
    if (isRawTimesheetPortalCandidate(candidate)) {
      const rawSelectable = isSelectableCandidate(candidate, currentSelectionOptions());
      const assignmentMeta = formatActiveAssignmentMeta(candidate);
      row.innerHTML = `
        <div><input type="checkbox" data-role="select" data-id="${candidate.id}" ${selected} ${!rawSelectable ? 'disabled' : ''}></div>
        <div>${renderReferenceCell(candidate)}</div>
        <div class="row-card">
          <div class="row-title" title="${candidate.name || 'Timesheet Portal candidate'}">${candidate.name || '—'}</div>
          <div class="row-subtle" title="${candidate.role || 'Timesheet Portal record'}">${candidate.role || 'Timesheet Portal record'}</div>
          <div class="row-meta">
            ${candidate.region ? `<span class="chip gray">${candidate.region}</span>` : ''}
            ${referenceChip(candidate)}
            ${sourceChip}
          </div>
        </div>
        <div class="row-card">
          <div class="row-title" title="${candidate.email || 'No email'}">${candidate.email || '—'}</div>
          <div class="row-subtle">${candidate.phone || 'Phone not available'}</div>
          <div class="row-subtle">${candidate.updated_at ? `Fetched ${formatDate(candidate.updated_at)}` : 'Raw Timesheet Portal record'}</div>
        </div>
        <div class="row-card">
          <div class="row-meta">
            <span class="chip blue">${rawSelectable ? 'Ready for website outreach' : candidate.active_assignment_count ? 'Email required for outreach' : 'Website onboarding not started'}</span>
          </div>
          <div class="row-subtle">${assignmentMeta || 'This row exists in Timesheet Portal only.'}</div>
          <div class="row-subtle">${rawSelectable ? 'Select this row to create an HMJ candidate profile automatically when you send intro, RTW, or document outreach.' : 'Use the sync tools above to mirror it into the website candidate workspace before onboarding outreach.'}</div>
          <div class="row-subtle">TSP ref: ${candidateReference(candidate)}</div>
        </div>
        <div><span class="chip blue">TSP raw</span></div>
        <div class="row-actions">
          <button class="btn ghost small" type="button" data-role="copy-email" data-id="${candidate.id}" ${!candidate.email ? 'disabled' : ''}>Copy email</button>
          <button class="btn ghost small" type="button" data-role="copy-ref" data-id="${candidate.id}" ${candidateReference(candidate) === '—' ? 'disabled' : ''}>Copy ref</button>
        </div>`;
      return row;
    }
    const archiveRole = isArchived(candidate) ? 'restore' : 'archive';
    const archiveLabel = isArchived(candidate) ? 'Restore' : 'Archive';
    const portalChip = candidate.has_portal_account
      ? '<span class="chip blue">Portal linked</span>'
      : candidate.portal_account_state === 'closed'
      ? '<span class="chip gray">Portal closed</span>'
      : '';
    const onboarding = candidate.onboarding || {};
    const onboardingMode = candidateOnboardingMode(candidate);
    const paymentSummary = candidate.payment_summary || {};
    const rtwChip = rightToWorkChip(candidate);
    const assignmentMeta = formatActiveAssignmentMeta(candidate);
    row.innerHTML = `
      <div><input type="checkbox" data-role="select" data-id="${candidate.id}" ${selected} ${!selectable ? 'disabled' : ''}></div>
      <div>${renderReferenceCell(candidate)}</div>
      <div class="row-card">
        <div class="row-title" title="${candidate.name || 'Candidate'}">${candidate.name || '—'}</div>
        <div class="row-subtle" title="${candidate.role || 'Role pending'}">${candidate.role || 'Role pending'}</div>
        <div class="row-meta">
          <span class="type-badge type-badge--${onboardingMode ? 'starter' : 'seeker'}" title="${onboardingMode ? 'New starter: onboarding & payroll setup' : 'Job seeker: recruitment profile'}">${onboardingMode ? 'New Starter' : 'Job Seeker'}</span>
          ${candidate.region ? `<span class="chip gray">${candidate.region}</span>` : ''}
          ${referenceChip(candidate)}
          ${portalChip}
          ${sourceChip}
        </div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${candidate.email || 'No email'}">${candidate.email || '—'}</div>
        <div class="row-subtle">${candidate.phone || 'Phone not added'}</div>
        <div class="row-subtle">Updated ${formatDate(candidate.updated_at)}</div>
      </div>
      <div class="row-card">
        <div class="row-meta">
          <span class="chip ${onboardingMode ? 'orange' : 'gray'}">${candidateModeLabel(candidate)}</span>
          <span class="chip ${rtwChip.tone}">${onboardingMode ? rtwChip.label : (onboarding.hasRightToWork ? 'RTW on file' : 'RTW not required yet')}</span>
          <span class="chip ${paymentSummary.completion?.complete ? 'green' : 'gray'}">${paymentSummary.completion?.complete ? 'Payment on file' : (onboardingMode ? 'Payment pending' : 'Payroll not required')}</span>
          ${onboarding.pendingVerificationCount ? `<span class="chip orange">${onboarding.pendingVerificationCount} to verify</span>` : ''}
        </div>
        <div class="row-subtle">${assignmentMeta || (onboardingMode
          ? `Onboarding: <strong class="row-inline-strong ${onboardingTone(candidate)}">${onboarding.onboardingComplete ? 'Ready' : 'Action needed'}</strong>`
          : 'Portal path: <strong class="row-inline-strong">Recruitment profile only</strong>')}</div>
        ${assignmentMeta ? `<div class="row-subtle">${onboardingMode
          ? `Onboarding: <strong class="row-inline-strong ${onboardingTone(candidate)}">${onboarding.onboardingComplete ? 'Ready' : 'Action needed'}</strong>`
          : 'Portal path: <strong class="row-inline-strong">Recruitment profile only</strong>'}</div>` : ''}
        <div class="row-subtle">${onboardingMode ? `Payment ref: ${paymentReference(candidate)}` : 'Payroll onboarding starts only when HMJ marks a live placement.'}</div>
      </div>
      <div><span class="chip ${statusTone(candidate.status)}">${statusLabel(candidate.status)}</span></div>
      <div class="row-actions">
        <button class="btn ghost small" type="button" data-role="open" data-id="${candidate.id}">Open</button>
        <button class="btn ghost small" type="button" data-role="${archiveRole}" data-id="${candidate.id}">${archiveLabel}</button>
        <button class="btn ghost small" type="button" data-role="pdf" data-id="${candidate.id}" ${disabledActions ? 'disabled' : ''}>PDF</button>
      </div>`;
    return row;
  }

  function buildStarterCandidateRow(candidate, index) {
    const row = document.createElement('div');
    row.className = 'trow';
    row.dataset.id = candidate.id;
    row.style.position = 'absolute';
    row.style.top = `${index * ROW_HEIGHT}px`;
    const selected = selectionHas(candidate.id) ? 'checked' : '';
    const onboarding = candidate.onboarding || {};
    const paymentSummary = candidate.payment_summary || {};
    const rightToWork = onboarding.rightToWork || {};
    const emailHistory = onboarding.emailHistory || {};
    const missingCore = Array.isArray(onboarding.missingCore) ? onboarding.missingCore : [];
    const missingRecommended = Array.isArray(onboarding.missingRecommended) ? onboarding.missingRecommended : [];
    const lastEmail = lastEmailSentAt(
      emailHistory,
      'onboardingConfirmationSentAt',
      'onboardingReminderSentAt',
      'documentRequestSentAt',
      'rtwReminderSentAt',
      'introReminderSentAt',
      'introSentAt',
      'verificationCompleteSentAt',
    );
    const actionNeeded = missingCore.length || onboarding.pendingVerificationCount || rightToWork.documentStatus === 'rejected';
    const canVerify = !!rightToWork.documentId && rightToWork.documentStatus === 'present';
    const quickReminderDisabled = !candidate.email || isArchived(candidate);
    row.innerHTML = `
      <div><input type="checkbox" data-role="select" data-id="${candidate.id}" ${selected}></div>
      <div>${renderReferenceCell(candidate)}</div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(candidate.name || 'Candidate')}">${escapeHtml(candidate.name || '—')}</div>
        <div class="row-subtle">${escapeHtml(candidate.current_job_title || candidate.role || 'Role pending')}</div>
        <div class="row-meta">
          <span class="type-badge type-badge--starter">New Starter</span>
          <span class="chip ${onboardingStatusTone(onboarding.status)}">${escapeHtml(onboarding.statusLabel || onboardingStatusLabel(onboarding.status))}</span>
          ${onboarding.duplicate?.duplicateEmailCount ? `<span class="chip red">${onboarding.duplicate.duplicateEmailCount} duplicate${onboarding.duplicate.duplicateEmailCount === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
      <div class="row-card">
        <div class="row-title" title="${escapeHtml(candidate.email || 'No email')}">${escapeHtml(candidate.email || '—')}</div>
        <div class="row-subtle">${escapeHtml(candidate.phone || 'Phone not added')}</div>
        <div class="row-subtle">${escapeHtml([
          candidate.availability || candidate.availability_on || null,
          candidate.primary_specialism || candidate.sector_focus || null,
          candidate.location || null,
        ].filter(Boolean).join(' • ') || 'Assignment detail pending')}</div>
      </div>
      <div class="row-card">
        <div class="row-meta">
          ${missingCore.slice(0, 3).map((item) => `<span class="chip orange">${escapeHtml(humanizeMissingField(item))}</span>`).join('')}
          ${onboarding.pendingVerificationCount ? `<span class="chip orange">${onboarding.pendingVerificationCount} to verify</span>` : ''}
          ${rightToWork.documentStatus === 'rejected' ? '<span class="chip red">Document rejected</span>' : ''}
        </div>
        <div class="row-subtle">${actionNeeded ? 'Action needed' : 'Operationally complete'}</div>
        <div class="row-subtle">${lastEmail ? `Last onboarding email ${formatDateTime(lastEmail)}` : 'No onboarding email logged yet'}</div>
      </div>
      <div class="row-card">
        <div class="row-meta">
          <span class="chip ${rightToWork.documentStatus === 'approved' ? 'green' : rightToWork.documentStatus === 'rejected' ? 'red' : rightToWork.hasUpload ? 'orange' : 'gray'}">${escapeHtml(rightToWork.documentStatus === 'approved' ? 'RTW approved' : rightToWork.documentStatus === 'rejected' ? 'RTW rejected' : rightToWork.hasUpload ? 'RTW uploaded' : 'RTW missing')}</span>
          <span class="chip ${paymentSummary.completion?.complete ? 'green' : 'orange'}">${paymentSummary.completion?.complete ? 'Payroll ready' : 'Payroll pending'}</span>
          ${candidate.consent_captured ? '<span class="chip green">Consent captured</span>' : '<span class="chip orange">Consent missing</span>'}
        </div>
        <div class="row-subtle">${escapeHtml(rightToWork.evidenceTypeLabel || evidenceTypeLabel(candidate.right_to_work_evidence_type))}${rightToWork.verifiedAt ? ` • Verified ${escapeHtml(formatDateTime(rightToWork.verifiedAt))}` : ''}</div>
        <div class="row-subtle">${paymentSummary.bankName ? `${escapeHtml(paymentSummary.bankName)} • ${escapeHtml(paymentReference(candidate))}` : 'Payment details not completed yet'}</div>
      </div>
      <div class="row-actions">
        <button class="btn ghost small" type="button" data-role="open" data-id="${candidate.id}">Open</button>
        <button class="btn ghost small" type="button" data-role="starter-reminder" data-id="${candidate.id}" ${quickReminderDisabled ? 'disabled' : ''}>Send reminder</button>
        <button class="btn ghost small" type="button" data-role="${canVerify ? 'mark-verified' : 'starter-verified'}" data-id="${candidate.id}" ${(!canVerify && !candidate.email) || isArchived(candidate) ? 'disabled' : ''}>${canVerify ? 'Mark verified' : 'Send verified'}</button>
      </div>`;
    return row;
  }

  function updateSelection(id, checked) {
    const key = String(id);
    if (checked) state.selection.add(key);
    else state.selection.delete(key);
    persistSelection();
    updateBulkBar();
    syncHeaderCheckbox();
  }

  function setSelection(ids) {
    state.selection = new Set(ids.map((id) => String(id)));
    persistSelection();
    updateBulkBar();
    refreshRows(true);
  }

  function clearSelection() {
    state.selection.clear();
    persistSelection();
    updateBulkBar();
    syncHeaderCheckbox();
    refreshRows(true);
  }

  function syncHeaderCheckbox() {
    const head = elements.chkAll;
    if (!head) return;
    const selectableRows = state.filtered.filter((row) => isSelectableCandidate(row, currentSelectionOptions()));
    if (!selectableRows.length) {
      head.checked = false;
      head.indeterminate = false;
      head.disabled = true;
      return;
    }
    head.disabled = false;
    const total = selectableRows.length;
    const selected = selectableRows.filter((row) => selectionHas(row.id)).length;
    head.checked = selected && selected === total;
    head.indeterminate = selected > 0 && selected < total;
  }

  function updateBulkBar() {
    const bar = elements.bulkbar;
    if (!bar) return;
    const selectedRows = state.filtered.filter((row) => isSelectableCandidate(row, currentSelectionOptions()) && selectionHas(row.id));
    const count = selectedRows.length;
    const websiteCount = selectedRows.filter((row) => !isRawTimesheetPortalCandidate(row)).length;
    const outreachCount = selectedRows.filter((row) => !!String(row?.email || '').trim()).length;
    bar.classList.toggle('show', count > 0);
    const label = elements.bulkCount;
    if (label) {
      label.textContent = websiteCount === count
        ? `${count} selected`
        : `${count} selected · ${websiteCount} website-ready`;
    }
    if (elements.bulkAssign) elements.bulkAssign.disabled = websiteCount === 0;
    if (elements.bulkStatus) elements.bulkStatus.disabled = websiteCount === 0;
    if (elements.bulkBlock) elements.bulkBlock.disabled = websiteCount === 0;
    if (elements.bulkArchive) elements.bulkArchive.disabled = websiteCount === 0;
    if (elements.bulkExport) elements.bulkExport.disabled = websiteCount === 0;
    if (elements.bulkCopyEmails) elements.bulkCopyEmails.disabled = outreachCount === 0;
    if (elements.bulkSendEmail) elements.bulkSendEmail.disabled = outreachCount === 0;
    if (elements.bulkIntroEmail) elements.bulkIntroEmail.disabled = outreachCount === 0;
    if (elements.bulkDocRequest) elements.bulkDocRequest.disabled = outreachCount === 0;
    if (elements.bulkReminder) elements.bulkReminder.disabled = outreachCount === 0;
  }

  function showToast(message, tone = 'info', ms = 3600) {
    if (state.helpers?.toast) {
      state.helpers.toast(message, tone, ms);
      return;
    }
    /* Fallback: append a styled child notification div to the #toast container.
       The container is always visible (display:grid) — managed by common.js CSS. */
    const host = qs('#toast');
    if (!host) return;
    const palette = { error: '#3a1418', warn: '#35240d', ok: '#0f3020', info: '#0e2038' };
    const n = document.createElement('div');
    n.style.cssText = `background:${palette[tone] || palette.info};color:#fff;padding:12px 16px;border-radius:12px;` +
      `font-size:14px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,.3);` +
      `border:1px solid rgba(255,255,255,.14);pointer-events:auto`;
    n.textContent = message;
    host.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  function updateImportButtons() {
    if (elements.importPreview) elements.importPreview.disabled = !state.importFile;
    if (elements.importConfirm) {
      const validRows = Number(state.importPreview?.validRows || 0);
      elements.importConfirm.disabled = !state.importFile || !state.importPreview || validRows <= 0;
    }
  }

  function renderImportState() {
    const statusHost = elements.importStatus;
    const summaryHost = elements.importSummary;
    const mappingHost = elements.importMapping;
    if (!statusHost || !summaryHost || !mappingHost) return;

    const file = state.importFile;
    const preview = state.importPreview;
    if (!file) {
      statusHost.textContent = 'No import file selected. Upload a CSV or Excel workbook, preview the mapping, then confirm the import.';
      summaryHost.innerHTML = '';
      mappingHost.innerHTML = '';
      updateImportButtons();
      return;
    }

    statusHost.textContent = preview
      ? `${file.name} ready. ${preview.validRows} valid row${preview.validRows === 1 ? '' : 's'}, ${preview.errorRows} row error${preview.errorRows === 1 ? '' : 's'}.`
      : `${file.name} selected. Preview the mapping before importing.`;

    if (!preview) {
      summaryHost.innerHTML = '';
      mappingHost.innerHTML = '';
      updateImportButtons();
      return;
    }

    summaryHost.innerHTML = `
      <div class="mapping-row compact">
        <div><strong>Import summary</strong><span>${preview.totalRows} parsed row${preview.totalRows === 1 ? '' : 's'} · ${preview.insertRows} insert · ${preview.updateRows} update</span></div>
        <div><strong>Columns</strong><span>${preview.mappedColumns.length} mapped${preview.unmappedColumns.length ? ` · ${preview.unmappedColumns.length} unmapped` : ''}</span></div>
      </div>
      ${preview.unmappedColumns.length ? `<div class="mapping-item"><strong>Unmapped columns</strong><p>${preview.unmappedColumns.join(', ')}</p></div>` : ''}
    `;

    const mappingRows = preview.mappedColumns
      .map((column) => `
        <div class="mapping-row">
          <div><strong>Source column</strong><code>${column.source || '—'}</code></div>
          <div><strong>HMJ field</strong><code>${column.field || 'ignored'}</code></div>
          <div><strong>Preview</strong><span>${column.field ? `Imports into ${column.field}.` : 'This column will be ignored unless renamed to a supported field.'}</span></div>
        </div>
      `)
      .join('');
    const previewRows = preview.rows
      .slice(0, 8)
      .map((row) => `
        <div class="mapping-item">
          <strong>Row ${row.rowNumber} · ${row.action === 'update' ? 'Update' : 'Insert'}${row.existing ? ` · ${row.existing.name}` : ''}</strong>
          <p>${row.identity.email || row.identity.ref || row.identity.id || 'No match key'}${row.errors.length ? ` · Errors: ${row.errors.join(' ')}` : ''}${row.warnings.length ? ` · Warnings: ${row.warnings.join(' ')}` : ''}</p>
        </div>
      `)
      .join('');
    mappingHost.innerHTML = `${mappingRows}${previewRows ? `<div class="mapping-list">${previewRows}</div>` : ''}`;
    updateImportButtons();
  }

  function renderTspSummary() {
    const statusHost = elements.tspStatus;
    const summaryHost = elements.tspSummary;
    if (!statusHost || !summaryHost) return;
    const compare = state.tspCompare;
    if (!compare) {
      statusHost.textContent = 'Checking Timesheet Portal configuration…';
      summaryHost.innerHTML = '';
      return;
    }
    if (compare.configured === false) {
      statusHost.textContent = compare.message || 'Timesheet Portal is not configured for this environment.';
      summaryHost.innerHTML = '';
      return;
    }
    if (!compare.summary) {
      statusHost.textContent = compare.message || 'Timesheet Portal comparison is unavailable right now.';
      const attempts = Array.isArray(compare.attempts) ? compare.attempts.slice(0, 4) : [];
      summaryHost.innerHTML = attempts.length
        ? `<div class="mapping-item"><strong>Latest TSP checks</strong><p>${attempts.map((attempt) => `${attempt.path} → ${attempt.status}${attempt.authScheme ? ` (${attempt.authScheme})` : ''}`).join(' · ')}</p></div>`
        : '';
      return;
    }
    statusHost.textContent = `Compared ${compare.summary.websiteTotal} website candidates against ${compare.summary.timesheetPortalTotal} Timesheet Portal profiles.`;
    summaryHost.innerHTML = `
      <div class="mapping-row compact">
        <div><strong>Matched</strong><span>${compare.summary.matched}</span></div>
        <div><strong>Differences</strong><span>${compare.summary.mismatched}</span></div>
      </div>
      <div class="mapping-row compact">
        <div><strong>Website only</strong><span>${compare.summary.websiteOnly}</span></div>
        <div><strong>TSP only</strong><span>${compare.summary.timesheetPortalOnly}</span></div>
      </div>
      ${compare.mismatches?.length ? `<div class="mapping-item"><strong>Sample mismatches</strong><p>${compare.mismatches.slice(0, 3).map((row) => `${row.name || row.email}: ${row.differences.join(', ')}`).join(' · ')}</p></div>` : ''}
      ${compare.websiteOnly?.length ? `<div class="mapping-item"><strong>Website only</strong><p>${compare.websiteOnly.slice(0, 3).map((row) => row.name || row.email).join(' · ')}</p></div>` : ''}
      ${compare.timesheetPortalOnly?.length ? `<div class="mapping-item"><strong>TSP only</strong><p>${compare.timesheetPortalOnly.slice(0, 3).map((row) => row.name || row.email).join(' · ')}</p></div>` : ''}
    `;
  }

  function selectedCandidates(options = {}) {
    return state.filtered.filter((row) => isSelectableCandidate(row, options) && selectionHas(row.id));
  }

  function matchedTimesheetPortalProfile(candidate) {
    if (!candidate) return null;
    if (candidate.timesheet_portal_match) return candidate.timesheet_portal_match;
    if (!state.tspCompare?.timesheetPortalProfiles?.length) return null;
    const email = normalizeReferenceValue(candidate.email);
    const reference = normalizeReferenceValue(candidate.payroll_ref || candidate.ref);
    return state.tspCompare.timesheetPortalProfiles.find((profile) => {
      const profileEmail = normalizeReferenceValue(profile.email);
      const profileReference = normalizeReferenceValue(profile.reference || profile.accountingReference);
      return (email && profileEmail === email) || (reference && profileReference === reference);
    }) || null;
  }

  function candidateSavePayloadFromRaw(candidate, options = {}) {
    const [firstName, ...rest] = String(candidate?.name || '').trim().split(/\s+/).filter(Boolean);
    const contractor = matchedTimesheetPortalProfile(candidate);
    const summary = candidate?.active_assignment_summary || null;
    return {
      first_name: candidate?.first_name || firstName || 'Candidate',
      last_name: candidate?.last_name || rest.join(' ') || 'Candidate',
      full_name: candidate?.full_name || candidate?.name || [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || 'Candidate',
      email: candidate?.email || '',
      phone: candidate?.phone || '',
      role: candidate?.role || summary?.job_title || '',
      headline_role: candidate?.headline_role || candidate?.role || summary?.job_title || '',
      location: candidate?.location || candidate?.region || '',
      country: candidate?.country || candidate?.region || 'United Kingdom',
      payroll_ref: candidate?.payroll_ref || candidate?.ref || contractor?.reference || contractor?.accountingReference || null,
      ref: candidate?.ref || candidate?.payroll_ref || contractor?.reference || contractor?.accountingReference || null,
      status: 'active',
      onboarding_mode: options.onboardingMode === true,
    };
  }

  function mergePromotedCandidate(candidate, originalRawCandidate = null) {
    const contractor = matchedTimesheetPortalProfile(originalRawCandidate || candidate);
    const normalised = normalizeCandidate(candidate);
    const decorated = decorateCandidateAssignments(decorateWebsiteCandidate(normalised, contractor));
    const existingIndex = state.raw.findIndex((row) => String(row.id) === String(decorated.id));
    if (existingIndex >= 0) state.raw[existingIndex] = decorated;
    else state.raw.unshift(decorated);
    return decorated;
  }

  async function ensureWebsiteCandidateForOutreach(candidate, options = {}) {
    if (!candidate) return null;
    if (!isRawTimesheetPortalCandidate(candidate)) return candidate;
    if (!String(candidate.email || '').trim()) return null;

    const existing = state.raw.find((row) => {
      if (isRawTimesheetPortalCandidate(row)) return false;
      const sameEmail = normalizeReferenceValue(row.email) && normalizeReferenceValue(row.email) === normalizeReferenceValue(candidate.email);
      const rowRef = normalizeReferenceValue(row.payroll_ref || row.ref);
      const candidateRef = normalizeReferenceValue(candidate.payroll_ref || candidate.ref);
      return sameEmail || (!!rowRef && rowRef === candidateRef);
    });
    if (existing) {
      state.selection.delete(String(candidate.id));
      state.selection.add(String(existing.id));
      return existing;
    }

    const response = await state.helpers.api('admin-candidates-save', 'POST', candidateSavePayloadFromRaw(candidate, options));
    const promoted = mergePromotedCandidate(response?.candidate || {}, candidate);
    state.selection.delete(String(candidate.id));
    state.selection.add(String(promoted.id));
    return promoted;
  }

  async function ensureWebsiteCandidatesForOutreach(rows = [], options = {}) {
    const out = [];
    const skipped = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const candidate = await ensureWebsiteCandidateForOutreach(row, options);
        if (candidate?.id) out.push(candidate);
        else skipped.push(row);
      } catch (error) {
        console.error('[candidates] raw TSP promotion failed', error);
        skipped.push(row);
      }
    }
    persistSelection();
    applyFilters();
    if (skipped.length) {
      showToast(
        `Skipped ${skipped.length} selected row${skipped.length === 1 ? '' : 's'} that could not be prepared for outreach.`,
        'warn',
        4200,
      );
    }
    return out;
  }

  function handleRowClick(event) {
    const rawTarget = event.target;
    const target = rawTarget instanceof Element
      ? rawTarget
      : rawTarget && rawTarget.parentElement instanceof Element
      ? rawTarget.parentElement
      : null;
    if (!target) return;
    const action = target.closest('[data-role]');
    const row = target.closest('.trow');
    const role = action?.dataset.role || '';
    const id = action?.dataset.id || row?.dataset.id;
    if (!role) {
      const candidate = id ? state.filtered.find((row) => String(row.id) === String(id)) : null;
      if (candidate && !isRawTimesheetPortalCandidate(candidate)) openDrawer(id);
      return;
    }
    if (!id) return;
    if (role === 'select') {
      updateSelection(id, action instanceof HTMLInputElement ? action.checked : false);
      return;
    }
    if (role === 'open') {
      openDrawer(id);
      return;
    }
    if (role === 'promote') {
      const candidate = state.filtered.find((entry) => String(entry.id) === String(id));
      if (!candidate) return;
      void ensureWebsiteCandidateForOutreach(candidate, { onboardingMode: true })
        .then((promoted) => {
          if (promoted?.id) {
            showToast('Website candidate created for this live worker.', 'info', 3200);
            openDrawer(promoted.id);
          }
        })
        .catch((err) => {
          console.error('[candidates] candidate promotion failed', err);
          showToast(err.message || 'Could not prepare this candidate for website onboarding.', 'error', 4200);
        });
      return;
    }
    if (role === 'open-assignment') {
      const candidate = state.filtered.find((entry) => String(entry.id) === String(id));
      const assignment = primaryActiveAssignment(candidate);
      if (assignment) window.open(assignmentSearchUrl(assignment), '_blank', 'noopener');
      return;
    }
    if (role === 'open-timesheets') {
      const candidate = state.filtered.find((entry) => String(entry.id) === String(id));
      const assignment = primaryActiveAssignment(candidate);
      if (assignment) window.open(timesheetsSearchUrl(assignment, candidate), '_blank', 'noopener');
      return;
    }
    if (role === 'copy-assignment-code') {
      const candidate = state.filtered.find((entry) => String(entry.id) === String(id));
      const assignment = primaryActiveAssignment(candidate);
      copyText(String(assignment?.as_ref || assignment?.reference || '').trim()).then((copied) => {
        if (copied) showToast('Assignment code copied.', 'info', 2400);
      });
      return;
    }
    if (role === 'archive' || role === 'restore') {
      const candidate = findCandidate(id);
      if (candidate) toggleArchive(candidate);
      return;
    }
    if (role === 'pdf') {
      const candidate = findCandidate(id);
      if (candidate) generatePdf(candidate);
      return;
    }
    if (role === 'starter-reminder') {
      const candidate = findCandidate(id);
      if (!candidate) return;
      void sendOnboardingRequest({
        candidateIds: [candidate.id],
        requestType: 'general',
        skipConfirm: true,
      }).catch((err) => {
        console.error('[candidates] onboarding reminder failed', err);
        showToast(err.message || 'Could not send onboarding reminder.', 'error', 4200);
      });
      return;
    }
    if (role === 'mark-verified') {
      const candidate = findCandidate(id);
      const documentId = candidate?.onboarding?.rightToWork?.documentId;
      if (!candidate || !documentId) return;
      void reviewCandidateDocument(candidate, documentId, 'verify').catch((err) => {
        console.error('[candidates] quick verify failed', err);
        showToast(err.message || 'Could not verify the right-to-work document.', 'error', 4200);
      });
      return;
    }
    if (role === 'starter-verified') {
      const candidate = findCandidate(id);
      if (!candidate) return;
      void sendOnboardingRequest({
        candidateIds: [candidate.id],
        requestType: 'verification_complete',
        skipConfirm: true,
      }).catch((err) => {
        console.error('[candidates] verification complete email failed', err);
        showToast(err.message || 'Could not send the verification complete email.', 'error', 4200);
      });
      return;
    }
    if (role === 'copy-email') {
      const candidate = state.filtered.find((row) => String(row.id) === String(id));
      copyText(candidate?.email || '').then((copied) => {
        if (copied) showToast('Email copied.', 'info', 2400);
      });
      return;
    }
    if (role === 'copy-ref') {
      const candidate = state.filtered.find((row) => String(row.id) === String(id));
      copyText(candidateReference(candidate)).then((copied) => {
        if (copied) showToast('Reference copied.', 'info', 2400);
      });
    }
  }

  function findCandidate(id) {
    const key = String(id);
    return state.raw.find((row) => String(row.id) === key) || null;
  }

  async function openDrawer(id) {
    const drawer = elements.drawer;
    if (!drawer) return;
    state.drawerId = id;
    drawer.classList.add('open');
    document.body.classList.add('drawer-open');
    const cached = findCandidate(id);
    if (cached) renderDrawer(cached);
    else renderDrawerSkeleton();
    try {
      const full = await fetchCandidate(id);
      if (full) renderDrawer(full);
    } catch (err) {
      console.warn('[candidates] drawer fetch failed', err);
      showToast(err.message || 'Unable to load candidate', 'error');
    }
  }

  function closeDrawer() {
    if (elements.dwProfile?.querySelector('[data-field][data-dirty="true"]') || hasDirtyPaymentFields()) {
      showToast('Unsaved profile or payment changes. Save them before closing.', 'warn', 3600);
      return;
    }
    state.drawerId = null;
    if (elements.drawer) elements.drawer.classList.remove('open');
    document.body.classList.remove('drawer-open');
  }

  function renderDrawerSkeleton() {
    elements.dwName.textContent = 'Loading…';
    elements.dwProfile.innerHTML = '<div class="skeleton-card"></div>';
    if (elements.dwOnboarding) elements.dwOnboarding.innerHTML = '<div class="skeleton-card"></div>';
    elements.dwPayment.innerHTML = '';
    elements.dwAssignments.innerHTML = '';
    elements.dwDocs.innerHTML = '';
    elements.dwNotes.innerHTML = '';
    elements.dwAudit.innerHTML = '';
  }

  function renderDrawer(candidate) {
    if (!candidate) return;
    elements.dwName.textContent = candidate.name || 'Candidate';
    // Update type badge in drawer header
    const dwOnboardingMode = candidateOnboardingMode(candidate);
    if (elements.dwTypeBadge) {
      elements.dwTypeBadge.style.display = '';
      elements.dwTypeBadge.className = `type-badge type-badge--${dwOnboardingMode ? 'starter' : 'seeker'}`;
      elements.dwTypeBadge.textContent = dwOnboardingMode ? 'New Starter' : 'Job Seeker';
      elements.dwTypeBadge.title = dwOnboardingMode
        ? 'This candidate is completing onboarding for a live assignment'
        : 'This candidate registered for recruitment profile / job matching';
    }
    if (elements.dwRef) {
      const ref = candidateReference(candidate);
      elements.dwRef.textContent = ref && ref !== '—' ? `Ref: ${ref}` : '';
    }
    const blocked = isBlocked(candidate);
    const archived = isArchived(candidate);
    elements.dwEmail.disabled = blocked;
    elements.dwCall.disabled = blocked;
    elements.dwArchive.textContent = archived ? 'Restore' : 'Archive';
    elements.dwArchive.classList.toggle('red', !archived);
    elements.dwArchive.classList.toggle('ghost', archived);
    elements.dwBlock.disabled = archived;
    elements.dwBlock.textContent = blocked ? 'Unblock' : 'Block';
    elements.dwEmail.onclick = () => {
      if (candidate.email && !blocked) window.location.href = `mailto:${candidate.email}`;
    };
    elements.dwCall.onclick = () => {
      if (candidate.phone && !blocked) window.location.href = `tel:${candidate.phone.replace(/\s+/g, '')}`;
    };
    elements.dwArchive.onclick = () => toggleArchive(candidate);
    elements.dwBlock.onclick = () => toggleBlock(candidate);
    elements.dwProfile.innerHTML = renderProfile(candidate);
    bindProfileEditors(candidate);
    if (elements.dwOnboarding) {
      elements.dwOnboarding.innerHTML = renderOnboarding(candidate);
      bindOnboardingActions(candidate);
    }
    elements.dwPayment.innerHTML = renderPayment(candidate);
    bindPaymentEditors(candidate);
    elements.dwAssignments.innerHTML = renderAssignments(candidate);
    bindAssignmentActions(candidate);
    elements.dwDocs.innerHTML = renderDocs(candidate);
    bindDocumentActions(candidate);
    elements.dwNotes.innerHTML = renderNotes(candidate);
    bindNoteActions(candidate);
    elements.dwAudit.innerHTML = renderAudit(candidate);
  }

  function renderProfile(candidate) {
    const portalAuth = candidate.portal_auth || { exists: false };
    const onboarding = candidate.onboarding || {};
    const onboardingMode = candidateOnboardingMode(candidate);
    const payment = candidate.payment_summary || {};
    const portalStatus = candidate.has_portal_account
      ? 'Portal linked'
      : candidate.portal_account_state === 'closed'
      ? 'Portal account closed'
      : 'No portal account';
    const confirmationStatus = portalAuth.exists
      ? (portalAuth.email_confirmed_at ? 'Verified' : 'Verification pending')
      : 'Not created';
    const accountEmail = portalAuth.email || candidate.email || '—';
    const canSendReminder = onboardingMode && !onboarding.hasRightToWork && !!candidate.email && !isArchived(candidate);
    const rtwTitle = onboarding.hasRightToWork
      ? 'Verified'
      : onboarding.hasRightToWorkPendingVerification
      ? 'To verify'
      : 'Missing';
    const rtwCopy = !onboardingMode
      ? 'HMJ only requests right-to-work evidence once a live placement is underway.'
      : onboarding.hasRightToWork
      ? 'HMJ has a verified RTW or passport record on file.'
      : onboarding.hasRightToWorkPendingVerification
      ? 'Candidate has uploaded RTW evidence, but HMJ still needs to verify it.'
      : 'Candidate still needs to upload RTW evidence.';
    const isInvitedStarter = onboardingMode && String(candidate.status || '').toLowerCase() === 'invited';
    const isCancelledStarter = onboardingMode && String(candidate.status || '').toLowerCase() === 'cancelled';
    const starterBanner = isInvitedStarter ? `
      <div style="background:#f3f0ff;border:1px solid #c4b5fd;border-radius:14px;padding:14px 16px;margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:13px;color:#5b21b6;margin-bottom:4px">🕐 Provisional new starter — awaiting registration</div>
            <div style="font-size:13px;color:#6d28d9;line-height:1.5">Intro email sent. This starter hasn't completed their HMJ registration yet. Send a reminder or cancel if they're no longer starting.</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn" type="button" data-starter-action="send-reminder" style="background:#7c3aed;color:#fff;font-size:13px;padding:8px 14px"
            data-candidate-id="${candidate.id}"
            data-first-name="${(candidate.first_name || '').replace(/"/g, '&quot;')}"
            data-last-name="${(candidate.last_name || '').replace(/"/g, '&quot;')}"
            data-email="${(candidate.email || '').replace(/"/g, '&quot;')}"
            data-company="${(candidate.client_name || '').replace(/"/g, '&quot;')}"
            data-job-title="${(candidate.job_title || '').replace(/"/g, '&quot;')}">
            ↻ Send reminder email
          </button>
          <button class="btn ghost" type="button" data-starter-action="cancel"
            data-candidate-id="${candidate.id}"
            style="font-size:13px;padding:8px 14px;border-color:#ef4444;color:#ef4444">
            ✕ Cancel — no longer starting
          </button>
        </div>
      </div>` : isCancelledStarter ? `
      <div style="background:#f8f8f8;border:1px solid #d1d5db;border-radius:14px;padding:12px 16px;margin-bottom:16px">
        <div style="font-weight:800;font-size:13px;color:#6b7280">✕ Starter cancelled — no longer starting</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:4px">This provisional profile was cancelled. Archive it or update the status if circumstances change.</div>
      </div>` : '';
    return `${starterBanner}
      <div class="drawer-section">
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">
          <span class="chip ${statusTone(candidate.status)}">${statusLabel(candidate.status)}</span>
          <span class="muted">Updated ${formatDateTime(candidate.updated_at)}</span>
        </div>
        <div class="summary-grid">
          <article class="summary-tile">
            <span>Candidate mode</span>
            <strong>${candidateModeLabel(candidate)}</strong>
            <p>${candidateModeDescription(candidate)}</p>
          </article>
          <article class="summary-tile">
            <span>Right to work</span>
            <strong>${onboardingMode ? rtwTitle : 'Not required yet'}</strong>
            <p>${rtwCopy}</p>
          </article>
          <article class="summary-tile">
            <span>Onboarding</span>
            <strong>${onboardingMode ? (onboarding.onboardingComplete ? 'Ready' : 'Action needed') : 'Recruitment profile'}</strong>
            <p>${onboardingMode
              ? (onboarding.onboardingComplete ? 'Core onboarding items are complete.' : (onboarding.missing || []).join(', ').replace(/_/g, ' '))
              : 'Candidate can register, upload CVs, and apply for jobs without payroll onboarding.'}</p>
          </article>
          <article class="summary-tile">
            <span>Payroll details</span>
            <strong>${payment.completion?.complete ? 'On file' : (onboardingMode ? 'Pending' : 'Not required yet')}</strong>
            <p>${payment.completion?.complete ? `${payment.bankName || 'Bank'} · ${paymentReference(candidate)}` : (onboardingMode ? 'Bank details are still missing.' : 'Bank details are only collected for live assignment onboarding.')}</p>
          </article>
        </div>
        <div class="profile-grid">
          <label class="drawer-field">
            <span>Candidate path</span>
            <select class="drawer-input" data-field="onboarding_mode">
              <option value="false" ${onboardingMode ? '' : 'selected'}>Recruitment profile only</option>
              <option value="true" ${onboardingMode ? 'selected' : ''}>Live assignment onboarding</option>
            </select>
          </label>
          ${onboardingMode ? `
            <label class="drawer-field">
              <span>Onboarding status</span>
              <select class="drawer-input" data-field="onboarding_status">
                ${Object.keys(ONBOARDING_STATUS_META).map((key) => `<option value="${key}" ${onboardingStatusKey(onboarding.status || candidate.onboarding_status) === key ? 'selected' : ''}>${escapeHtml(ONBOARDING_STATUS_META[key].label)}</option>`).join('')}
              </select>
            </label>
          ` : ''}
          ${editableField('First name', 'first_name', candidate.first_name)}
          ${editableField('Last name', 'last_name', candidate.last_name)}
          ${editableField('Email', 'email', candidate.email)}
          ${editableField('Phone', 'phone', candidate.phone)}
          ${editableField('Role', 'role', candidate.role)}
          ${editableField('Region', 'region', candidate.region)}
          ${editableField('Availability', 'availability_on', candidate.availability_on, 'date')}
          ${editableSelect('Status', 'status', candidate.status, Object.keys(STATUS_META))}
          ${editableField('Reference', 'ref', candidateReference(candidate))}
        </div>
        <div class="profile-grid" style="margin-top:12px">
          ${editableField('Address line 1', 'address1', candidate.address1)}
          ${editableField('Address line 2', 'address2', candidate.address2)}
          ${editableField('Town / city', 'town', candidate.town)}
          ${editableField('County / region', 'county', candidate.county)}
          ${editableField('Postcode', 'postcode', candidate.postcode)}
          ${editableField('Country', 'country', candidate.country)}
          ${editableField('Current location', 'location', candidate.location)}
          ${editableField('Nationality', 'nationality', candidate.nationality)}
        </div>
        <div class="profile-grid" style="margin-top:12px">
          ${editableField('Primary specialism', 'primary_specialism', candidate.primary_specialism)}
          ${editableField('Secondary specialism', 'secondary_specialism', candidate.secondary_specialism)}
          ${editableField('Current job title', 'current_job_title', candidate.current_job_title)}
          ${editableField('Roles looking for / placed into', 'desired_roles', candidate.desired_roles || candidate.role)}
          ${editableField('Years of experience', 'experience_years', candidate.experience_years, 'number')}
          ${editableField('Sector experience', 'sector_experience', candidate.sector_experience)}
          ${editableField('Availability / start date', 'availability', candidate.availability || candidate.availability_on)}
          ${editableField('Relocation preference', 'relocation_preference', candidate.relocation_preference)}
          ${editableField('Pay expectation', 'salary_expectation', candidate.salary_expectation)}
          ${editableField('LinkedIn', 'linkedin_url', candidate.linkedin_url)}
          ${onboardingMode ? `
            <label class="drawer-field">
              <span>Right-to-work evidence type</span>
              <select class="drawer-input" data-field="right_to_work_evidence_type">
                ${['passport', 'id_card', 'visa', 'brp', 'share_code', 'settlement', 'other'].map((key) => `<option value="${key}" ${String(candidate.right_to_work_evidence_type || '').toLowerCase() === key ? 'selected' : ''}>${escapeHtml(evidenceTypeLabel(key))}</option>`).join('')}
              </select>
            </label>
          ` : ''}
          ${onboardingMode ? `
            <label class="drawer-field">
              <span>Consent captured</span>
              <select class="drawer-input" data-field="consent_captured">
                <option value="false" ${candidate.consent_captured ? '' : 'selected'}>No</option>
                <option value="true" ${candidate.consent_captured ? 'selected' : ''}>Yes</option>
              </select>
            </label>
          ` : ''}
        </div>
        <div class="profile-grid" style="margin-top:12px">
          <div class="drawer-field"><span>Portal account</span><strong>${portalStatus}</strong></div>
          <div class="drawer-field"><span>Portal email</span><strong>${accountEmail}</strong></div>
          <div class="drawer-field"><span>Verification</span><strong>${confirmationStatus}</strong></div>
          <div class="drawer-field"><span>Portal last seen</span><strong>${formatDateTime(candidate.last_portal_login_at || portalAuth.last_sign_in_at)}</strong></div>
          <div class="drawer-field"><span>Portal created</span><strong>${formatDateTime(portalAuth.created_at)}</strong></div>
          <div class="drawer-field"><span>Sector focus</span><strong>${candidate.sector_focus || candidate.primary_specialism || '—'}</strong></div>
          <div class="drawer-field"><span>Consent captured</span><strong>${candidate.consent_captured ? `Yes${candidate.consent_captured_at ? ` · ${formatDateTime(candidate.consent_captured_at)}` : ''}` : 'No'}</strong></div>
        </div>
        ${(onboardingMode || candidate.emergency_name || candidate.emergency_phone) ? `
          <div class="profile-grid" style="margin-top:12px">
            ${editableField('Next of kin full name', 'emergency_name', candidate.emergency_name)}
            ${editableField('Next of kin telephone number', 'emergency_phone', candidate.emergency_phone)}
          </div>
          <div class="muted" style="margin-top:6px;font-size:12px">Emergency contact details are only required for live assignment onboarding.</div>
        ` : ''}
        <div style="margin-top:12px">
          <label class="muted" style="display:block;margin-bottom:4px">Skills / tags</label>
          <textarea data-field="skills" rows="2" class="drawer-input">${candidate.skills.join(', ')}</textarea>
        </div>
        ${onboardingMode ? `
          <div style="margin-top:12px">
            <label class="muted" style="display:block;margin-bottom:4px">Authorised work regions</label>
            <textarea data-field="right_to_work_regions" rows="2" class="drawer-input">${(candidate.right_to_work_regions || []).join(', ')}</textarea>
          </div>
        ` : ''}
        <div style="margin-top:12px">
          <label class="muted" style="display:block;margin-bottom:4px">Qualifications / certifications</label>
          <textarea data-field="qualifications" rows="3" class="drawer-input">${escapeHtml(candidate.qualifications || '')}</textarea>
        </div>
        <div style="margin-top:12px">
          <label class="muted" style="display:block;margin-bottom:4px">Summary / notes</label>
          <textarea data-field="summary" rows="4" class="drawer-input">${escapeHtml(candidate.summary || '')}</textarea>
        </div>
        <div class="drawer-savebar" style="margin-top:12px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div class="muted" data-save-status>Edit a field, then use Save changes to confirm the update.</div>
          <button class="btn" type="button" data-action="save-profile" disabled>Save changes</button>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn ghost" target="_blank" rel="noopener" href="/admin/timesheets.html?candidate=${candidate.id}">Timesheet history</a>
          <button class="btn" type="button" data-action="download-pdf">Download summary PDF</button>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost" type="button" data-account-action="inspect">Refresh portal status</button>
          <button class="btn ghost" type="button" data-onboarding-action="send-doc-request" ${!candidate.email || isArchived(candidate) ? 'disabled' : ''}>Request documents</button>
          <button class="btn ghost" type="button" data-onboarding-action="send-rtw-reminder" ${canSendReminder ? '' : 'disabled'}>Send RTW reminder</button>
          <button class="btn ghost" type="button" data-onboarding-action="copy-upload-link">Copy upload link</button>
          <button class="btn ghost" type="button" data-tsp-action="sync-candidate" ${(!candidate.email && !String(candidate?.ref || candidate?.payroll_ref || '').trim()) || isArchived(candidate) ? 'disabled' : ''}>Sync from TSP</button>
          ${candidateOnboardingMode(candidate) ? `<button class="btn" type="button" data-tsp-action="push-to-tsp" ${isArchived(candidate) ? 'disabled' : ''} style="background:var(--blue);color:#fff">Push to TSP →</button>` : ''}
          <button class="btn ghost" type="button" data-account-action="repair_profile">Repair portal profile</button>
          <button class="btn ghost" type="button" data-account-action="copy_access_link" ${!accountEmail || portalStatus === 'Portal account closed' ? 'disabled' : ''}>Copy secure access link</button>
          <button class="btn ghost" type="button" data-account-action="set_temporary_password" ${!accountEmail || portalStatus === 'Portal account closed' ? 'disabled' : ''}>Set temporary password</button>
          <button class="btn ghost" type="button" data-account-action="send_password_reset" ${!accountEmail || portalStatus === 'Portal account closed' ? 'disabled' : ''}>Email reset link</button>
          <button class="btn ghost" type="button" data-account-action="copy_password_reset_link" ${!accountEmail || portalStatus === 'Portal account closed' ? 'disabled' : ''}>Copy secure reset link</button>
          <button class="btn ghost" type="button" data-account-action="resend_verification" ${!accountEmail || portalAuth.email_confirmed_at ? 'disabled' : ''}>Resend verification</button>
        </div>
        <div class="tag-row">${(candidate.tags || []).map((tag) => `<span class="chip blue">${tag.name}</span>`).join(' ')}</div>
      </div>`;
  }

  function renderOnboarding(candidate) {
    if (!candidateOnboardingMode(candidate)) {
      return `
        <div class="drawer-section">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <h3 style="margin:0 0 4px">Onboarding</h3>
              <div class="muted" style="font-size:13px">This section becomes active only when HMJ is onboarding the candidate for a live assignment.</div>
            </div>
            <span class="chip gray">Recruitment profile</span>
          </div>
        </div>`;
    }
    const onboarding = candidate.onboarding || {};
    const rightToWork = onboarding.rightToWork || {};
    const emailHistory = onboarding.emailHistory || {};
    const missingCore = Array.isArray(onboarding.missingCore) ? onboarding.missingCore : [];
    const missingRecommended = Array.isArray(onboarding.missingRecommended) ? onboarding.missingRecommended : [];
    const recentEmailMarkup = Array.isArray(emailHistory.recent) && emailHistory.recent.length
      ? emailHistory.recent.slice(0, 6).map((entry) => `
          <div class="audit-row">
            <strong>${formatDateTime(entry.created_at)}</strong>
            <span>${escapeHtml(entry.description || entry.activity_type || 'Onboarding email sent')}</span>
          </div>
        `).join('')
      : '<div class="muted">No onboarding email activity logged yet.</div>';
    return `
      <div class="drawer-section">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 4px">Onboarding</h3>
            <div class="muted" style="font-size:13px">Operational view for starter onboarding, payroll readiness, document verification, and reminder outreach.</div>
          </div>
          <div class="tag-row">
            <span class="chip ${onboardingStatusTone(onboarding.status)}">${escapeHtml(onboarding.statusLabel || onboardingStatusLabel(onboarding.status))}</span>
            ${onboarding.pendingVerificationCount ? `<span class="chip orange">${onboarding.pendingVerificationCount} to verify</span>` : ''}
            ${onboarding.duplicate?.duplicateEmailCount ? `<span class="chip red">${onboarding.duplicate.duplicateEmailCount} duplicate email${onboarding.duplicate.duplicateEmailCount === 1 ? '' : 's'}</span>` : ''}
          </div>
        </div>
        <div class="summary-grid">
          <article class="summary-tile">
            <span>Right-to-work document</span>
            <strong>${escapeHtml(rightToWork.documentStatus === 'approved' ? 'Approved' : rightToWork.documentStatus === 'rejected' ? 'Rejected' : rightToWork.hasUpload ? 'Present' : 'Missing')}</strong>
            <p>${escapeHtml(`${rightToWork.evidenceTypeLabel || evidenceTypeLabel(candidate.right_to_work_evidence_type)}${rightToWork.verifiedBy ? ` · ${rightToWork.verifiedBy}` : ''}`)}</p>
          </article>
          <article class="summary-tile">
            <span>Payroll</span>
            <strong>${candidate.payment_summary?.completion?.complete ? 'Ready' : 'Pending'}</strong>
            <p>${candidate.payment_summary?.bankName ? `${escapeHtml(candidate.payment_summary.bankName)} · ${escapeHtml(paymentReference(candidate))}` : 'Bank details still missing.'}</p>
          </article>
          <article class="summary-tile">
            <span>Missing core items</span>
            <strong>${missingCore.length}</strong>
            <p>${missingCore.length ? escapeHtml(missingCore.map((item) => humanizeMissingField(item)).join(', ')) : 'No core onboarding blockers.'}</p>
          </article>
          <article class="summary-tile">
            <span>Last onboarding email</span>
            <strong>${lastEmailSentAt(emailHistory, 'onboardingConfirmationSentAt', 'onboardingReminderSentAt', 'documentRequestSentAt', 'rtwReminderSentAt', 'introReminderSentAt', 'introSentAt', 'verificationCompleteSentAt') ? formatDateTime(lastEmailSentAt(emailHistory, 'onboardingConfirmationSentAt', 'onboardingReminderSentAt', 'documentRequestSentAt', 'rtwReminderSentAt', 'introReminderSentAt', 'introSentAt', 'verificationCompleteSentAt')) : 'Not sent yet'}</strong>
            <p>${emailHistory.onboardingConfirmationSentAt ? 'Onboarding confirmation email logged.' : emailHistory.verificationCompleteSentAt ? 'Verification complete email logged.' : 'Use the actions below to chase missing detail quickly.'}</p>
          </article>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn" type="button" data-onboarding-action="send-reminder-general" ${!candidate.email || isArchived(candidate) ? 'disabled' : ''}>Send reminder</button>
          <button class="btn ghost" type="button" data-onboarding-action="send-doc-request" ${!candidate.email || isArchived(candidate) ? 'disabled' : ''}>Re-request documents</button>
          <button class="btn ghost" type="button" data-onboarding-action="send-verification-complete" ${!candidate.email || isArchived(candidate) ? 'disabled' : ''}>Send verification complete</button>
          <button class="btn ghost" type="button" data-onboarding-action="mark-verified" ${!rightToWork.documentId || rightToWork.documentStatus !== 'present' ? 'disabled' : ''}>Mark verified</button>
          <button class="btn ghost" type="button" data-onboarding-action="copy-upload-link">Copy upload link</button>
        </div>
        <div class="profile-grid" style="margin-top:12px">
          <div class="drawer-field"><span>Evidence type</span><strong>${escapeHtml(rightToWork.evidenceTypeLabel || evidenceTypeLabel(candidate.right_to_work_evidence_type))}</strong></div>
          <div class="drawer-field"><span>Verified by</span><strong>${escapeHtml(rightToWork.verifiedBy || '—')}</strong></div>
          <div class="drawer-field"><span>Verified when</span><strong>${escapeHtml(formatDateTime(rightToWork.verifiedAt))}</strong></div>
          <div class="drawer-field"><span>Consent</span><strong>${candidate.consent_captured ? `Captured${candidate.consent_captured_at ? ` · ${formatDateTime(candidate.consent_captured_at)}` : ''}` : 'Missing'}</strong></div>
          <div class="drawer-field"><span>Status updated</span><strong>${escapeHtml(formatDateTime(onboarding.statusUpdatedAt))}</strong></div>
          <div class="drawer-field"><span>Status owner</span><strong>${escapeHtml(onboarding.statusUpdatedBy || '—')}</strong></div>
          <div class="drawer-field"><span>Work regions</span><strong>${escapeHtml((onboarding.rightToWorkRegions || candidate.right_to_work_regions || []).join(', ') || '—')}</strong></div>
          <div class="drawer-field"><span>CV</span><strong>${onboarding.cvPresent ? 'Uploaded' : 'Missing'}</strong></div>
        </div>
        ${rightToWork.documentLabel ? `<div class="muted" style="margin-top:8px;font-size:13px">Latest document: ${escapeHtml(rightToWork.documentLabel)}</div>` : ''}
        ${rightToWork.verificationNotes ? `<div class="muted" style="margin-top:8px;font-size:13px">Verification note: ${escapeHtml(rightToWork.verificationNotes)}</div>` : ''}
        ${missingCore.length ? `<div class="tag-row" style="margin-top:12px">${missingCore.map((item) => `<span class="chip orange">${escapeHtml(humanizeMissingField(item))}</span>`).join(' ')}</div>` : ''}
        ${missingRecommended.length ? `<div class="tag-row" style="margin-top:8px">${missingRecommended.map((item) => `<span class="chip gray">${escapeHtml(humanizeMissingField(item))}</span>`).join(' ')}</div>` : ''}
        <div style="margin-top:16px">
          <h4 style="margin:0 0 10px">Recent onboarding emails</h4>
          <div class="audit-list">${recentEmailMarkup}</div>
        </div>
      </div>`;
  }

  function renderPayment(candidate) {
    if (!candidateOnboardingMode(candidate)) {
      return `
        <div class="drawer-section">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <h3 style="margin:0 0 4px">Payroll details</h3>
              <div class="muted" style="font-size:13px">This section is only used when a candidate is completing live assignment onboarding.</div>
            </div>
            <span class="chip gray">Not required yet</span>
          </div>
          <div class="muted" style="margin-top:12px">
            Recruitment-profile candidates can still register, upload CVs, and apply for jobs without payroll data. Switch the candidate path to live assignment onboarding when HMJ needs bank details for mobilisation.
          </div>
        </div>`;
    }
    const payment = ensurePaymentDraft(candidate);
    const isIban = payment.paymentMethod === 'iban_swift';
    const helperMessage = payment.loadedSensitive
      ? 'Secure values are loaded for this admin session. Save changes to update the stored payment record.'
      : payment.completion?.complete
      ? 'Sensitive values stay masked by default. Load secure values if you need to inspect or edit the existing account identifiers.'
      : 'No payment record is saved yet. Enter the required details and save them securely.';
    const identifierHint = payment.loadedSensitive
      ? 'Leave a value in place to keep it, or replace it and save.'
      : 'Leave sensitive fields blank to keep the stored masked values unchanged.';
    return `
      <div class="drawer-section">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 4px">Payroll details</h3>
            <div class="muted" style="font-size:13px">${helperMessage}</div>
          </div>
          <div class="tag-row">
            <span class="chip ${payment.completion?.complete ? 'green' : 'orange'}">${payment.completion?.complete ? 'On file' : 'Pending'}</span>
            ${payment.legacyFallback ? '<span class="chip gray">Legacy fallback</span>' : ''}
          </div>
        </div>
        <div class="payment-summary">
          <div class="summary-tile">
            <span>Account format</span>
            <strong>${paymentMethodLabel(payment.paymentMethod)}</strong>
            <p>${escapeHtml(payment.accountCurrency || 'GBP')} · ${payment.bankName ? escapeHtml(payment.bankName) : 'Bank pending'}</p>
          </div>
          <div class="summary-tile">
            <span>Stored reference</span>
            <strong>${escapeHtml(payment.lastFour ? `••••${payment.lastFour}` : 'Pending')}</strong>
            <p>${escapeHtml(payment.masked.accountNumber || payment.masked.iban || payment.masked.sortCode || 'No sensitive identifiers saved yet.')}</p>
          </div>
        </div>
        <div class="profile-grid">
          <label class="drawer-field">
            <span>Account currency</span>
            <select class="drawer-input" data-payment-field="accountCurrency">
              ${['GBP', 'EUR', 'USD', 'AED', 'SAR', 'OTHER'].map((code) => `<option value="${code}" ${code === payment.accountCurrency ? 'selected' : ''}>${code}</option>`).join('')}
            </select>
          </label>
          <label class="drawer-field">
            <span>Payment method</span>
            <select class="drawer-input" data-payment-field="paymentMethod">
              <option value="gbp_local" ${payment.paymentMethod === 'gbp_local' ? 'selected' : ''}>Sort code / account number</option>
              <option value="iban_swift" ${payment.paymentMethod === 'iban_swift' ? 'selected' : ''}>IBAN / SWIFT</option>
            </select>
          </label>
          <label class="drawer-field">
            <span>Account holder name</span>
            <input class="drawer-input" data-payment-field="accountHolderName" value="${escapeHtml(payment.accountHolderName || '')}" />
          </label>
          <label class="drawer-field">
            <span>Bank name</span>
            <input class="drawer-input" data-payment-field="bankName" value="${escapeHtml(payment.bankName || '')}" />
          </label>
          <label class="drawer-field">
            <span>Bank location / country</span>
            <input class="drawer-input" data-payment-field="bankLocationOrCountry" value="${escapeHtml(payment.bankLocationOrCountry || '')}" />
          </label>
          <label class="drawer-field">
            <span>Account type</span>
            <input class="drawer-input" data-payment-field="accountType" value="${escapeHtml(payment.accountType || '')}" placeholder="Optional" />
          </label>
        </div>
        <div class="payment-sensitive-grid">
          <div class="payment-sensitive-fields" data-payment-method-panel="gbp_local" ${isIban ? 'hidden' : ''}>
            <label class="drawer-field">
              <span>Sort code</span>
              <input class="drawer-input" data-payment-field="sortCode" value="${escapeHtml(payment.values.sortCode || '')}" placeholder="${escapeHtml(payment.masked.sortCode || '00-00-00')}" />
            </label>
            <label class="drawer-field">
              <span>Account number</span>
              <input class="drawer-input" data-payment-field="accountNumber" value="${escapeHtml(payment.values.accountNumber || '')}" placeholder="${escapeHtml(payment.masked.accountNumber || '12345678')}" />
            </label>
          </div>
          <div class="payment-sensitive-fields" data-payment-method-panel="iban_swift" ${isIban ? '' : 'hidden'}>
            <label class="drawer-field">
              <span>IBAN</span>
              <input class="drawer-input" data-payment-field="iban" value="${escapeHtml(payment.values.iban || '')}" placeholder="${escapeHtml(payment.masked.iban || 'GB00BANK00000000000000')}" />
            </label>
            <label class="drawer-field">
              <span>SWIFT / BIC</span>
              <input class="drawer-input" data-payment-field="swiftBic" value="${escapeHtml(payment.values.swiftBic || '')}" placeholder="${escapeHtml(payment.masked.swiftBic || 'BANKGB22')}" />
            </label>
          </div>
        </div>
        <div class="muted" style="font-size:12px">${identifierHint}</div>
        <div class="drawer-savebar" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div class="muted" data-payment-save-status>${payment.verifiedAt ? `Verified ${formatDateTime(payment.verifiedAt)}` : 'Payment details are stored separately from the main candidate profile.'}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${payment.completion?.complete && !payment.loadedSensitive ? '<button class="btn ghost" type="button" data-action="load-payment-details">Load secure values</button>' : ''}
            <button class="btn" type="button" data-action="save-payment-details" disabled>Save payment details</button>
          </div>
        </div>
      </div>`;
  }

  function editableField(label, field, value, type = 'text') {
    const val = value ? (type === 'date' ? value.slice(0, 10) : value) : '';
    return `
      <label class="drawer-field">
        <span>${label}</span>
        <input class="drawer-input" data-field="${field}" type="${type}" value="${val || ''}" />
      </label>`;
  }

  function editableSelect(label, field, value, options) {
    const opts = options
      .map((opt) => {
        const val = String(opt).toLowerCase();
        return `<option value="${val}" ${val === value ? 'selected' : ''}>${statusLabel(val)}</option>`;
      })
      .join('');
    return `
      <label class="drawer-field">
        <span>${label}</span>
        <select class="drawer-input" data-field="${field}">${opts}</select>
      </label>`;
  }

  function renderDocs(candidate) {
    const docs = Array.isArray(candidate.docs) ? candidate.docs : [];
    const groups = groupDocuments(docs);
    const rows = groups.map((group) => {
      const itemsMarkup = group.items.length
        ? group.items.map((doc) => {
            const href = doc.url || doc.access_url || '';
            const label = doc.label || doc.kind || doc.original_filename || doc.filename || doc.name || documentTypeLabel(doc.document_type);
            const uploaded = formatDateTime(doc.uploaded_at || doc.created_at);
            const typeLabel = documentTypeLabel(doc.document_type || doc.kind);
            const verification = documentVerificationMeta(doc);
            const action = href
              ? `<a href="${href}" target="_blank" rel="noopener">Open</a>`
              : '<span class="muted">Unavailable</span>';
            const canDelete = !!(doc.id && (doc.storage_path || doc.storage_key || doc.candidate_id || doc.meta));
            const remove = canDelete
              ? `<button class="btn ghost small" type="button" data-doc-delete="${doc.id}">Delete</button>`
              : '';
            const verifyControls = doc.verification_required
              ? `
                <span class="chip ${verification.tone}">${verification.label}</span>
                ${doc.verification_status !== 'verified' ? `<button class="btn ghost small" type="button" data-doc-verify="${doc.id}">Verify</button>` : ''}
                ${doc.verification_status !== 'rejected' ? `<button class="btn ghost small" type="button" data-doc-reject="${doc.id}">Reject</button>` : ''}
                ${doc.verification_status === 'rejected' ? `<button class="btn ghost small" type="button" data-doc-reset="${doc.id}">Reset</button>` : ''}
              `
              : '';
            return `<div class="doc-row">
              <div style="min-width:0">
                <div style="font-weight:700;word-break:break-word">${escapeHtml(label)}</div>
                <div class="muted" style="font-size:12px">${escapeHtml(typeLabel)}${uploaded ? ` · ${escapeHtml(uploaded)}` : ''}${doc.verified_at ? ` · Verified ${escapeHtml(formatDateTime(doc.verified_at))}` : ''}</div>
                ${doc.verification_notes ? `<div class="muted" style="font-size:12px;margin-top:4px">Review note: ${escapeHtml(doc.verification_notes)}</div>` : ''}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${verifyControls}${action}${remove}</div>
            </div>`;
          }).join('')
        : '<div class="muted">Nothing uploaded in this section yet.</div>';
      return `
        <section class="doc-group">
          <div class="doc-group-head">
            <div>
              <h4>${escapeHtml(group.title)}</h4>
              <p>${escapeHtml(group.description)}</p>
            </div>
            ${group.items.length ? `<span class="chip blue">${group.items.length}</span>` : ''}
          </div>
          <div class="doc-list">${itemsMarkup}</div>
        </section>`;
    }).join('');

    const optionMarkup = DOCUMENT_TYPE_OPTIONS
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join('');

    return `
      <div class="drawer-section">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 4px">Documents</h3>
            <div class="muted" style="font-size:13px">Upload CVs, passports, right-to-work files, qualifications, references, and other supporting documents.</div>
          </div>
          <div class="doc-upload-controls">
            <select class="drawer-input" data-doc-type>${optionMarkup}</select>
            <input class="drawer-input" data-doc-label placeholder="Label e.g. Passport photo page" />
            <button class="btn" type="button" data-doc-upload>Upload document</button>
            <input type="file" data-doc-input hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" />
          </div>
        </div>
        <div class="muted" style="font-size:12px">Choose a document type before uploading so right-to-work and certificate items stay grouped correctly in the onboarding record.</div>
        <div class="doc-groups">${rows}</div>
      </div>`;
  }

  function renderAssignments(candidate) {
    const linked = Array.isArray(candidate.assignments) ? candidate.assignments : [];
    const options = Array.isArray(candidate.assignment_options) ? candidate.assignment_options : [];
    const linkingAvailable = candidate.assignment_linking_available !== false;
    const optionMarkup = options
      .filter((assignment) => String(assignment.candidate_id || '') !== String(candidate.id))
      .map((assignment) => {
        const bits = [
          assignment.as_ref || `AS-${assignment.id}`,
          assignment.job_title || 'Assignment',
          assignment.client_name || null,
          statusLabel(assignment.status),
        ].filter(Boolean);
        return `<option value="${assignment.id}">${escapeHtml(bits.join(' • '))}</option>`;
      }).join('');

    const linkedMarkup = linked.length
      ? linked.map((assignment) => `
          <div class="doc-row">
            <div style="min-width:0">
              <div style="font-weight:700;word-break:break-word">${escapeHtml(assignment.job_title || assignment.as_ref || `Assignment #${assignment.id}`)}</div>
              <div class="muted" style="font-size:12px;line-height:1.45">
                ${escapeHtml([
                  assignment.as_ref || null,
                  assignment.client_name || null,
                  assignment.client_site || null,
                  assignment.start_date ? `${formatDate(assignment.start_date)}${assignment.end_date ? ` – ${formatDate(assignment.end_date)}` : ''}` : null,
                  formatAssignmentPay(assignment),
                ].filter(Boolean).join(' • '))}
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <a class="btn ghost small" href="/admin/assignments.html?q=${encodeURIComponent(assignment.as_ref || assignment.job_title || assignment.client_name || assignment.id)}" target="_blank" rel="noopener">Open</a>
              ${linkingAvailable ? `<button class="btn ghost small" type="button" data-assignment-unlink="${assignment.id}">Unlink</button>` : ''}
            </div>
          </div>
        `).join('')
      : '<div class="muted">No linked assignments yet.</div>';

    return `
      <div class="drawer-section">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 4px">Assignments</h3>
            <div class="muted" style="font-size:13px">Pair this candidate to live or active assignments without leaving the candidate workspace.</div>
          </div>
          ${linkingAvailable ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:min(360px,100%)">
              <select class="drawer-input" data-assignment-select>
                <option value="">Select assignment…</option>
                ${optionMarkup}
              </select>
              <button class="btn" type="button" data-assignment-link ${optionMarkup ? '' : 'disabled'}>Link assignment</button>
            </div>
          ` : `
            <div class="muted" style="font-size:13px;max-width:320px">Assignment pairing will appear here after the latest Supabase assignments reconciliation is applied.</div>
          `}
        </div>
        <div class="doc-list">${linkedMarkup}</div>
      </div>`;
  }

  async function refreshCandidateAssignments(candidate) {
    const refreshed = await fetchCandidate(candidate.id);
    if (!refreshed) return;
    Object.assign(candidate, refreshed);
    if (state.drawerId && String(state.drawerId) === String(candidate.id)) {
      renderDrawer(candidate);
    }
  }

  async function updateCandidateAssignment(candidate, assignmentId, action) {
    const response = await state.helpers.api('admin-candidate-assignment-link', 'POST', {
      action,
      candidateId: candidate.id,
      assignmentId,
    });
    await refreshCandidateAssignments(candidate);
    showToast(
      response?.message || (action === 'unlink' ? 'Assignment unlinked.' : 'Assignment linked.'),
      'info',
      2800,
    );
  }

  function bindAssignmentActions(candidate) {
    const host = elements.dwAssignments;
    if (!host) return;
    const select = qs('[data-assignment-select]', host);
    const linkButton = qs('[data-assignment-link]', host);
    if (linkButton && select) {
      linkButton.addEventListener('click', async () => {
        const assignmentId = String(select.value || '').trim();
        if (!assignmentId) {
          showToast('Select an assignment first.', 'warn', 2800);
          return;
        }
        linkButton.disabled = true;
        try {
          await updateCandidateAssignment(candidate, assignmentId, 'link');
        } catch (err) {
          console.error('[candidates] assignment link failed', err);
          showToast(err.message || 'Could not link the assignment.', 'error', 4200);
        } finally {
          linkButton.disabled = false;
        }
      });
    }
    host.querySelectorAll('[data-assignment-unlink]').forEach((button) => {
      button.addEventListener('click', async () => {
        const assignmentId = button.dataset.assignmentUnlink;
        if (!assignmentId) return;
        button.disabled = true;
        try {
          await updateCandidateAssignment(candidate, assignmentId, 'unlink');
        } catch (err) {
          console.error('[candidates] assignment unlink failed', err);
          showToast(err.message || 'Could not unlink the assignment.', 'error', 4200);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function readFileAsBase64(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',').pop() : result;
        resolve(base64 || '');
      };
      reader.onerror = () => reject(reader.error || new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function refreshCandidateDocuments(candidate) {
    const response = await state.helpers.api('admin-candidate-docs-list', 'POST', { candidateId: candidate.id });
    candidate.docs = Array.isArray(response?.documents) ? response.documents : [];
    candidate.onboarding = normaliseOnboarding(candidate, candidate.docs, candidate.payment_summary);
    const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
    if (index >= 0) state.raw[index] = { ...candidate };
    applyFilters();
    elements.dwDocs.innerHTML = renderDocs(candidate);
    bindDocumentActions(candidate);
    refreshDrawerProfile(candidate, { preserveDirty: true });
    refreshDrawerOnboarding(candidate);
    await refreshVerificationQueue({ silent: true });
  }

  async function uploadCandidateDocument(candidate, file, label, documentType) {
    if (!candidate?.id || !file) return;
    const base64 = await readFileAsBase64(file);
    const response = await state.helpers.api('admin-candidate-doc-upload', 'POST', {
      candidateId: candidate.id,
      name: file.name,
      contentType: file.type || 'application/octet-stream',
      data: base64,
      label: label || file.name,
      documentType: documentType || 'other',
    });
    if (response?.document) {
      candidate.docs = [response.document].concat(Array.isArray(candidate.docs) ? candidate.docs : []);
      candidate.onboarding = normaliseOnboarding(candidate, candidate.docs, candidate.payment_summary);
      const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
      if (index >= 0) state.raw[index] = { ...candidate };
      applyFilters();
      elements.dwDocs.innerHTML = renderDocs(candidate);
      bindDocumentActions(candidate);
      refreshDrawerProfile(candidate, { preserveDirty: true });
      refreshDrawerOnboarding(candidate);
      await refreshVerificationQueue({ silent: true });
    } else {
      await refreshCandidateDocuments(candidate);
    }
  }

  async function deleteCandidateDocument(candidate, documentId) {
    if (!documentId) return;
    await state.helpers.api('admin-candidate-doc-delete', 'POST', { id: documentId });
    candidate.docs = (candidate.docs || []).filter((doc) => String(doc.id) !== String(documentId));
    candidate.onboarding = normaliseOnboarding(candidate, candidate.docs, candidate.payment_summary);
    const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
    if (index >= 0) state.raw[index] = { ...candidate };
    applyFilters();
    elements.dwDocs.innerHTML = renderDocs(candidate);
    bindDocumentActions(candidate);
    refreshDrawerProfile(candidate, { preserveDirty: true });
    refreshDrawerOnboarding(candidate);
    await refreshVerificationQueue({ silent: true });
  }

  async function reviewCandidateDocument(candidate, documentId, action, notes = '') {
    if (!documentId) return;
    const response = await state.helpers.api('admin-candidate-doc-verify', 'POST', {
      id: documentId,
      action,
      notes,
    });
    const document = response?.document || null;
    if (document) {
      candidate.docs = (candidate.docs || []).map((entry) => (
        String(entry.id) === String(documentId) ? { ...entry, ...document } : entry
      ));
    } else {
      await refreshCandidateDocuments(candidate);
    }
    candidate.onboarding = normaliseOnboarding(candidate, candidate.docs, candidate.payment_summary);
    const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
    if (index >= 0) state.raw[index] = { ...candidate };
    applyFilters();
    elements.dwDocs.innerHTML = renderDocs(candidate);
    bindDocumentActions(candidate);
    refreshDrawerProfile(candidate, { preserveDirty: true });
    refreshDrawerOnboarding(candidate);
    await refreshVerificationQueue({ silent: true });
    showToast(response?.message || 'Document review updated.', 'info', 2600);
  }

  function bindDocumentActions(candidate) {
    const host = elements.dwDocs;
    if (!host) return;
    const uploadBtn = qs('[data-doc-upload]', host);
    const fileInput = qs('[data-doc-input]', host);
    const typeInput = qs('[data-doc-type]', host);
    const labelInput = qs('[data-doc-label]', host);
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const [file] = Array.from(fileInput.files || []);
        if (!file) return;
        const selectedType = String(typeInput?.value || 'other').trim().toLowerCase() || 'other';
        const defaultLabel = file.name.replace(/\.[^.]+$/, '') || documentTypeLabel(selectedType);
        const label = String(labelInput?.value || '').trim() || defaultLabel;
        uploadBtn.disabled = true;
        try {
          await uploadCandidateDocument(candidate, file, label, selectedType);
          showToast(`Uploaded ${file.name}`, 'info', 2400);
        } catch (err) {
          console.error('[candidates] document upload failed', err);
          showToast(err.message || 'Document upload failed', 'error', 4200);
        } finally {
          uploadBtn.disabled = false;
          fileInput.value = '';
          if (labelInput) labelInput.value = '';
        }
      });
    }
    host.querySelectorAll('[data-doc-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const documentId = button.dataset.docDelete;
        if (!documentId) return;
        if (!window.confirm('Delete this document?')) return;
        button.disabled = true;
        try {
          await deleteCandidateDocument(candidate, documentId);
          showToast('Document deleted', 'info', 2200);
        } catch (err) {
          console.error('[candidates] document delete failed', err);
          showToast(err.message || 'Document delete failed', 'error', 4200);
          button.disabled = false;
        }
      });
    });
    host.querySelectorAll('[data-doc-verify],[data-doc-reject],[data-doc-reset]').forEach((button) => {
      button.addEventListener('click', async () => {
        const documentId = button.dataset.docVerify || button.dataset.docReject || button.dataset.docReset;
        if (!documentId) return;
        const action = button.dataset.docVerify
          ? 'verify'
          : button.dataset.docReject
          ? 'reject'
          : 'reset';
        const notes = action === 'reject'
          ? window.prompt('Add a short note for the candidate or HMJ review team (optional).', '') || ''
          : '';
        button.disabled = true;
        try {
          await reviewCandidateDocument(candidate, documentId, action, notes);
        } catch (err) {
          console.error('[candidates] document review failed', err);
          showToast(err.message || 'Document review failed.', 'error', 4200);
          button.disabled = false;
        }
      });
    });
  }

  function refreshDrawerProfile(candidate, { preserveDirty = false } = {}) {
    if (!candidate || !state.drawerId || String(state.drawerId) !== String(candidate.id)) return;
    if (preserveDirty && elements.dwProfile?.querySelector('[data-field][data-dirty="true"]')) return;
    elements.dwProfile.innerHTML = renderProfile(candidate);
    bindProfileEditors(candidate);
  }

  function refreshDrawerOnboarding(candidate) {
    if (!candidate || !state.drawerId || String(state.drawerId) !== String(candidate.id) || !elements.dwOnboarding) return;
    elements.dwOnboarding.innerHTML = renderOnboarding(candidate);
    bindOnboardingActions(candidate);
  }

  function refreshDrawerPayment(candidate) {
    if (!candidate || !state.drawerId || String(state.drawerId) !== String(candidate.id)) return;
    elements.dwPayment.innerHTML = renderPayment(candidate);
    bindPaymentEditors(candidate);
  }

  function readPaymentDraft(candidate, host = elements.dwPayment) {
    const draft = ensurePaymentDraft(candidate);
    const next = {
      ...draft,
      values: { ...(draft.values || {}) },
      masked: { ...(draft.masked || {}) },
    };
    if (!host) return next;
    host.querySelectorAll('[data-payment-field]').forEach((input) => {
      const field = input.dataset.paymentField;
      const value = String(input.value || '').trim();
      if (field === 'sortCode' || field === 'accountNumber' || field === 'iban' || field === 'swiftBic') {
        next.values[field] = value;
      } else {
        next[field] = value;
      }
    });
    return next;
  }

  function syncPaymentPanels(host) {
    if (!host) return;
    const method = String(qs('[data-payment-field="paymentMethod"]', host)?.value || 'gbp_local').trim().toLowerCase() === 'iban_swift'
      ? 'iban_swift'
      : 'gbp_local';
    host.querySelectorAll('[data-payment-method-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.paymentMethodPanel !== method;
    });
  }

  async function loadPaymentDetails(candidate) {
    const response = await state.helpers.api('admin-candidate-payment-details', 'POST', {
      action: 'get',
      candidateId: candidate.id,
    });
    candidate.payment_details_admin = response?.paymentDetails ? { ...response.paymentDetails } : buildPaymentDraft(candidate);
    if (response?.paymentSummary) candidate.payment_summary = normalisePaymentSummary({ payment_summary: response.paymentSummary });
    if (response?.onboarding) candidate.onboarding = response.onboarding;
    const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
    if (index >= 0) state.raw[index] = { ...candidate };
    refreshDrawerPayment(candidate);
    refreshDrawerProfile(candidate, { preserveDirty: true });
    refreshDrawerOnboarding(candidate);
  }

  async function savePaymentDetails(candidate) {
    const draft = readPaymentDraft(candidate);
    const response = await state.helpers.api('admin-candidate-payment-details', 'POST', {
      action: 'save',
      candidateId: candidate.id,
      account_currency: draft.accountCurrency,
      payment_method: draft.paymentMethod,
      account_holder_name: draft.accountHolderName,
      bank_name: draft.bankName,
      bank_location_or_country: draft.bankLocationOrCountry,
      account_type: draft.accountType,
      sort_code: draft.values.sortCode,
      account_number: draft.values.accountNumber,
      iban: draft.values.iban,
      swift_bic: draft.values.swiftBic,
    });
    candidate.payment_details_admin = response?.paymentDetails ? { ...response.paymentDetails } : buildPaymentDraft(candidate);
    if (response?.paymentSummary) candidate.payment_summary = normalisePaymentSummary({ payment_summary: response.paymentSummary });
    if (response?.onboarding) candidate.onboarding = response.onboarding;
    const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
    if (index >= 0) state.raw[index] = { ...candidate };
    refreshDrawerPayment(candidate);
    refreshDrawerProfile(candidate, { preserveDirty: true });
    refreshDrawerOnboarding(candidate);
    applyFilters();
    showToast(response?.message || 'Payment details saved.', 'info', 2400);
  }

  function bindPaymentEditors(candidate) {
    const host = elements.dwPayment;
    if (!host) return;
    const inputs = host.querySelectorAll('[data-payment-field]');
    const saveButton = host.querySelector('[data-action="save-payment-details"]');
    const loadButton = host.querySelector('[data-action="load-payment-details"]');
    const saveStatus = host.querySelector('[data-payment-save-status]');

    const updateSaveState = (message) => {
      const pending = Array.from(inputs).filter((input) => input.dataset.dirty === 'true');
      if (saveButton) saveButton.disabled = pending.length === 0;
      if (saveStatus) {
        if (message) saveStatus.textContent = message;
        else if (pending.length) saveStatus.textContent = `${pending.length} unsaved payment field${pending.length === 1 ? '' : 's'}.`;
      }
    };

    inputs.forEach((input) => {
      const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(eventName, () => {
        input.dataset.dirty = 'true';
        candidate.payment_details_admin = readPaymentDraft(candidate, host);
        if (input.dataset.paymentField === 'paymentMethod') syncPaymentPanels(host);
        updateSaveState();
      });
    });
    syncPaymentPanels(host);
    if (loadButton) {
      loadButton.addEventListener('click', async () => {
        loadButton.disabled = true;
        updateSaveState('Loading secure payment values…');
        try {
          await loadPaymentDetails(candidate);
        } catch (err) {
          console.error('[candidates] payment detail load failed', err);
          showToast(err.message || 'Could not load payment details.', 'error', 4200);
          updateSaveState('Could not load secure payment values.');
          loadButton.disabled = false;
        }
      });
    }
    if (saveButton) {
      saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        updateSaveState('Saving payment details…');
        try {
          await savePaymentDetails(candidate);
        } catch (err) {
          console.error('[candidates] payment save failed', err);
          showToast(err.message || 'Could not save payment details.', 'error', 4200);
          saveButton.disabled = false;
          updateSaveState('Save failed. Review the payment fields and try again.');
        }
      });
    }
  }

  function renderNotes(candidate) {
    const list = candidate.notes && candidate.notes.length
      ? candidate.notes.map((note) => `
            <article class="note">
              <header>
                <strong>${note.author_email || 'System'}</strong>
                <span class="muted">${formatDateTime(note.created_at)}</span>
              </header>
              <p>${note.body || ''}</p>
              <button class="btn ghost" data-note-delete="${note.id}" type="button">Delete</button>
            </article>`).join('')
      : '<div class="muted">No notes yet.</div>';
    return `
      <div class="notes">
        <div class="note-form">
          <textarea rows="3" placeholder="Add note" class="drawer-input" id="note-text"></textarea>
          <button class="btn" id="note-add" type="button">Add note</button>
        </div>
        <div class="note-list">${list}</div>
      </div>`;
  }

  function renderAudit(candidate) {
    const applications = Array.isArray(candidate.applications) ? candidate.applications : [];
    const auditRows = Array.isArray(candidate.audit) ? candidate.audit : [];
    const applicationsMarkup = applications.length
      ? `<div style="margin-bottom:18px"><h3 style="margin:0 0 10px">Recent applications</h3><div class="audit-list">${applications
          .slice(0, 8)
          .map((entry) => `<div class="audit-row"><strong>${formatDateTime(entry.applied_at)}</strong><span>${entry.job_title || entry.job_id || 'HMJ role'} · ${statusLabel(entry.status || 'in progress')}</span></div>`)
          .join('')}</div></div>`
      : '<div class="muted" style="margin-bottom:18px">No tracked portal applications yet.</div>';
    const activityMarkup = auditRows.length
      ? `<div><h3 style="margin:0 0 10px">Portal activity</h3><div class="audit-list">${auditRows
          .slice(0, 20)
          .map((entry) => `<div class="audit-row"><strong>${formatDateTime(entry.at || entry.created_at)}</strong><span>${entry.description || entry.action || entry.activity_type || ''}</span></div>`)
          .join('')}</div></div>`
      : '<div class="muted">Portal activity history empty.</div>';
    return `${applicationsMarkup}${activityMarkup}`;
  }

  function bindProfileEditors(candidate) {
    const section = elements.dwProfile;
    const inputs = section.querySelectorAll('[data-field]');
    const saveButton = section.querySelector('[data-action="save-profile"]');
    const saveStatus = section.querySelector('[data-save-status]');

    const readFieldValue = (input) => (input.type === 'date' ? input.value : input.value.trim());
    const clearDirty = (input) => {
      delete input.dataset.dirty;
      delete input.dataset.saving;
    };
    const dirtyInputs = () => Array.from(inputs).filter((input) => input.dataset.dirty === 'true');
    const updateSaveState = (message) => {
      const pending = dirtyInputs();
      if (saveButton) {
        saveButton.disabled = pending.length === 0 || pending.some((input) => input.dataset.saving === 'true');
      }
      if (!saveStatus) return;
      if (message) {
        saveStatus.textContent = message;
        return;
      }
      if (!pending.length) {
        saveStatus.textContent = 'All visible changes are saved to Supabase.';
        return;
      }
      saveStatus.textContent = `${pending.length} unsaved field${pending.length === 1 ? '' : 's'} in this profile.`;
    };

    inputs.forEach((input) => {
      const markDirty = () => {
        input.dataset.dirty = 'true';
        updateSaveState();
      };
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', markDirty);
      input.addEventListener('blur', async (ev) => {
        const field = ev.target.dataset.field;
        if (ev.target.dataset.dirty !== 'true' || ev.target.dataset.saving === 'true') return;
        const value = readFieldValue(ev.target);
        ev.target.dataset.saving = 'true';
        updateSaveState('Saving field…');
        const saved = await saveField(candidate, field, value, { quiet: true });
        if (saved) {
          clearDirty(ev.target);
          updateSaveState('Field saved.');
        } else {
          delete ev.target.dataset.saving;
          updateSaveState('Save failed. Use Save changes to retry.');
        }
      });
    });
    if (saveButton) {
      saveButton.addEventListener('click', async () => {
        const pending = dirtyInputs();
        if (!pending.length) {
          updateSaveState('All visible changes are already saved.');
          return;
        }
        const patch = {};
        pending.forEach((input) => {
          patch[input.dataset.field] = readFieldValue(input);
          input.dataset.saving = 'true';
        });
        updateSaveState('Saving changes…');
        const saved = await saveCandidatePatch(candidate, patch, { quiet: true });
        if (saved) {
          pending.forEach((input) => clearDirty(input));
          updateSaveState('Changes saved to Supabase.');
          showToast('Candidate profile updated', 'info', 2200);
          if (state.drawerId && String(state.drawerId) === String(candidate.id)) {
            renderDrawer(candidate);
          }
        } else {
          pending.forEach((input) => { delete input.dataset.saving; });
          updateSaveState('Save failed. Review the fields and try again.');
        }
      });
    }
    const pdfBtn = section.querySelector('[data-action="download-pdf"]');
    if (pdfBtn) pdfBtn.addEventListener('click', () => generatePdf(candidate));
    section.querySelectorAll('[data-onboarding-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.onboardingAction === 'send-rtw-reminder') {
          btn.disabled = true;
          try {
            await sendRtwReminders([candidate.id]);
          } catch (err) {
            console.error('[candidates] onboarding action failed', err);
            showToast(err.message || 'Could not send right-to-work reminder.', 'error', 4200);
          } finally {
            btn.disabled = false;
          }
          return;
        }
        if (btn.dataset.onboardingAction === 'send-doc-request') {
          openDocumentRequestDialog([candidate.id]);
          return;
        }
        if (btn.dataset.onboardingAction === 'copy-upload-link') {
          await copyCandidateUploadLink({
            requestType: 'documents',
            documentTypes: ['passport', 'qualification_certificate', 'reference'],
          });
        }
      });
    });
    section.querySelectorAll('[data-tsp-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.tspAction;

        if (action === 'push-to-tsp') {
          /* Open the Bullhorn → Push-to-TSP dialog */
          const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || 'candidate';
          if (typeof window.openPushTspDialog === 'function') {
            window.openPushTspDialog(candidate.id, name);
          } else {
            showToast('Push-to-TSP dialog not available.', 'warn', 3000);
          }
          return;
        }

        if (action !== 'sync-candidate') return;
        btn.disabled = true;
        try {
          await runTimesheetPortalCandidateSync({ candidateIds: [candidate.id] });
          const refreshed = await fetchCandidate(candidate.id).catch(() => null);
          if (refreshed) renderDrawer(refreshed);
          showToast('Candidate synced from Timesheet Portal.', 'ok', 3200);
        } catch (err) {
          console.error('[candidates] single candidate TSP sync failed', err);
          showToast(err.message || 'Could not sync this candidate from Timesheet Portal.', 'error', 4200);
        } finally {
          btn.disabled = false;
        }
      });
    });
    section.querySelectorAll('[data-account-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.accountAction;
        if (!action) return;
        await runPortalAccountAction(candidate, action, btn);
      });
    });

    // ── Provisional starter CRM actions ──────────────────────────────────
    section.querySelectorAll('[data-starter-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.starterAction;
        if (!action) return;

        if (action === 'send-reminder') {
          btn.disabled = true;
          btn.textContent = 'Sending…';
          try {
            const res = await state.helpers.api('admin-send-intro-email', 'POST', {
              first_name: btn.dataset.firstName || candidate.first_name || '',
              last_name: btn.dataset.lastName || candidate.last_name || '',
              email: btn.dataset.email || candidate.email || '',
              company: btn.dataset.company || candidate.client_name || '',
              job_title: btn.dataset.jobTitle || candidate.job_title || '',
              candidate_id: candidate.id,
              is_reminder: true,
            });
            showToast(res?.ok
              ? `Reminder sent to ${candidate.email || 'starter'}.`
              : (res?.message || 'Reminder send failed.'), res?.ok ? 'ok' : 'error', 4000);
            // Refresh to show new activity in audit tab
            const refreshed = await fetchCandidate(candidate.id).catch(() => null);
            if (refreshed) renderDrawer(refreshed);
          } catch (err) {
            showToast(err.message || 'Could not send reminder.', 'error', 4200);
          } finally {
            btn.disabled = false;
            btn.textContent = '↻ Send reminder email';
          }
          return;
        }

        if (action === 'cancel') {
          if (!confirm(`Cancel ${candidate.name || candidate.email || 'this starter'}? This will mark them as no longer starting and can be undone by updating their status.`)) return;
          btn.disabled = true;
          try {
            await state.helpers.api('admin-candidate-starter-cancel', 'POST', {
              candidateId: candidate.id,
              reason: 'Cancelled by admin — no longer starting.',
            });
            showToast('Starter cancelled. Profile marked as no longer starting.', 'ok', 4000);
            const refreshed = await fetchCandidate(candidate.id).catch(() => null);
            if (refreshed) renderDrawer(refreshed);
          } catch (err) {
            showToast(err.message || 'Could not cancel starter.', 'error', 4200);
          } finally {
            btn.disabled = false;
          }
          return;
        }
      });
    });

    updateSaveState();
  }

  function bindOnboardingActions(candidate) {
    const section = elements.dwOnboarding;
    if (!section) return;
    section.querySelectorAll('[data-onboarding-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.onboardingAction;
        if (!action) return;
        if (action === 'send-doc-request') {
          openDocumentRequestDialog([candidate.id]);
          return;
        }
        if (action === 'copy-upload-link') {
          await copyCandidateUploadLink({
            requestType: 'documents',
            documentTypes: ['right_to_work', 'bank_document', 'reference'],
          });
          return;
        }
        btn.disabled = true;
        try {
          if (action === 'send-reminder-general') {
            await sendOnboardingRequest({
              candidateIds: [candidate.id],
              requestType: 'general',
              skipConfirm: true,
            });
          } else if (action === 'send-verification-complete') {
            await sendOnboardingRequest({
              candidateIds: [candidate.id],
              requestType: 'verification_complete',
              skipConfirm: true,
            });
          } else if (action === 'mark-verified') {
            const documentId = candidate?.onboarding?.rightToWork?.documentId;
            if (!documentId) return;
            await reviewCandidateDocument(candidate, documentId, 'verify');
          }
        } catch (err) {
          console.error('[candidates] onboarding section action failed', err);
          showToast(err.message || 'Onboarding action failed.', 'error', 4200);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function copyText(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (err) {
      console.warn('[candidates] clipboard write failed', err);
    }
    window.prompt('Copy this link', value);
    return true;
  }

  async function copyCandidateUploadLink({ requestType = 'documents', documentTypes = [] } = {}) {
    const copied = await copyText(buildCandidateUploadLink({ requestType, documentTypes }));
    if (copied) showToast('Secure candidate upload link copied.', 'info', 3600);
    return copied;
  }

  function renderOutreachStatus() {
    if (!elements.outreachStatus) return;
    const diagnostics = state.outreachDiagnostics;
    if (!diagnostics) {
      elements.outreachStatus.textContent = 'Checking candidate outreach delivery…';
      return;
    }
    if (diagnostics.publicDeliveryReady) {
      const sourceLabel = diagnostics.deliverySource === 'smtp' ? 'SMTP' : 'Resend';
      elements.outreachStatus.textContent = `Candidate reminder delivery is ready via ${sourceLabel}.`;
      return;
    }
    if (diagnostics.resendConfigured && diagnostics.resendReady === false) {
      elements.outreachStatus.textContent = diagnostics.resendMessage
        || 'Candidate reminder delivery is blocked because the configured RESEND_API_KEY was rejected. Fix the key or save SMTP settings in Admin Settings.';
      return;
    }
    if (diagnostics.smtpStatus === 'invalid_credentials') {
      elements.outreachStatus.textContent = diagnostics.smtpMessage
        || 'Candidate reminder delivery is blocked because the saved SMTP login was rejected by the mail server.';
      return;
    }
    if (diagnostics.smtpCredentialsSaved && diagnostics.smtpMessage) {
      elements.outreachStatus.textContent = diagnostics.smtpMessage;
      return;
    }
    elements.outreachStatus.textContent = 'Candidate reminder delivery is not configured. Save SMTP settings in Admin Settings or add a working RESEND_API_KEY.';
  }

  function showOutreachConfigurationError(message, { copiedLink = false } = {}) {
    const suffix = copiedLink
      ? '\n\nA secure upload link has been copied so you can still send it manually.'
      : '';
    const guidance = '\n\nFix this in Admin Settings -> Candidate email settings by saving working SMTP details, or replace the invalid RESEND_API_KEY in Netlify.';
    const text = `${message}${guidance}${suffix}`;
    window.alert(text);
    showToast(message, 'error', 5200);
  }

  async function runPortalAccountAction(candidate, action, button) {
    const label = button?.textContent || 'Action';
    let password = null;
    if (action === 'set_temporary_password') {
      const firstEntry = window.prompt('Enter a temporary password for this candidate.\nUse at least 8 characters, including one letter and one number.');
      if (firstEntry == null) return;
      const secondEntry = window.prompt('Re-enter the temporary password to confirm it.');
      if (secondEntry == null) return;
      if (String(firstEntry) !== String(secondEntry)) {
        showToast('The temporary password entries did not match.', 'error', 3200);
        return;
      }
      password = String(firstEntry);
    }
    if (button) button.disabled = true;
    try {
      const response = await state.helpers.api('admin-candidate-account', 'POST', {
        action,
        candidateId: candidate.id,
        email: candidate.email,
        password,
      });
      if (response?.reset_link) {
        await copyText(response.reset_link);
      }
      if (response?.access_link) {
        await copyText(response.access_link);
      }
      if (response?.candidate) {
        const record = normalizeCandidate(response.candidate);
        if (response.auth) {
          record.portal_auth = response.auth;
          record.auth_user_id = record.auth_user_id || response.auth.user_id || null;
          record.has_portal_account = !!response.auth.exists;
          record.last_portal_login_at = record.last_portal_login_at || response.auth.last_sign_in_at || '';
        }
        const index = state.raw.findIndex((row) => String(row.id) === String(record.id));
        if (index >= 0) state.raw[index] = record;
        else state.raw.unshift(record);
        applyFilters();
        renderDrawer(record);
      } else if (response?.auth) {
        candidate.portal_auth = response.auth;
        candidate.auth_user_id = candidate.auth_user_id || response.auth.user_id || null;
        candidate.has_portal_account = !!response.auth.exists;
        candidate.last_portal_login_at = candidate.last_portal_login_at || response.auth.last_sign_in_at || '';
        renderDrawer(candidate);
      }
      showToast(response?.message || `${label} complete.`, 'info', 2800);
    } catch (err) {
      console.error('[candidates] portal account action failed', err);
      showToast(err.message || `${label} failed.`, 'error', 4200);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindNoteActions(candidate) {
    const host = elements.dwNotes;
    const addBtn = qs('#note-add', host);
    const field = qs('#note-text', host);
    if (addBtn && field) {
      addBtn.addEventListener('click', async () => {
        const text = field.value.trim();
        if (!text) {
          showToast('Note empty', 'warn');
          return;
        }
        field.value = '';
        await appendNote(candidate, text);
      });
    }
    host.querySelectorAll('[data-note-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const noteId = btn.dataset.noteDelete;
        await deleteNote(candidate, noteId);
      });
    });
  }

  function buildSavePayload(candidate, patch) {
    const payload = { id: candidate.id };
    for (const [field, rawValue] of Object.entries(patch || {})) {
      if (field === 'skills') {
        payload.skills = parseSkills(rawValue);
        continue;
      }
      if (field === 'right_to_work_regions') {
        payload.right_to_work_regions = parseSkills(rawValue);
        continue;
      }
      if (field === 'onboarding_mode' || field === 'consent_captured') {
        payload[field] = String(rawValue) === 'true' || rawValue === true;
        continue;
      }
      payload[field] = rawValue;
    }
    if (!payload.first_name && candidate.first_name) payload.first_name = candidate.first_name;
    if (!payload.last_name && candidate.last_name) payload.last_name = candidate.last_name;
    if (!payload.full_name && candidate.full_name) payload.full_name = candidate.full_name;
    return payload;
  }

  async function callSave(payload) {
    try {
      pushLog({ action: 'save', detail: `Candidate ${payload.id}` });
      console.info('[candidates] save payload', payload);
      return await state.helpers.api('admin-candidates-save', 'POST', payload);
    } catch (err) {
      if (/supabase/i.test(String(err.message))) state.supabaseMode = 'error';
      updateSupabaseBadge();
      throw err;
    }
  }

  async function saveField(candidate, field, value, { quiet = false } = {}) {
    return saveCandidatePatch(candidate, { [field]: value }, { quiet });
  }

  async function saveCandidatePatch(candidate, patch, { quiet = false } = {}) {
    const payload = buildSavePayload(candidate, patch);
    try {
      const response = await callSave(payload);
      const nextRecord = response?.candidate
        ? {
            ...candidate,
            ...normalizeCandidate(response.candidate),
            docs: Array.isArray(candidate.docs) ? candidate.docs.slice() : [],
            notes: Array.isArray(candidate.notes) ? candidate.notes.slice() : [],
            audit: Array.isArray(candidate.audit) ? candidate.audit.slice() : [],
            applications: Array.isArray(candidate.applications) ? candidate.applications.slice() : [],
            assignments: Array.isArray(candidate.assignments) ? candidate.assignments.slice() : [],
            assignment_options: Array.isArray(candidate.assignment_options) ? candidate.assignment_options.slice() : [],
          }
        : { ...candidate, ...payload, ...patch };
      if (response?.portal_auth) {
        nextRecord.portal_auth = response.portal_auth;
        nextRecord.auth_user_id = nextRecord.auth_user_id || response.portal_auth.user_id || null;
        nextRecord.has_portal_account = !!response.portal_auth.exists;
        nextRecord.last_portal_login_at = nextRecord.last_portal_login_at || response.portal_auth.last_sign_in_at || '';
      }
      Object.assign(candidate, nextRecord);
      const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
      if (index >= 0) state.raw[index] = { ...candidate };
      applyFilters();
      refreshDrawerOnboarding(candidate);
      if (!quiet) {
        showToast(response?.warning || 'Saved', response?.warning ? 'warn' : 'info', response?.warning ? 3600 : 1600);
      }
      return true;
    } catch (err) {
      console.error('[candidates] save failed', err);
      pushLog({ action: 'save:error', detail: err?.message || 'Save failed' });
      showToast(err.message || 'Save failed', 'error');
      return false;
    }
  }

  async function appendNote(candidate, text) {
    const author = state.identity?.email || 'admin';
    const updated = [...(candidate.notes || []), { id: `${candidate.id}-note-${Date.now()}`, body: text, author_email: author, created_at: new Date().toISOString() }];
    const payload = updated.map((note) => note.body).join('\n');
    const saved = await saveField(candidate, 'notes', payload);
    if (!saved) return;
    candidate.notes = updated;
    renderDrawer(candidate);
  }

  async function deleteNote(candidate, noteId) {
    const remaining = (candidate.notes || []).filter((note) => String(note.id) !== String(noteId));
    const payload = remaining.map((note) => note.body).join('\n');
    const saved = await saveField(candidate, 'notes', payload);
    if (!saved) return;
    candidate.notes = remaining;
    renderDrawer(candidate);
  }

  async function toggleBlock(candidate) {
    const next = candidate.status === 'blocked' ? 'in progress' : 'blocked';
    await updateStatus(candidate, next, {
      successMessage: next === 'blocked' ? 'Candidate blocked' : 'Candidate unblocked',
    });
  }

  async function updateStatus(candidate, nextStatus, { successMessage, confirmMessage } = {}) {
    if (!candidate || !nextStatus || String(candidate.status || '').toLowerCase() === String(nextStatus).toLowerCase()) {
      return;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const saved = await saveField(candidate, 'status', nextStatus, { quiet: true });
    if (!saved) return;
    candidate.status = nextStatus;
    if (state.drawerId && String(state.drawerId) === String(candidate.id)) {
      renderDrawer(candidate);
    }
    showToast(successMessage || `Candidate moved to ${statusLabel(nextStatus)}`, 'info', 2200);
  }

  async function toggleArchive(candidate) {
    const archived = isArchived(candidate);
    const next = archived ? 'active' : 'archived';
    const successMessage = archived ? 'Candidate restored to active' : 'Candidate archived';
    const confirmMessage = archived
      ? ''
      : `Archive ${candidate.name || 'this candidate'}? They will stay in the system and can be restored later.`;
    await updateStatus(candidate, next, { successMessage, confirmMessage });
  }

  async function fetchCandidate(id) {
    try {
      pushLog({ action: 'get', detail: `Candidate ${id}` });
      const res = await state.helpers.api('admin-candidates-get', 'POST', { id });
      const record = normalizeCandidate(res);
      if (record) {
        const index = state.raw.findIndex((row) => String(row.id) === String(record.id));
        if (index >= 0) state.raw[index] = record;
        else state.raw.push(record);
        applyFilters();
      }
      return record;
    } catch (err) {
      console.warn('[candidates] fetch candidate fallback', err);
      const fallback = findCandidate(id);
      if (!fallback) throw err;
      return fallback;
    }
  }

  async function getFallbackRows() {
    try {
      const res = await fetch('/data/candidates.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json?.candidates) ? json.candidates : Array.isArray(json) ? json : [];
      return rows.map(normalizeCandidate).filter(Boolean);
    } catch (err) {
      console.warn('[candidates] fallback load failed', err);
      return [];
    }
  }

  function renderReauth() {
    rowsInner.innerHTML = '<div class="empty-state">Session expired. <button class="btn" id="reauth">Re-auth</button></div>';
    const btn = qs('#reauth', rowsInner);
    if (btn) btn.addEventListener('click', () => window.netlifyIdentity?.open('login'));
  }

  function renderRetry() {
    rowsInner.innerHTML = '<div class="empty-state">Network error. <button class="btn" id="retry-load">Retry</button></div>';
    const btn = qs('#retry-load', rowsInner);
    if (btn) btn.addEventListener('click', () => loadCandidates({ silent: true }));
  }

  async function loadCandidates({ silent = false } = {}) {
    if (!silent) renderSkeleton();
    const started = performance.now();
    try {
      const basePayload = {
        query: state.filters.query,
        status: state.filters.status,
        role: state.filters.role,
        region: state.filters.region,
        skills: state.filters.skills,
        availability: state.filters.availability,
        created_from: state.filters.createdFrom,
        created_to: state.filters.createdTo,
        quick: state.quickSearch
      };
      pushLog({ action: 'list', detail: 'Loading candidates' });
      let page = 1;
      let pages = 1;
      let lastResponse = null;
      const rows = [];

      while (page <= pages) {
        const response = await state.helpers.api('admin-candidates-list', 'POST', {
          ...basePayload,
          page,
          size: 250,
        });
        lastResponse = response;
        const pageRows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response) ? response : [];
        rows.push(...pageRows);
        pages = Math.max(1, Number(response?.pages) || 1);
        page += 1;
        if (page > 20) break;
      }

      state.supabaseMode = lastResponse?.supabase?.ok ? 'live' : 'cache';
      state.cacheMode = !lastResponse?.supabase?.ok;
      updateSupabaseBadge();
      state.raw = rows.map(normalizeCandidate).filter(Boolean);
      loadSelection();
      applyFilters();
      state.lastQueryMs = Math.round(performance.now() - started);
      pushLog({ action: 'list:ok', detail: `${state.raw.length} rows in ${state.lastQueryMs}ms` });
      if (!silent) showToast(`Loaded ${state.raw.length} candidates`, 'info', 2400);
    } catch (err) {
      console.error('[candidates] load failed', err);
      pushLog({ action: 'list:error', detail: err.message || 'error' });
      state.supabaseMode = /403/.test(String(err.message)) ? 'error' : 'cache';
      updateSupabaseBadge();
      if (/403/.test(String(err.message))) {
        showToast('Session expired — re-auth required.', 'warn', 5000);
        renderReauth();
      } else if (err.message === 'Failed to fetch') {
        showToast('Network error. Retry available.', 'error');
        renderRetry();
      }
      const fallback = await getFallbackRows();
      if (fallback.length) {
        state.cacheMode = true;
        state.raw = fallback;
        applyFilters();
        showToast('Offline mode — using cached dataset.', 'warn', 4200);
      }
    }
  }

  function updateQuickSearch(value) {
    state.quickSearch = value.trim().toLowerCase();
    applyFilters();
  }

  function clearFilters() {
    state.filters = { ...DEFAULT_FILTERS };
    applyFilterInputs();
    saveFilters(state.filters);
    applyFilters();
  }

  function handleScroll() {
    window.requestAnimationFrame(updateVisibleRows);
  }

  function setSourceTab(nextTab) {
    if (!SOURCE_TABS[nextTab] || state.sourceTab === nextTab) return;
    state.sourceTab = nextTab;
    applyFilters();
    if ((nextTab === 'timesheet-portal' || nextTab === 'combined' || nextTab === 'timesheet-portal-active') && !state.tspCompare) {
      refreshTimesheetPortalCompare();
    }
    if (nextTab === 'timesheet-portal-active' && !state.assignmentRows.length && !state.assignmentLoading) {
      refreshActiveAssignments();
    }
  }

  function handleSelectAll(event) {
    if (!event.target.checked) {
      clearSelection();
      return;
    }
    const ids = state.filtered
      .filter((row) => isSelectableCandidate(row, currentSelectionOptions()))
      .map((row) => row.id);
    setSelection(ids);
  }

  function selectVisibleCandidates() {
    const ids = state.filtered
      .filter((row) => isSelectableCandidate(row, currentSelectionOptions()))
      .map((row) => row.id);
    if (!ids.length) {
      showToast('No visible candidates can be selected in this view.', 'warn', 3200);
      return;
    }
    setSelection(ids);
    showToast(`Selected ${ids.length} visible candidate${ids.length === 1 ? '' : 's'}.`, 'info', 2600);
  }

  async function bulkCopyEmails() {
    const rows = selectedCandidates({ allowRaw: true }).filter((candidate) => !!String(candidate?.email || '').trim());
    const emails = Array.from(new Set(rows.map((candidate) => String(candidate.email || '').trim().toLowerCase()).filter(Boolean)));
    if (!emails.length) {
      showToast('No selected email addresses were available to copy.', 'warn', 3200);
      return;
    }
    const copied = await copyText(emails.join(', '));
    if (copied) showToast(`Copied ${emails.length} email address${emails.length === 1 ? '' : 'es'}.`, 'info', 3200);
  }

  function bindBulkActions() {
    elements.bulkCopyEmails.addEventListener('click', () => bulkCopyEmails());
    elements.bulkSendEmail.addEventListener('click', () => openBulkEmailDialog());
    elements.bulkIntroEmail.addEventListener('click', () => bulkIntroEmail());
    elements.bulkAssign.addEventListener('click', () => bulkAssign());
    elements.bulkStatus.addEventListener('click', () => bulkStatus());
    elements.bulkBlock.addEventListener('click', () => bulkStatus('blocked'));
    elements.bulkArchive.addEventListener('click', () => bulkStatus('archived'));
    elements.bulkDocRequest.addEventListener('click', () => bulkDocumentRequest());
    elements.bulkReminder.addEventListener('click', () => bulkReminder());
    elements.bulkExport.addEventListener('click', () => exportCsv({ mode: 'selected' }));
    elements.bulkClear.addEventListener('click', () => clearSelection());
  }

  function selectMissingRtw() {
    const ids = state.filtered
      .filter((candidate) => isSelectableCandidate(candidate, currentSelectionOptions()))
      .filter((candidate) => candidate.onboarding?.hasRightToWork !== true && candidate.onboarding?.hasRightToWorkUpload !== true)
      .map((candidate) => candidate.id);
    if (!ids.length) {
      showToast('No visible candidates are missing right-to-work documents.', 'warn');
      return;
    }
    setSelection(ids);
    showToast(`Selected ${ids.length} candidate${ids.length === 1 ? '' : 's'} missing right-to-work documents.`, 'info', 2600);
  }

  function promptStatus(defaultStatus) {
    if (defaultStatus) return defaultStatus;
    const options = Object.keys(STATUS_META).join(', ');
    const answer = window.prompt(`Status (${options})`);
    return answer ? answer.toLowerCase() : null;
  }

  async function bulkStatus(forceStatus) {
    if (!state.selection.size) {
      showToast('Select candidates first', 'warn');
      return;
    }
    const status = promptStatus(forceStatus);
    if (!status) return;
    const rows = selectedCandidates();
    if (!rows.length) {
      showToast('Status updates apply to website candidates only.', 'warn', 3200);
      return;
    }
    let savedCount = 0;
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const saved = await saveField(row, 'status', status, { quiet: true });
      if (saved) savedCount += 1;
    }
    showToast(
      savedCount === rows.length ? `Updated ${rows.length} candidates` : `Updated ${savedCount} of ${rows.length} candidates`,
      savedCount === rows.length ? 'info' : 'warn'
    );
    clearSelection();
  }

  async function bulkAssign() {
    if (!state.selection.size) {
      showToast('Select candidates first', 'warn');
      return;
    }
    const recruiter = window.prompt('Assign to recruiter (email)');
    if (!recruiter) return;
    const rows = selectedCandidates();
    if (!rows.length) {
      showToast('Assignment notes apply to website candidates only.', 'warn', 3200);
      return;
    }
    rows.forEach((row) => {
      row.audit = row.audit || [];
      row.audit.unshift({ at: new Date().toISOString(), action: `Assigned to ${recruiter}` });
    });
    showToast(`Assigned ${rows.length} candidates to ${recruiter}`, 'info');
    renderDrawer(state.drawerId ? findCandidate(state.drawerId) : null);
    clearSelection();
  }

  async function sendOnboardingRequest({ candidateIds, requestType = 'rtw', documentTypes = [], skipConfirm = true, force = false }) {
    if (state.outreachDiagnostics && state.outreachDiagnostics.publicDeliveryReady !== true) {
      await copyCandidateUploadLink({ requestType, documentTypes });
      showOutreachConfigurationError(
        state.outreachDiagnostics.smtpStatus === 'invalid_credentials'
          ? (state.outreachDiagnostics.smtpMessage || 'Candidate emails are currently blocked because the saved SMTP login was rejected by the mail server.')
          : state.outreachDiagnostics.resendConfigured && state.outreachDiagnostics.resendReady === false
          ? 'Candidate emails are currently blocked because the configured RESEND_API_KEY is invalid.'
          : state.outreachDiagnostics.smtpCredentialsSaved
            ? (state.outreachDiagnostics.smtpMessage || 'Candidate emails are currently blocked because the saved SMTP configuration could not be verified.')
          : 'Candidate emails are not configured on this website yet.',
        { copiedLink: true }
      );
      return;
    }
    const payloadIds = Array.isArray(candidateIds) && candidateIds.length
      ? candidateIds.map((id) => String(id))
      : [];
    const preview = await state.helpers.api('admin-candidate-onboarding-reminders', 'POST', {
      action: 'preview',
      candidateIds: payloadIds,
      requestType,
      documentTypes,
    });
    const eligible = Array.isArray(preview?.candidates) ? preview.candidates : [];
    const requestLabel = onboardingRequestLabel(requestType, documentTypes);
    if (!eligible.length) {
      let message = `No selected candidates currently need this ${requestLabel}.`;
      if (requestType === 'rtw') message = 'No selected candidates are currently missing right-to-work documents.';
      if (requestType === 'documents') message = 'No selected candidates are missing the requested onboarding documents.';
      if (requestType === 'verification_complete') message = 'No selected candidates are currently ready for a verification complete email.';
      if (requestType === 'general') message = 'No selected candidates currently need a general onboarding reminder.';
      showToast(message, 'warn', 3600);
      return;
    }
    if (!skipConfirm) {
      const sampleNames = eligible.slice(0, 3).map((candidate) => candidate.full_name || candidate.email).join(', ');
      const previewText = eligible.length > 3 ? `${sampleNames}, and ${eligible.length - 3} more` : sampleNames;
      let confirmMessage = `Send ${requestLabel} to ${eligible.length} candidate${eligible.length === 1 ? '' : 's'}?\n\n${previewText}`;
      if (requestType === 'rtw') confirmMessage = `Send secure right-to-work reminders to ${eligible.length} candidate${eligible.length === 1 ? '' : 's'}?\n\n${previewText}`;
      if (requestType === 'documents') confirmMessage = `Send secure ${formatDocumentRequestList(documentTypes).toLowerCase()} requests to ${eligible.length} candidate${eligible.length === 1 ? '' : 's'}?\n\n${previewText}`;
      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) return;
    }
    let response = await state.helpers.api('admin-candidate-onboarding-reminders', 'POST', {
      action: 'send',
      candidateIds: payloadIds,
      requestType,
      documentTypes,
      force,
    });
    if (response?.ok === false) {
      if (response?.actionUrl) await copyText(response.actionUrl);
      showOutreachConfigurationError(
        response?.message || 'Candidate onboarding email delivery failed.',
        { copiedLink: !!response?.actionUrl }
      );
      return;
    }
    const recentSkips = Array.isArray(response?.skipped)
      ? response.skipped.filter((entry) => entry?.reason === 'recently_sent').length
      : 0;
    if (!force && Number(response?.sentCount || 0) === 0 && recentSkips > 0) {
      const resend = window.confirm(
        `HMJ already sent ${recentSkips} reminder${recentSkips === 1 ? '' : 's'} in the last 24 hours. Send a fresh reminder anyway?`
      );
      if (resend) {
        response = await state.helpers.api('admin-candidate-onboarding-reminders', 'POST', {
          action: 'send',
          candidateIds: payloadIds,
          requestType,
          documentTypes,
          force: true,
        });
        if (response?.ok === false) {
          if (response?.actionUrl) await copyText(response.actionUrl);
          showOutreachConfigurationError(
            response?.message || 'Candidate onboarding email delivery failed.',
            { copiedLink: !!response?.actionUrl }
          );
          return;
        }
      }
    }
    pushLog({
      action: requestType === 'rtw'
        ? 'rtw:reminders'
        : requestType === 'documents'
        ? 'docs:request'
        : requestType === 'verification_complete'
        ? 'onboarding:verified'
        : 'onboarding:reminder',
      detail: response?.message || `Sent ${response?.sentCount || 0}`,
    });
    showToast(
      response?.message || (requestType === 'rtw'
        ? 'Right-to-work reminders sent.'
        : requestType === 'documents'
        ? 'Document requests sent.'
        : requestType === 'verification_complete'
        ? 'Verification complete emails sent.'
        : 'Onboarding reminders sent.'),
      'info',
      4200,
    );
  }

  async function sendRtwReminders(candidateIds) {
    await sendOnboardingRequest({
      candidateIds,
      requestType: 'rtw',
      documentTypes: ['right_to_work'],
      skipConfirm: true,
    });
  }

  async function bulkReminder() {
    if (!state.selection.size) {
      showToast('Select candidates first', 'warn');
      return;
    }
    try {
      const rows = await ensureWebsiteCandidatesForOutreach(selectedCandidates({ allowRaw: true, includeRaw: true }), {
        onboardingMode: true,
      });
      if (!rows.length) {
        showToast('Select candidates with a valid email address first.', 'warn', 3200);
        return;
      }
      await sendRtwReminders(rows.map((row) => row.id));
    } catch (err) {
      console.error('[candidates] reminder send failed', err);
      showToast(err.message || 'Right-to-work reminder send failed.', 'error', 4200);
    }
  }

  function onboardingModuleAudience() {
    const selectedRows = selectedCandidates({ allowRaw: true, includeRaw: true })
      .filter((row) => !isRawTimesheetPortalCandidate(row) && candidateOnboardingMode(row) && !!String(row?.email || '').trim() && !isArchived(row));
    if (selectedRows.length) return selectedRows;
    return onboardingRowsInView().filter((row) => !!String(row?.email || '').trim() && !isArchived(row));
  }

  async function runOnboardingModuleAction(action) {
    const rows = onboardingModuleAudience();
    if (!rows.length) {
      showToast('Select onboarding records first, or keep starter rows visible in this view.', 'warn', 3600);
      return;
    }
    if (action === 'intro') {
      await bulkIntroEmail(rows);
      return;
    }
    if (action === 'documents') {
      await bulkDocumentRequest(rows.map((row) => row.id));
      return;
    }
    if (action === 'general') {
      await sendOnboardingRequest({
        candidateIds: rows.map((row) => row.id),
        requestType: 'general',
        skipConfirm: false,
      });
      return;
    }
    if (action === 'verification_complete') {
      await sendOnboardingRequest({
        candidateIds: rows.map((row) => row.id),
        requestType: 'verification_complete',
        skipConfirm: false,
      });
    }
  }

  async function bulkDocumentRequest(candidateIds) {
    const directIds = Array.isArray(candidateIds) && candidateIds.length ? candidateIds.map(String) : [];
    const selectedRows = directIds.length
      ? directIds.map((id) => state.filtered.find((row) => String(row.id) === String(id)) || findCandidate(id)).filter(Boolean)
      : selectedCandidates({ allowRaw: true, includeRaw: true });
    if (!selectedRows.length && !directIds.length) {
      showToast('Select candidates first', 'warn');
      return;
    }
    const rows = directIds.length
      ? await ensureWebsiteCandidatesForOutreach(selectedRows, { onboardingMode: true })
      : await ensureWebsiteCandidatesForOutreach(selectedRows, { onboardingMode: true });
    const ids = rows.map((row) => String(row.id)).filter(Boolean);
    if (!ids.length) {
      showToast('Select candidates with a valid email address first.', 'warn', 3200);
      return;
    }
    openDocumentRequestDialog(ids);
  }

  function buildIntroEmailPayload(candidate) {
    const assignment = candidate?.active_assignment_summary || null;
    return {
      first_name: candidate?.first_name || String(candidate?.name || '').split(/\s+/).filter(Boolean)[0] || 'Candidate',
      last_name: candidate?.last_name || String(candidate?.name || '').split(/\s+/).slice(1).join(' ') || 'Candidate',
      email: candidate?.email || '',
      company: assignment?.client_name || 'your HMJ client',
      phone: candidate?.phone || '',
      job_title: assignment?.job_title || candidate?.role || '',
    };
  }

  async function bulkIntroEmail(rowsOverride = null) {
    const sourceRows = Array.isArray(rowsOverride) && rowsOverride.length
      ? rowsOverride
      : selectedCandidates({ allowRaw: true, includeRaw: true });
    const rows = (await ensureWebsiteCandidatesForOutreach(
      sourceRows.filter((candidate) => !!candidate?.email),
      { onboardingMode: true },
    )).filter((candidate) => !!candidate?.email);
    if (!rows.length) {
      showToast('Select candidates with email addresses first.', 'warn', 3200);
      return;
    }
    const confirmed = window.confirm(`Send intro emails to ${rows.length} selected candidate${rows.length === 1 ? '' : 's'}?`);
    if (!confirmed) return;
    if (elements.bulkIntroEmail) elements.bulkIntroEmail.disabled = true;
    let sent = 0;
    const skipped = [];
    for (const candidate of rows) {
      try {
        const payload = buildIntroEmailPayload(candidate);
        // eslint-disable-next-line no-await-in-loop
        await state.helpers.api('admin-send-intro-email', 'POST', payload);
        sent += 1;
      } catch (err) {
        skipped.push({
          candidate,
          error: err?.message || 'send_failed',
        });
      }
    }
    if (elements.bulkIntroEmail) elements.bulkIntroEmail.disabled = false;
    pushLog({
      action: 'intro:bulk',
      detail: `${sent} accepted${skipped.length ? `, ${skipped.length} skipped` : ''}`,
    });
    showToast(
      skipped.length
        ? `Accepted ${sent} intro email${sent === 1 ? '' : 's'} for delivery. ${skipped.length} candidate${skipped.length === 1 ? ' was' : 's were'} skipped.`
        : `Accepted ${sent} intro email${sent === 1 ? '' : 's'} for delivery.`,
      skipped.length ? 'warn' : 'info',
      4600,
    );
  }

  async function refreshActiveAssignments() {
    state.assignmentLoading = true;
    try {
      let page = 1;
      let total = 0;
      const rows = [];
      do {
        // eslint-disable-next-line no-await-in-loop
        const response = await state.helpers.api('admin-assignments-list', 'POST', {
          page,
          pageSize: 200,
          include_tsp_meta: true,
        });
        const pageRows = Array.isArray(response?.rows) ? response.rows : [];
        rows.push(...pageRows);
        total = Number(response?.total || rows.length);
        page += 1;
        if (page > 20) break;
      } while (rows.length < total);
      state.assignmentRows = rows.map((row) => normalizeAssignmentRecord(row)).filter(Boolean);
      state.assignmentLookups = activeAssignmentHelpersReady()
        ? assignmentHelpers.buildAssignmentLookups(state.assignmentRows)
        : { activeRows: [], byCandidateId: new Map(), byReference: new Map() };
      pushLog({
        action: 'assignments:active',
        detail: `${state.assignmentLookups?.activeRows?.length || 0} active assignments indexed`,
      });
      applyFilters();
    } catch (err) {
      console.error('[candidates] active assignment load failed', err);
      pushLog({ action: 'assignments:active:error', detail: err.message || 'error' });
      state.assignmentRows = [];
      state.assignmentLookups = activeAssignmentHelpersReady()
        ? assignmentHelpers.buildAssignmentLookups([])
        : { activeRows: [], byCandidateId: new Map(), byReference: new Map() };
      applyFilters();
    } finally {
      state.assignmentLoading = false;
      refreshRows(true);
    }
  }

  async function refreshTimesheetPortalCompare() {
    if (!elements.tspStatus) return;
    elements.tspStatus.textContent = 'Refreshing Timesheet Portal comparison…';
    try {
      const response = await state.helpers.api('admin-candidates-timesheet-compare', 'POST', {});
      state.tspCompare = response;
      renderTspSummary();
      applyFilters();
    } catch (err) {
      console.error('[candidates] TSP comparison failed', err);
      state.tspCompare = {
        configured: true,
        message: err.message || 'Timesheet Portal comparison failed.',
      };
      renderTspSummary();
      applyFilters();
    }
  }

  async function refreshOutreachReadiness() {
    if (elements.outreachStatus) {
      elements.outreachStatus.textContent = 'Checking candidate outreach delivery…';
    }
    try {
      const response = await state.helpers.api('admin-candidate-email-settings', 'POST', {
        action: 'get',
      });
      state.outreachDiagnostics = response?.diagnostics || null;
    } catch (err) {
      console.error('[candidates] candidate email diagnostics failed', err);
      state.outreachDiagnostics = {
        publicDeliveryReady: false,
        resendConfigured: false,
        resendReady: false,
        resendMessage: err.message || 'Could not verify candidate email delivery.',
        deliverySource: 'none',
      };
    }
    renderOutreachStatus();
  }

  async function runTimesheetPortalCandidateSync({ candidateIds = [], provisionPortalAccounts = false } = {}) {
    if (elements.tspSyncStatus) {
      elements.tspSyncStatus.textContent = provisionPortalAccounts
        ? 'Syncing Timesheet Portal candidates and inviting portal accounts…'
        : 'Syncing Timesheet Portal candidates into Supabase…';
    }
    const response = await state.helpers.api('admin-candidates-sync-timesheet-portal', 'POST', {
      candidateIds,
      provisionPortalAccounts,
    });
    if (response?.configured === false) {
      if (elements.tspSyncStatus) elements.tspSyncStatus.textContent = response.message || 'Timesheet Portal is not configured for this environment.';
      showToast(response.message || 'Timesheet Portal is not configured for this environment.', 'warn', 4200);
      return response;
    }
    if (!response?.ok) {
      const attempts = Array.isArray(response?.attempts) ? response.attempts : [];
      const attemptText = attempts.length
        ? ` Latest checks: ${attempts.slice(0, 4).map((attempt) => `${attempt.path} → ${attempt.status}${attempt.authScheme ? ` (${attempt.authScheme})` : ''}`).join(' · ')}`
        : '';
      throw new Error((response?.message || 'Timesheet Portal candidate sync failed.') + attemptText);
    }
    if (elements.tspSyncStatus) {
      elements.tspSyncStatus.textContent = response.message
        || `Synced ${response.upserted || 0} candidate record${Number(response.upserted || 0) === 1 ? '' : 's'} from Timesheet Portal.`;
    }
    pushLog({
      action: provisionPortalAccounts ? 'tsp:candidates:sync+invite' : 'tsp:candidates:sync',
      detail: `${response.upserted || 0} upserted`,
    });
    await loadCandidates({ silent: true });
    await refreshTimesheetPortalCompare();
    await refreshVerificationQueue({ silent: true });
    if (state.drawerId) {
      const refreshed = await fetchCandidate(state.drawerId).catch(() => null);
      if (refreshed) renderDrawer(refreshed);
    }
    showToast(response.message || 'Timesheet Portal candidate sync complete.', 'info', 4200);
    return response;
  }

  function renderVerificationQueue() {
    const statusHost = elements.verifyStatus;
    const summaryHost = elements.verifySummary;
    if (!statusHost || !summaryHost) return;
    const queue = state.verificationQueue;
    if (!queue) {
      statusHost.textContent = 'Loading candidate document verification queue…';
      summaryHost.innerHTML = '';
      return;
    }
    if (queue.ok === false) {
      statusHost.textContent = queue.message || 'Could not load the verification queue.';
      summaryHost.innerHTML = '';
      return;
    }
    const candidates = Array.isArray(queue.candidates) ? queue.candidates : [];
    statusHost.textContent = candidates.length
      ? `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} currently have documents waiting for HMJ verification.`
      : 'No uploaded candidate documents currently need HMJ verification.';
    summaryHost.innerHTML = candidates.length
      ? candidates.slice(0, 12).map((entry) => `
          <div class="mapping-item">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div>
                <strong>${escapeHtml(entry.name || entry.email || 'Candidate')}</strong>
                <p>${escapeHtml([
                  entry.ref || entry.payroll_ref || null,
                  entry.email || null,
                  `${entry.count || (entry.documents || []).length} document${Number(entry.count || (entry.documents || []).length) === 1 ? '' : 's'} to verify`,
                ].filter(Boolean).join(' · '))}</p>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn ghost small" type="button" data-open-candidate="${escapeHtml(entry.candidate_id)}">Open</button>
                <button class="btn ghost small" type="button" data-select-candidate="${escapeHtml(entry.candidate_id)}">Select</button>
              </div>
            </div>
            <div class="tag-row">${(entry.documents || []).slice(0, 6).map((doc) => `<span class="chip orange">${escapeHtml(documentTypeLabel(doc.document_type || doc.label || 'document'))}</span>`).join(' ')}</div>
          </div>
        `).join('')
      : '';
    summaryHost.querySelectorAll('[data-open-candidate]').forEach((button) => {
      button.addEventListener('click', () => openDrawer(button.dataset.openCandidate));
    });
    summaryHost.querySelectorAll('[data-select-candidate]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.selectCandidate;
        if (!id) return;
        state.selection.add(String(id));
        persistSelection();
        updateBulkBar();
        syncHeaderCheckbox();
        refreshRows(true);
        showToast('Candidate added to the current selection.', 'info', 2200);
      });
    });
  }

  async function refreshVerificationQueue({ silent = false } = {}) {
    if (!silent && elements.verifyStatus) {
      elements.verifyStatus.textContent = 'Loading candidate document verification queue…';
    }
    try {
      const response = await state.helpers.api('admin-candidate-doc-verification-queue', 'POST', {});
      state.verificationQueue = response || { ok: true, count: 0, candidates: [] };
      renderVerificationQueue();
    } catch (err) {
      console.error('[candidates] verification queue failed', err);
      state.verificationQueue = {
        ok: false,
        message: err.message || 'Could not load the verification queue.',
      };
      renderVerificationQueue();
      if (!silent) showToast(err.message || 'Could not load the verification queue.', 'error', 4200);
    }
  }

  function selectPendingVerificationCandidates() {
    const ids = (state.verificationQueue?.candidates || []).map((entry) => String(entry.candidate_id || '')).filter(Boolean);
    if (!ids.length) {
      showToast('No candidates are currently waiting for document verification.', 'warn', 3200);
      return;
    }
    setSelection(ids);
    showToast(`Selected ${ids.length} candidate${ids.length === 1 ? '' : 's'} waiting for document verification.`, 'info', 2800);
  }

  async function previewCandidateImport() {
    if (!state.importFile) {
      showToast('Choose an import file first.', 'warn', 2800);
      return;
    }
    if (!state.importFileData) {
      state.importFileData = await readFileAsBase64(state.importFile);
    }
    elements.importPreview.disabled = true;
    try {
      const response = await state.helpers.api('admin-candidates-import', 'POST', {
        action: 'preview',
        fileName: state.importFile.name,
        fileData: state.importFileData,
      });
      state.importPreview = response?.preview || null;
      renderImportState();
      showToast('Import mapping preview ready.', 'info', 2200);
    } catch (err) {
      console.error('[candidates] import preview failed', err);
      state.importPreview = null;
      renderImportState();
      showToast(err.message || 'Candidate import preview failed.', 'error', 4200);
    } finally {
      elements.importPreview.disabled = false;
      updateImportButtons();
    }
  }

  async function confirmCandidateImport() {
    if (!state.importFile || !state.importPreview) {
      showToast('Preview the import before confirming it.', 'warn', 2800);
      return;
    }
    const validRows = Number(state.importPreview.validRows || 0);
    if (!validRows) {
      showToast('No valid rows were available to import.', 'warn', 3200);
      return;
    }
    const confirmed = window.confirm(`Import ${validRows} valid candidate row${validRows === 1 ? '' : 's'} into HMJ?`);
    if (!confirmed) return;
    elements.importConfirm.disabled = true;
    try {
      const response = await state.helpers.api('admin-candidates-import', 'POST', {
        action: 'import',
        fileName: state.importFile.name,
        fileData: state.importFileData,
      });
      showToast(response?.message || 'Candidate import complete.', response?.failed ? 'warn' : 'info', 4200);
      await loadCandidates({ silent: true });
      await refreshTimesheetPortalCompare();
      state.importPreview = null;
      state.importFile = null;
      state.importFileData = '';
      if (elements.importFile) elements.importFile.value = '';
      renderImportState();
    } catch (err) {
      console.error('[candidates] import failed', err);
      showToast(err.message || 'Candidate import failed.', 'error', 4200);
    } finally {
      elements.importConfirm.disabled = false;
      updateImportButtons();
    }
  }

  function exportCsv({ mode } = { mode: 'filtered' }) {
    const rows = mode === 'selected' ? selectedCandidates() : state.filtered;
    if (!rows.length) {
      showToast(mode === 'selected' ? 'Selected export only includes website candidates.' : 'Nothing to export', 'warn');
      return;
    }
    const headers = ['id', 'ref', 'name', 'email', 'phone', 'status', 'role', 'region', 'skills'];
    const csv = [headers.join(',')].concat(
      rows.map((row) => headers
        .map((field) => {
          const value = field === 'name' ? row.name : field === 'skills' ? (row.skills || []).join('|') : row[field] ?? '';
          const text = String(value).replace(/"/g, '""');
          return `"${text}"`;
        })
        .join(','))
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `candidates-${mode}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function generatePdf(candidate) {
    const lines = [
      'Candidate summary',
      '',
      `Name: ${candidate.name || ''}`,
      `Email: ${candidate.email || ''}`,
      `Phone: ${candidate.phone || ''}`,
      `Status: ${statusLabel(candidate.status)}`,
      `Role: ${candidate.role || ''}`,
      `Region: ${candidate.region || ''}`,
      `Skills: ${(candidate.skills || []).join(', ')}`,
      `Updated: ${formatDateTime(candidate.updated_at)}`
    ];
    let pdf = '%PDF-1.4\n';
    const objects = [];
    objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
    objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
    objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj');
    objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Name /F1 >> endobj');
    let stream = 'BT /F1 12 Tf 0 0 0 rg 50 780 Td 16 TL';
    lines.forEach((line, idx) => {
      const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      stream += ` (${safe}) Tj`;
      if (idx !== lines.length - 1) stream += ' T*';
    });
    stream += ' ET';
    const content = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects.push(`5 0 obj ${content} endobj`);
    const offsets = [0];
    objects.forEach((obj) => {
      offsets.push(pdf.length);
      pdf += `${obj}\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefStart}\n%%EOF`;
    const blob = new Blob([pdf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${candidate.ref || candidate.id}-summary.pdf`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === '/') {
        event.preventDefault();
        elements.search.focus();
        return;
      }
      if (key === 'escape' && state.drawerId) {
        closeDrawer();
        return;
      }
      if (key === 'e' && state.drawerId) {
        event.preventDefault();
        const first = elements.dwProfile.querySelector('[data-field]');
        if (first) first.focus();
        return;
      }
      if (key === 'b' && state.drawerId) {
        event.preventDefault();
        const candidate = findCandidate(state.drawerId);
        if (candidate) toggleBlock(candidate);
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        loadCandidates({ silent: true });
      }
    });
  }

  function createNewCandidate() {
    const id = `new-${Date.now()}`;
    const candidate = normalizeCandidate({ id, first_name: 'New', last_name: 'Candidate', status: 'active' });
    state.raw.unshift(candidate);
    applyFilters();
    openDrawer(id);
  }

  function initElements() {
    elements.rows = qs('#rows');
    elements.table = qs('#candidate-table');
    elements.thead = qs('#candidate-thead');
    elements.chkAll = qs('#chk-all', elements.thead || document);
    elements.search = qs('#search');
    elements.refresh = qs('#btn-refresh');
    elements.selectVisible = qs('#btn-select-visible');
    elements.bulkbar = qs('#bulkbar');
    elements.bulkCount = qs('#bulk-count');
    elements.bulkCopyEmails = qs('#bulk-copy-emails');
    elements.bulkSendEmail = qs('#bulk-send-email');
    elements.bulkAssign = qs('#bulk-assign');
    elements.bulkIntroEmail = qs('#bulk-intro-email');
    elements.bulkStatus = qs('#bulk-status');
    elements.bulkBlock = qs('#bulk-block');
    elements.bulkArchive = qs('#bulk-archive');
    elements.bulkDocRequest = qs('#bulk-doc-request');
    elements.bulkReminder = qs('#bulk-rtw-reminder');
    elements.bulkExport = qs('#bulk-export');
    elements.bulkClear = qs('#bulk-clear');
    elements.total = qs('#t-total');
    elements.tSeekers = qs('#t-seekers');
    elements.tStarters = qs('#t-starters');
    elements.tInvited = qs('#t-invited');
    elements.progress = qs('#t-progress');
    elements.archived = qs('#t-archived');
    elements.blocked = qs('#t-blocked');
    elements.ready = qs('#t-ready');
    elements.rtwMissing = qs('#t-rtw-missing');
    elements.toVerify = qs('#t-to-verify');
    elements.onboardingModule = qs('#onboarding-module');
    elements.onboardingModuleSummary = qs('#onboarding-module-summary');
    elements.onboardingStatusStrip = qs('#onboarding-status-strip');
    elements.onboardingBulkIntro = qs('#onboarding-bulk-intro');
    elements.onboardingBulkReminder = qs('#onboarding-bulk-reminder');
    elements.onboardingBulkDocs = qs('#onboarding-bulk-docs');
    elements.onboardingBulkVerified = qs('#onboarding-bulk-verified');
    elements.drawer = qs('#drawer');
    elements.dwName = qs('#dw-name');
    elements.dwTypeBadge = qs('#dw-type-badge');
    elements.dwRef = qs('#dw-ref');
    elements.dwProfile = qs('#dw-profile');
    elements.dwOnboarding = qs('#dw-onboarding');
    elements.dwPayment = qs('#dw-payment');
    elements.dwAssignments = qs('#dw-assignments');
    elements.dwDocs = qs('#dw-docs');
    elements.dwNotes = qs('#dw-notes');
    elements.dwAudit = qs('#dw-audit');
    elements.dwEmail = qs('#dw-email');
    elements.dwCall = qs('#dw-call');
    elements.dwArchive = qs('#dw-archive');
    elements.dwBlock = qs('#dw-block');
    elements.dwClose = qs('#dw-close');
    elements.fab = qs('#fab-new');
    elements.inlineNew = qs('#btn-new-inline');
    elements.query = qs('#q');
    elements.candidateType = qs('#flt-type');
    elements.status = qs('#flt-status');
    elements.role = qs('#flt-role');
    elements.region = qs('#flt-region');
    elements.skills = qs('#flt-skills');
    elements.availability = qs('#flt-avail');
    elements.createdFrom = qs('#flt-created-from');
    elements.createdTo = qs('#flt-created-to');
    elements.filterCount = qs('#flt-count');
    elements.applyFilters = qs('#btn-apply');
    elements.clearFilters = qs('#btn-clear');
    elements.selectMissingRtw = qs('#btn-select-missing-rtw');
    elements.activeFilterChips = qs('#active-filter-chips');
    elements.sourceTabs = Array.from(document.querySelectorAll('[data-source-tab]'));
    elements.importFile = qs('#candidate-import-file');
    elements.importFileButton = qs('#btn-import-file');
    elements.importPreview = qs('#btn-import-preview');
    elements.importConfirm = qs('#btn-import-confirm');
    elements.importStatus = qs('#import-status');
    elements.importSummary = qs('#import-summary');
    elements.importMapping = qs('#import-mapping');
    elements.refreshTsp = qs('#btn-refresh-tsp');
    elements.syncTsp = qs('#btn-sync-tsp');
    elements.syncTspPortal = qs('#btn-sync-tsp-portal');
    elements.visibleDocRequest = qs('#btn-visible-doc-request');
    elements.tspStatus = qs('#tsp-status');
    elements.tspSyncStatus = qs('#tsp-sync-status');
    elements.outreachStatus = qs('#outreach-status');
    elements.tspSummary = qs('#tsp-summary');
    elements.refreshVerify = qs('#btn-refresh-verify');
    elements.selectToVerify = qs('#btn-select-to-verify');
    elements.verifyStatus = qs('#verify-status');
    elements.verifySummary = qs('#verify-summary');
    elements.docRequestDialog = qs('#doc-request-dialog');
    elements.docRequestOptions = qs('#doc-request-options');
    elements.docRequestCancel = qs('#doc-request-cancel');
    elements.docRequestCopyLink = qs('#doc-request-copy-link');
    elements.docRequestSend = qs('#doc-request-send');
    elements.bulkEmailDialog = qs('#bulk-email-dialog');
    elements.bulkEmailAudience = qs('#bulk-email-audience');
    elements.bulkEmailPreset = qs('#bulk-email-preset');
    elements.bulkEmailSubject = qs('#bulk-email-subject');
    elements.bulkEmailHeading = qs('#bulk-email-heading');
    elements.bulkEmailBody = qs('#bulk-email-body');
    elements.bulkEmailFallbackClient = qs('#bulk-email-fallback-client');
    elements.bulkEmailFallbackJob = qs('#bulk-email-fallback-job');
    elements.bulkEmailPrimaryAction = qs('#bulk-email-primary-action');
    elements.bulkEmailIncludeTimesheets = qs('#bulk-email-include-timesheets');
    elements.bulkEmailSummary = qs('#bulk-email-summary');
    elements.bulkEmailPreviewSubject = qs('#bulk-email-preview-subject');
    elements.bulkEmailPreviewRecipient = qs('#bulk-email-preview-recipient');
    elements.bulkEmailPreviewShell = qs('#bulk-email-preview-shell');
    elements.bulkEmailCancel = qs('#bulk-email-cancel');
    elements.bulkEmailSend = qs('#bulk-email-send');
    elements.bulkEmailTokens = Array.from(document.querySelectorAll('[data-merge-token]'));
  }

  function bindEvents() {
    elements.rows.addEventListener('scroll', handleScroll);
    elements.rows.addEventListener('click', handleRowClick);
    if (elements.thead) {
      elements.thead.addEventListener('change', (event) => {
        if (event.target && event.target.id === 'chk-all') handleSelectAll(event);
      });
    }
    elements.search.addEventListener('input', (ev) => updateQuickSearch(ev.target.value));
    elements.refresh.addEventListener('click', async () => {
      await loadCandidates({ silent: false });
      await refreshActiveAssignments();
      if (state.sourceTab !== 'website' || state.tspCompare) {
        await refreshTimesheetPortalCompare();
      }
    });
    if (Array.isArray(elements.sourceTabs)) {
      elements.sourceTabs.forEach((button) => {
        button.addEventListener('click', () => setSourceTab(button.dataset.sourceTab));
      });
    }
    if (elements.selectMissingRtw) {
      elements.selectMissingRtw.addEventListener('click', () => selectMissingRtw());
    }
    if (elements.importFileButton && elements.importFile) {
      elements.importFileButton.addEventListener('click', () => elements.importFile.click());
      elements.importFile.addEventListener('change', async () => {
        const [file] = Array.from(elements.importFile.files || []);
        state.importFile = file || null;
        state.importFileData = '';
        state.importPreview = null;
        renderImportState();
      });
    }
    if (elements.importPreview) {
      elements.importPreview.addEventListener('click', () => previewCandidateImport());
    }
    if (elements.importConfirm) {
      elements.importConfirm.addEventListener('click', () => confirmCandidateImport());
    }
    if (elements.refreshTsp) {
      elements.refreshTsp.addEventListener('click', () => refreshTimesheetPortalCompare());
    }
    if (elements.syncTsp) {
      elements.syncTsp.addEventListener('click', async () => {
        elements.syncTsp.disabled = true;
        try {
          await runTimesheetPortalCandidateSync();
        } catch (err) {
          console.error('[candidates] TSP candidate sync failed', err);
          if (elements.tspSyncStatus) elements.tspSyncStatus.textContent = err.message || 'Timesheet Portal candidate sync failed.';
          showToast(err.message || 'Timesheet Portal candidate sync failed.', 'error', 4200);
        } finally {
          elements.syncTsp.disabled = false;
        }
      });
    }
    if (elements.syncTspPortal) {
      elements.syncTspPortal.addEventListener('click', async () => {
        elements.syncTspPortal.disabled = true;
        try {
          await runTimesheetPortalCandidateSync({ provisionPortalAccounts: true });
        } catch (err) {
          console.error('[candidates] TSP candidate sync+invite failed', err);
          if (elements.tspSyncStatus) elements.tspSyncStatus.textContent = err.message || 'Timesheet Portal sync + invite failed.';
          showToast(err.message || 'Timesheet Portal sync + invite failed.', 'error', 4200);
        } finally {
          elements.syncTspPortal.disabled = false;
        }
      });
    }
    if (elements.visibleDocRequest) {
      elements.visibleDocRequest.addEventListener('click', () => {
        const visibleIds = state.filtered
          .filter((candidate) => isSelectableCandidate(candidate, currentSelectionOptions()))
          .map((candidate) => candidate.id);
        if (!visibleIds.length) {
          showToast('No visible candidates are available for a document request.', 'warn', 3200);
          return;
        }
        openDocumentRequestDialog(visibleIds);
      });
    }
    if (elements.selectVisible) {
      elements.selectVisible.addEventListener('click', () => selectVisibleCandidates());
    }
    if (elements.onboardingBulkIntro) {
      elements.onboardingBulkIntro.addEventListener('click', () => {
        void runOnboardingModuleAction('intro').catch((err) => {
          console.error('[candidates] onboarding intro send failed', err);
          showToast(err.message || 'Could not send onboarding intro emails.', 'error', 4200);
        });
      });
    }
    if (elements.onboardingBulkReminder) {
      elements.onboardingBulkReminder.addEventListener('click', () => {
        void runOnboardingModuleAction('general').catch((err) => {
          console.error('[candidates] onboarding reminder send failed', err);
          showToast(err.message || 'Could not send onboarding reminders.', 'error', 4200);
        });
      });
    }
    if (elements.onboardingBulkDocs) {
      elements.onboardingBulkDocs.addEventListener('click', () => {
        void runOnboardingModuleAction('documents').catch((err) => {
          console.error('[candidates] onboarding document request failed', err);
          showToast(err.message || 'Could not request onboarding documents.', 'error', 4200);
        });
      });
    }
    if (elements.onboardingBulkVerified) {
      elements.onboardingBulkVerified.addEventListener('click', () => {
        void runOnboardingModuleAction('verification_complete').catch((err) => {
          console.error('[candidates] onboarding verification complete send failed', err);
          showToast(err.message || 'Could not send verification complete emails.', 'error', 4200);
        });
      });
    }
    if (elements.refreshVerify) {
      elements.refreshVerify.addEventListener('click', () => refreshVerificationQueue());
    }
    if (elements.selectToVerify) {
      elements.selectToVerify.addEventListener('click', () => selectPendingVerificationCandidates());
    }
    if (elements.docRequestCancel) {
      elements.docRequestCancel.addEventListener('click', () => closeDocumentRequestDialog());
    }
    if (elements.docRequestCopyLink) {
      elements.docRequestCopyLink.addEventListener('click', async () => {
        const requested = selectedDocumentRequestTypes();
        await copyCandidateUploadLink({
          requestType: requested.includes('right_to_work') && requested.length === 1 ? 'rtw' : 'documents',
          documentTypes: requested,
        });
      });
    }
    if (elements.docRequestDialog) {
      elements.docRequestDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDocumentRequestDialog();
      });
      elements.docRequestDialog.addEventListener('close', () => {
        if (!elements.docRequestDialog.open) state.pendingDocRequest = null;
      });
    }
    if (elements.docRequestSend) {
      elements.docRequestSend.addEventListener('click', async () => {
        const pending = state.pendingDocRequest;
        if (!pending?.candidateIds?.length) {
          closeDocumentRequestDialog();
          return;
        }
        const requested = selectedDocumentRequestTypes();
        if (!requested.length) {
          showToast('Select at least one requested document type.', 'warn', 3200);
          return;
        }
        elements.docRequestSend.disabled = true;
        try {
          await sendOnboardingRequest({
            candidateIds: pending.candidateIds,
            requestType: 'documents',
            documentTypes: requested,
            skipConfirm: true,
          });
          closeDocumentRequestDialog();
        } catch (err) {
          console.error('[candidates] document request send failed', err);
          showToast(err.message || 'Document request send failed.', 'error', 4200);
          elements.docRequestSend.disabled = false;
        } finally {
          if (elements.docRequestSend && !elements.docRequestDialog?.open) {
            elements.docRequestSend.disabled = false;
          }
        }
      });
    }
    if (elements.bulkEmailPreset) {
      elements.bulkEmailPreset.addEventListener('change', () => applyBulkEmailPreset(elements.bulkEmailPreset.value));
    }
    [elements.bulkEmailSubject, elements.bulkEmailHeading, elements.bulkEmailBody, elements.bulkEmailFallbackClient, elements.bulkEmailFallbackJob, elements.bulkEmailPrimaryAction, elements.bulkEmailIncludeTimesheets]
      .filter(Boolean)
      .forEach((field) => {
        const eventName = field instanceof HTMLInputElement && field.type === 'checkbox' ? 'change' : 'input';
        field.addEventListener(eventName, () => renderBulkEmailPreview());
        if (eventName !== 'change') field.addEventListener('change', () => renderBulkEmailPreview());
      });
    if (Array.isArray(elements.bulkEmailTokens)) {
      elements.bulkEmailTokens.forEach((button) => {
        button.addEventListener('click', () => insertBulkEmailToken(button.dataset.mergeToken || ''));
      });
    }
    if (elements.bulkEmailCancel) {
      elements.bulkEmailCancel.addEventListener('click', () => closeBulkEmailDialog());
    }
    if (elements.bulkEmailDialog) {
      elements.bulkEmailDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeBulkEmailDialog();
      });
      elements.bulkEmailDialog.addEventListener('close', () => {
        if (!elements.bulkEmailDialog.open) state.pendingBulkEmail = null;
      });
    }
    if (elements.bulkEmailSend) {
      elements.bulkEmailSend.addEventListener('click', async () => {
        try {
          await sendBulkEmailWizard();
        } catch (error) {
          console.error('[candidates] bulk email send failed', error);
          showToast(error?.message || 'Bulk email send failed.', 'error', 4200);
          if (elements.bulkEmailSend) {
            elements.bulkEmailSend.disabled = false;
            elements.bulkEmailSend.textContent = 'Send HMJ email';
          }
          if (elements.bulkEmailCancel) elements.bulkEmailCancel.disabled = false;
        }
      });
    }
    elements.dwClose.addEventListener('click', () => closeDrawer());
    if (elements.fab) elements.fab.addEventListener('click', () => createNewCandidate());
    if (elements.inlineNew) elements.inlineNew.addEventListener('click', () => createNewCandidate());
    elements.applyFilters.addEventListener('click', () => { captureFilters(); applyFilters(); loadCandidates({ silent: true }); });
    elements.clearFilters.addEventListener('click', () => { clearFilters(); loadCandidates({ silent: true }); });
    bindBulkActions();
  }

  function init(helpers) {
    state.helpers = helpers;
    const launch = readLaunchParams();
    if (launch.query) {
      state.filters.query = launch.query;
      saveFilters(state.filters);
    }
    initElements();
    ensureDebugPanel();
    detectVersion();
    applyFilterInputs();
    renderActiveFilterChips();
    renderImportState();
    renderTspSummary();
    renderOutreachStatus();
    renderVerificationQueue();
    bindEvents();
    bindKeyboardShortcuts();
    loadCandidates().then(async () => {
      if (launch.candidateId) {
        openDrawer(launch.candidateId);
      }
      await refreshVerificationQueue({ silent: true });
      await refreshActiveAssignments();
    });
    refreshTimesheetPortalCompare();
    refreshOutreachReadiness();
  }

  function ready() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      console.error('[candidates] Admin bootstrap missing');
      return;
    }
    window.Admin.bootAdmin(async (helpers) => {
      const who = await helpers.identity('admin');
      state.identity = who;
      updateIdentityBadges(who);
      init(helpers);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
