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

  if (!form) return;

  const state = {
    backgroundSyncSent: false,
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

  form.addEventListener('submit', () => {
    if (!form.checkValidity() || state.backgroundSyncSent) return;
    try {
      state.backgroundSyncSent = true;
      const payload = serialiseForm();
      const submissionId = quickApplySubmissionId();
      payload.submission_id = submissionId;
      if (payload.candidate) {
        payload.candidate.source_submission_id = submissionId;
      }
      if (payload.application) {
        payload.application.source_submission_id = submissionId;
      }
      void backgroundSyncCandidatePayload(payload);
    } catch (error) {
      // Never allow background portal sync errors to interrupt the Netlify form submit.
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
