import {
  backgroundSyncCandidatePayload,
  getCandidatePortalContext,
  loadCandidateApplications,
  loadCandidateDocuments,
  loadCandidateProfile,
  trimText,
} from '../../js/hmj-candidate-portal.js?v=2';

(function () {
  const form = document.getElementById('applyForm');
  const notice = document.getElementById('candidateApplyNotice');
  const quickApplyCard = document.getElementById('candidateQuickApplyCard');
  const quickApplyGrid = document.getElementById('candidateQuickApplyGrid');
  const quickApplyPill = document.getElementById('candidateQuickApplyPill');
  const quickApplyStatus = document.getElementById('candidateQuickApplyStatus');
  const quickApplyButton = document.getElementById('candidateQuickApplyButton');
  const quickApplyToggleForm = document.getElementById('candidateQuickApplyToggleForm');
  const fullApplicationCard = document.getElementById('fullApplicationCard');
  const quickApplyCore = window.HMJContactQuickApply;
  const applicationDocumentsEndpoint = '/.netlify/functions/contact-application-documents';
  const submitButton = form?.querySelector('button[type="submit"]');
  const defaultSubmitButtonLabel = trimText(submitButton?.textContent, 120) || 'Submit Application';

  if (!form) return;

  const state = {
    backgroundSyncSent: false,
    formSubmitBusy: false,
    quickApplyBusy: false,
    quickApplyReady: false,
    snapshot: null,
  };

  const fieldMap = {
    first_name: 'firstName',
    surname: 'surname',
    current_location: 'location',
    email: 'email',
    phone: 'phone',
    salary_expectation: 'salary',
    notice_period: 'notice',
    right_to_work: 'workAuth',
    relocation: 'relocate',
    linkedin: 'linkedin',
    message: 'message',
  };

  function setFieldValue(id, value, options = {}) {
    const field = document.getElementById(id);
    if (!field) return;
    const nextValue = value == null ? '' : String(value);
    if (!options.overwrite && field.value) return;
    field.value = nextValue;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getFieldValue(name) {
    return trimText(form.elements?.[name]?.value, 500);
  }

  function ensureHiddenField(name, value) {
    if (!name) return;
    let input = form.querySelector(`input[type="hidden"][name="${name.replace(/"/g, '\\"')}"]`);
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value == null ? '' : String(value);
  }

  function getJobContextFromForm() {
    return {
      title: getFieldValue('job_title') || getFieldValue('role'),
      role: getFieldValue('role'),
      jobId: getFieldValue('job_id'),
      reference: getFieldValue('job_reference'),
      locationText: getFieldValue('job_location'),
      employmentType: getFieldValue('job_type'),
      payText: getFieldValue('job_pay'),
      shareCode: getFieldValue('job_share_code'),
      source: getFieldValue('job_source'),
      specUrl: getFieldValue('job_spec_url'),
    };
  }

  function setSubmitBusy(busy) {
    if (!submitButton) return;
    submitButton.disabled = !!busy;
    submitButton.textContent = busy ? 'Submitting…' : defaultSubmitButtonLabel;
  }

  function inferApplicationDocumentType(fieldName, fileName = '') {
    const raw = `${trimText(fieldName, 120) || ''} ${trimText(fileName, 280) || ''}`.toLowerCase();
    if (!raw) return 'cv';
    if (/\b(cv|resume)\b/.test(raw)) return 'cv';
    if (/cover[\s_-]?letter/.test(raw)) return 'cover_letter';
    if (/\bpassport\b/.test(raw)) return 'passport';
    if (/right[\s_-]?to[\s_-]?work|share[\s_-]?code/.test(raw)) return 'right_to_work';
    if (/\b(reference|references|referee)\b/.test(raw)) return 'reference';
    if (/\b(visa|permit|brp|residence)\b/.test(raw)) return 'visa_permit';
    if (/\b(cert|certificate|certification|qualification|ticket|card)\b/.test(raw)) return 'qualification_certificate';
    if (/\b(bank|void cheque|void check)\b/.test(raw)) return 'bank_document';
    return 'other';
  }

  function inferApplicationDocumentLabel(fieldName, fileName = '') {
    const type = inferApplicationDocumentType(fieldName, fileName);
    if (type === 'cv') return 'CV';
    if (type === 'cover_letter') return 'Cover letter';
    return trimText(fileName, 240) || 'Supporting document';
  }

  function listApplicationDocumentsFromForm() {
    const fileInputs = Array.from(form.querySelectorAll('input[type="file"][name]'));
    const documents = [];
    fileInputs.forEach((input) => {
      const fieldName = trimText(input.name, 120);
      const files = Array.from(input.files || []);
      files.forEach((file) => {
        if (!(file instanceof File) || !file.name || !file.size) return;
        documents.push({
          fieldName,
          file,
          documentType: inferApplicationDocumentType(fieldName, file.name),
          label: inferApplicationDocumentLabel(fieldName, file.name),
        });
      });
    });
    return documents;
  }

  async function applicationDocumentsRequest(payload) {
    const response = await fetch(applicationDocumentsEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      credentials: 'same-origin',
      keepalive: true,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.message || data?.error || 'Application document sync failed.');
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  }

  async function reportPublicApplicationDocumentFailure(context, documentRow, error) {
    if (!context?.candidateId || !context?.submissionId || !documentRow?.file) return;
    try {
      await applicationDocumentsRequest({
        action: 'report_failure',
        candidate_id: context.candidateId,
        application_id: context.applicationId || null,
        submission_id: context.submissionId,
        file_name: trimText(documentRow.file.name, 280) || 'Document',
        mime_type: trimText(documentRow.file.type, 120) || null,
        size_bytes: Number(documentRow.file.size || 0) || 0,
        field_name: documentRow.fieldName,
        document_type: documentRow.documentType,
        label: documentRow.label,
        error_message: trimText(error?.message, 500) || 'Public application document ingestion failed.',
      });
    } catch (reportError) {
      console.warn('[contact.portal] application document failure reporting failed', reportError?.message || reportError);
    }
  }

  async function persistPublicApplicationDocuments(context, documents) {
    if (!context?.candidateId || !context?.submissionId || !Array.isArray(documents) || !documents.length) {
      return [];
    }

    let client = null;
    try {
      ({ client } = await getCandidatePortalContext());
    } catch (error) {
      for (const documentRow of documents) {
        await reportPublicApplicationDocumentFailure(context, documentRow, error);
      }
      throw error;
    }

    if (!client?.storage?.from) {
      const error = new Error('The candidate document client is unavailable.');
      for (const documentRow of documents) {
        await reportPublicApplicationDocumentFailure(context, documentRow, error);
      }
      throw error;
    }

    const uploaded = [];
    for (const documentRow of documents) {
      try {
        const prepared = await applicationDocumentsRequest({
          action: 'prepare_upload',
          candidate_id: context.candidateId,
          application_id: context.applicationId || null,
          submission_id: context.submissionId,
          file_name: trimText(documentRow.file?.name, 280) || 'document',
          mime_type: trimText(documentRow.file?.type, 120) || null,
          size_bytes: Number(documentRow.file?.size || 0) || 0,
          field_name: documentRow.fieldName,
          document_type: documentRow.documentType,
          label: documentRow.label,
        });

        const uploadTarget = prepared?.upload || {};
        const uploadBucket = trimText(uploadTarget.bucket, 120) || 'candidate-docs';
        const uploadPath = trimText(uploadTarget.path, 500) || '';
        const uploadToken = trimText(uploadTarget.token, 2000) || '';
        if (!uploadPath || !uploadToken) {
          throw new Error('A secure upload path could not be prepared for this document.');
        }

        const upload = await client
          .storage
          .from(uploadBucket)
          .uploadToSignedUrl(uploadPath, uploadToken, documentRow.file, {
            cacheControl: '3600',
            contentType: trimText(documentRow.file?.type, 120) || undefined,
          });

        if (upload.error) {
          throw upload.error;
        }

        const finalized = await applicationDocumentsRequest({
          action: 'finalize_upload',
          candidate_id: context.candidateId,
          application_id: context.applicationId || null,
          submission_id: context.submissionId,
          storage_path: uploadPath,
          file_name: trimText(documentRow.file?.name, 280) || 'document',
          mime_type: trimText(documentRow.file?.type, 120) || null,
          size_bytes: Number(documentRow.file?.size || 0) || 0,
          field_name: documentRow.fieldName,
          document_type: documentRow.documentType,
          label: documentRow.label,
        });

        uploaded.push(finalized?.document || null);
      } catch (error) {
        console.warn('[contact.portal] public application document persistence failed', error?.message || error);
        await reportPublicApplicationDocumentFailure(context, documentRow, error);
      }
    }

    return uploaded.filter(Boolean);
  }

  async function syncFullApplicationSubmission() {
    const payload = serialiseForm();
    const documents = listApplicationDocumentsFromForm();
    const submissionId = quickApplySubmissionId();
    payload.submission_id = submissionId;
    if (payload.candidate) {
      payload.candidate.source_submission_id = submissionId;
    }
    if (payload.application) {
      payload.application.source_submission_id = submissionId;
    }

    let syncResult = null;
    try {
      syncResult = await backgroundSyncCandidatePayload(payload, { awaitResponse: true });
    } catch (error) {
      console.warn('[contact.portal] background application sync failed', error?.message || error);
      return { submissionId, syncResult: null };
    }

    if (syncResult?.candidateId) {
      ensureHiddenField('candidate_id', syncResult.candidateId);
    }
    if (syncResult?.applicationId) {
      ensureHiddenField('application_id', syncResult.applicationId);
    }
    ensureHiddenField('source_submission_id', submissionId);
    ensureHiddenField('candidate_apply_mode', 'full_form');

    if (documents.length && syncResult?.candidateId) {
      await persistPublicApplicationDocuments({
        candidateId: syncResult.candidateId,
        applicationId: syncResult.applicationId || null,
        submissionId,
      }, documents);
    }

    return { submissionId, syncResult };
  }

  function setQuickApplyStatus(message, tone = '') {
    if (!quickApplyStatus) return;
    quickApplyStatus.textContent = message || '';
    if (tone) {
      quickApplyStatus.dataset.tone = tone;
    } else {
      delete quickApplyStatus.dataset.tone;
    }
  }

  function showFullForm(show) {
    if (!fullApplicationCard) return;
    fullApplicationCard.hidden = !show;
    if (quickApplyToggleForm) {
      quickApplyToggleForm.textContent = show
        ? 'Hide full application form'
        : 'Use full application form instead';
    }
  }

  function prefillFullForm(snapshot, user, candidate) {
    if (!snapshot) return;
    Object.entries(snapshot.formValues || {}).forEach(([key, value]) => {
      const target = fieldMap[key];
      if (!target) return;
      setFieldValue(target, value);
    });
    setFieldValue('location', snapshot.location || candidate?.location || '');
    setFieldValue('email', snapshot.email || user?.email || '');
    setFieldValue('message', snapshot.summary || '');
  }

  function renderNotice(candidate, user, options = {}) {
    if (!notice) return;
    const name = trimText(candidate?.full_name || `${candidate?.first_name || ''} ${candidate?.last_name || ''}` || user?.email, 240);
    const body = options.quickApply
      ? 'Quick apply is available for this role. We will use your saved candidate record and still pass the application through the existing HMJ submission workflow.'
      : 'This application will still submit through the existing HMJ Netlify workflow. We’ll also add it to your candidate dashboard in parallel.';
    notice.hidden = false;
    notice.innerHTML = `
      <div class="candidate-apply-note__eyebrow">Candidate account linked</div>
      <h2>Signed in as ${trimText(name || user?.email || 'HMJ candidate', 240)}</h2>
      <p>${body}</p>
    `;
  }

  function formatAppliedDate(value) {
    const input = trimText(value, 80);
    if (!input) return '';
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return input;
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function renderQuickApply(snapshot) {
    if (!quickApplyCard || !quickApplyGrid || !quickApplyButton || !quickApplyCore) return;

    quickApplyGrid.innerHTML = `
      <div class="candidate-quick-apply__stat">
        <span class="candidate-quick-apply__label">Candidate record</span>
        <span class="candidate-quick-apply__value">
          ${trimText(snapshot.name, 240) || 'Candidate profile'}
          <small>${trimText(snapshot.email, 320) || 'Email pending'}${snapshot.phone ? ` • ${trimText(snapshot.phone, 80)}` : ''}</small>
        </span>
      </div>
      <div class="candidate-quick-apply__stat">
        <span class="candidate-quick-apply__label">Saved profile</span>
        <span class="candidate-quick-apply__value">
          ${trimText(snapshot.location, 240) || 'Location pending'}
          <small>${trimText(snapshot.availability, 160) || 'Availability not saved yet'}${snapshot.salaryExpectation ? ` • ${trimText(snapshot.salaryExpectation, 160)}` : ''}</small>
        </span>
      </div>
      <div class="candidate-quick-apply__stat">
        <span class="candidate-quick-apply__label">Stored documents</span>
        <span class="candidate-quick-apply__value">
          ${trimText(snapshot.documentSummary, 240) || 'No stored documents on record'}
          <small>${snapshot.documentLabels?.length ? snapshot.documentLabels.join(', ') : 'Review documents from your candidate account if needed.'}</small>
        </span>
      </div>
    `;

    if (quickApplyPill) {
      quickApplyPill.textContent = snapshot.hasStoredCv
        ? 'Saved CV on record'
        : 'No saved CV on record';
    }

    if (snapshot.existingApplication) {
      quickApplyButton.disabled = true;
      quickApplyButton.textContent = 'Application already submitted';
      setQuickApplyStatus(
        `You already applied for this role${snapshot.existingApplication?.applied_at ? ` on ${formatAppliedDate(snapshot.existingApplication.applied_at)}` : ''}. The saved HMJ application record is already linked to your candidate account.`,
        'warn'
      );
      showFullForm(false);
      quickApplyCard.hidden = false;
      return;
    }

    quickApplyButton.disabled = false;
    quickApplyButton.textContent = 'Quick apply now';
    setQuickApplyStatus(
      snapshot.hasStoredCv
        ? 'We will submit this role using your saved HMJ profile and the documents already linked to your candidate account.'
        : 'We can still submit this role from your saved HMJ profile. No CV is currently marked on file, so HMJ may review your saved profile first or ask for a fresh document.',
      snapshot.hasStoredCv ? '' : 'warn'
    );
    showFullForm(false);
    quickApplyCard.hidden = false;
  }

  function serialiseForm() {
    const formData = new FormData(form);
    return {
      source: 'contact_form',
      candidate: {
        first_name: formData.get('first_name'),
        surname: formData.get('surname'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        current_location: formData.get('current_location'),
        notice_period: formData.get('notice_period'),
        linkedin: formData.get('linkedin'),
        message: formData.get('message'),
      },
      application: {
        job_title: formData.get('job_title'),
        job_id: formData.get('job_id'),
        role: formData.get('role'),
        job_location: formData.get('job_location'),
        job_type: formData.get('job_type'),
        job_pay: formData.get('job_pay'),
        job_share_code: formData.get('job_share_code'),
        job_source: formData.get('job_source'),
        job_spec_url: formData.get('job_spec_url'),
        message: formData.get('message'),
      },
    };
  }

  function quickApplySubmissionId() {
    return window.crypto?.randomUUID?.() || `apply-${Date.now()}`;
  }

  function buildQuickApplySyncPayload(snapshot, context, submissionId) {
    const recruiterMessage = quickApplyCore.buildQuickApplyRecruiterMessage(snapshot);
    return {
      source: 'candidate_quick_apply',
      submission_id: submissionId,
      candidate: {
        first_name: snapshot.firstName,
        surname: snapshot.lastName,
        email: snapshot.email,
        phone: snapshot.phone,
        current_location: snapshot.location,
        notice_period: snapshot.availability,
        right_to_work_status: snapshot.rightToWorkStatus,
        relocation: snapshot.relocationPreference,
        linkedin: snapshot.linkedinUrl,
        salary_expectation: snapshot.salaryExpectation,
        message: recruiterMessage,
        source_submission_id: submissionId,
      },
      application: {
        job_title: context.title,
        job_id: context.jobId,
        role: context.role || context.title,
        job_location: context.locationText,
        job_type: context.employmentType,
        job_pay: context.payText,
        job_share_code: context.shareCode,
        job_source: 'candidate_quick_apply',
        job_spec_url: context.specUrl,
        message: recruiterMessage,
        source_submission_id: submissionId,
      },
    };
  }

  function buildQuickApplyFormFields(snapshot, context, submissionId) {
    const recruiterMessage = quickApplyCore.buildQuickApplyRecruiterMessage(snapshot);
    return {
      'form-name': 'contact',
      'bot-field': '',
      subject: getFieldValue('subject') || (context.title ? `Application: ${context.title}` : 'Application'),
      role: context.role || context.title,
      job_title: context.title,
      job_id: context.jobId,
      job_reference: context.reference,
      job_location: context.locationText,
      job_type: context.employmentType,
      job_pay: context.payText,
      job_share_code: context.shareCode,
      job_source: 'candidate_quick_apply',
      job_spec_url: context.specUrl,
      first_name: snapshot.firstName,
      surname: snapshot.lastName,
      current_location: snapshot.location,
      email: snapshot.email,
      phone: snapshot.phone,
      salary_expectation: snapshot.formValues.salary_expectation,
      notice_period: snapshot.formValues.notice_period || snapshot.availability,
      right_to_work: snapshot.formValues.right_to_work || snapshot.rightToWorkStatus,
      relocation: snapshot.formValues.relocation || snapshot.relocationPreference,
      linkedin: snapshot.linkedinUrl,
      message: recruiterMessage,
      source_submission_id: submissionId,
      candidate_id: snapshot.candidateId,
      candidate_auth_user_id: snapshot.authUserId,
      candidate_apply_mode: 'quick_apply',
      candidate_documents_summary: snapshot.documentSummary,
    };
  }

  function submitQuickApplyToNetlify(fields) {
    const action = trimText(form.getAttribute('action'), 500) || '/jobs.html?submitted=1';
    const submissionForm = document.createElement('form');
    submissionForm.method = 'POST';
    submissionForm.action = action;
    submissionForm.style.display = 'none';

    Object.entries(fields || {}).forEach(([name, value]) => {
      const text = value == null ? '' : String(value);
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = text;
      submissionForm.appendChild(input);
    });

    document.body.appendChild(submissionForm);
    submissionForm.submit();
  }

  async function handleQuickApply() {
    if (state.quickApplyBusy || !state.quickApplyReady || !state.snapshot || !quickApplyCore) return;

    const context = getJobContextFromForm();
    if (!context.jobId) {
      setQuickApplyStatus('Quick apply is only available when the role has a live HMJ job ID. Use the full application form below for this role.', 'warn');
      showFullForm(true);
      return;
    }

    state.quickApplyBusy = true;
    quickApplyButton.disabled = true;
    quickApplyButton.textContent = 'Submitting…';
    setQuickApplyStatus('Submitting your saved candidate profile for this role now…');

    try {
      const submissionId = quickApplySubmissionId();
      const payload = buildQuickApplySyncPayload(state.snapshot, context, submissionId);
      const syncResult = await backgroundSyncCandidatePayload(payload, { awaitResponse: true });

      if (syncResult?.applicationCreated === false && syncResult?.applicationId) {
        state.snapshot.existingApplication = {
          id: syncResult.applicationId,
          applied_at: new Date().toISOString(),
        };
        renderQuickApply(state.snapshot);
        setQuickApplyStatus('This role is already linked to your candidate application history, so we did not submit a duplicate application.', 'warn');
        return;
      }

      submitQuickApplyToNetlify(buildQuickApplyFormFields(state.snapshot, context, submissionId));
    } catch (error) {
      console.warn('[contact.portal] quick apply failed', error?.message || error);
      quickApplyButton.disabled = false;
      quickApplyButton.textContent = 'Quick apply now';
      setQuickApplyStatus(
        error?.message || 'We could not submit your saved profile just now. You can retry quick apply or use the full application form below.',
        'danger'
      );
      showFullForm(true);
    } finally {
      state.quickApplyBusy = false;
    }
  }

  async function initialiseCandidateEnhancements() {
    if (!quickApplyCore) return;

    try {
      const { user } = await getCandidatePortalContext();
      if (!user) {
        if (notice) notice.hidden = true;
        showFullForm(true);
        return;
      }

      const candidate = await loadCandidateProfile();
      const context = getJobContextFromForm();

      const [documentsResult, applicationsResult] = await Promise.allSettled([
        loadCandidateDocuments(candidate?.id),
        context.jobId ? loadCandidateApplications(candidate?.id) : Promise.resolve([]),
      ]);

      const documents = documentsResult.status === 'fulfilled' ? documentsResult.value : [];
      const applications = applicationsResult.status === 'fulfilled' ? applicationsResult.value : [];
      const snapshot = quickApplyCore.buildQuickApplySnapshot({
        candidate,
        user,
        documents,
        applications,
        context,
      });

      state.snapshot = snapshot;
      prefillFullForm(snapshot, user, candidate);
      renderNotice(candidate, user, { quickApply: Boolean(context.title && context.jobId) });

      if (context.title && context.jobId) {
        state.quickApplyReady = true;
        renderQuickApply(snapshot);
      } else {
        state.quickApplyReady = false;
        if (quickApplyCard) quickApplyCard.hidden = true;
        showFullForm(true);
      }
    } catch (error) {
      console.warn('[contact.portal] candidate enhancement init failed', error?.message || error);
      if (notice) notice.hidden = true;
      if (quickApplyCard) quickApplyCard.hidden = true;
      showFullForm(true);
    }
  }

  form.addEventListener('submit', async (event) => {
    if (!form.checkValidity() || state.backgroundSyncSent || state.formSubmitBusy) return;
    event.preventDefault();
    state.backgroundSyncSent = true;
    state.formSubmitBusy = true;
    setSubmitBusy(true);

    try {
      await syncFullApplicationSubmission();
    } catch (error) {
      console.warn('[contact.portal] full application submission sync failed', error?.message || error);
    } finally {
      HTMLFormElement.prototype.submit.call(form);
    }
  });

  if (quickApplyButton) {
    quickApplyButton.addEventListener('click', handleQuickApply);
  }

  if (quickApplyToggleForm) {
    quickApplyToggleForm.addEventListener('click', () => {
      const showing = !fullApplicationCard?.hidden;
      showFullForm(!showing);
      if (fullApplicationCard && !showing) {
        fullApplicationCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  initialiseCandidateEnhancements();
})();
