import {
  backgroundSyncCandidatePayload,
  getCandidatePortalContext,
  loadCandidateProfile,
  trimText,
} from '../../js/hmj-candidate-portal.js?v=2';

(function () {
  const form = document.getElementById('applyForm');
  const notice = document.getElementById('candidateApplyNotice');
  let backgroundSyncSent = false;
  if (!form) return;

  const fieldMap = {
    first_name: 'firstName',
    last_name: 'surname',
    location: 'location',
    email: 'email',
    phone: 'phone',
    linkedin_url: 'linkedin',
    summary: 'message',
  };

  function setFieldValue(id, value) {
    const field = document.getElementById(id);
    if (!field || field.value) return;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function prefillCandidateProfile() {
    try {
      const { user } = await getCandidatePortalContext();
      if (!user) return;

      const candidate = await loadCandidateProfile();
      setFieldValue(fieldMap.first_name, candidate.first_name || '');
      setFieldValue(fieldMap.last_name, candidate.last_name || '');
      setFieldValue(fieldMap.location, candidate.location || '');
      setFieldValue(fieldMap.email, candidate.email || user.email || '');
      setFieldValue(fieldMap.phone, candidate.phone || '');
      setFieldValue(fieldMap.linkedin_url, candidate.linkedin_url || '');
      setFieldValue(fieldMap.summary, candidate.summary || '');

      if (notice) {
        notice.hidden = false;
        notice.innerHTML = `
          <div class="candidate-apply-note__eyebrow">Candidate account linked</div>
          <h2>Signed in as ${trimText(candidate.full_name || user.email, 240)}</h2>
          <p>This application will still submit through the existing HMJ Netlify workflow. We’ll also add it to your candidate dashboard in parallel.</p>
        `;
      }
    } catch (error) {
      if (notice) {
        notice.hidden = true;
      }
    }
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

  form.addEventListener('submit', () => {
    if (!form.checkValidity() || backgroundSyncSent) return;
    try {
      backgroundSyncSent = true;
      const payload = serialiseForm();
      const submissionId = window.crypto?.randomUUID?.() || `apply-${Date.now()}`;
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

  prefillCandidateProfile();
})();
