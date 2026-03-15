import {
  backgroundSyncCandidatePayload,
  candidateDocumentIsPortalOwned,
  closeCandidateAccount,
  deleteCandidateDocument,
  escapeHtml,
  getCandidatePortalContext,
  loadCandidateApplications,
  loadCandidateDocuments,
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
  uploadCandidateDocument,
} from '../../js/hmj-candidate-portal.js?v=2';

(function () {
  const doc = document;
  const authRoot = doc.getElementById('candidatePortalAuthRoot');
  const authSection = doc.getElementById('candidatePortalAuthSection');
  const applicationView = doc.getElementById('candidateApplicationView');
  const dashboardRoot = doc.getElementById('candidateDashboardRoot');
  const form = doc.getElementById('candForm');

  if (!authRoot || !applicationView || !dashboardRoot || !form) return;

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

  const params = readAuthParams();
  const state = {
    hydrating: true,
    authAvailable: true,
    authMode: params.get('candidate_action') === 'recovery' ? 'recovery' : 'signin',
    authMessage: authMessageFromParams(params),
    authBusy: false,
    dashboardBusy: false,
    settingsBusy: false,
    documentsBusy: false,
    activeTab: 'profile',
    user: null,
    session: null,
    candidate: null,
    applications: [],
    documents: [],
    dashboardError: '',
    unsubscribe: null,
    closeConfirm: false,
    formSyncSent: false,
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
      trimText(candidate?.location, 240),
      trimText(candidate?.sector_focus, 240),
      Array.isArray(candidate?.skills) && candidate.skills.length ? 'skills' : '',
      trimText(candidate?.availability, 160),
      trimText(candidate?.linkedin_url, 500),
      trimText(candidate?.summary, 4000),
      trimText(candidate?.headline_role, 240),
    ];
    const completed = checks.filter(Boolean).length;
    const total = checks.length;
    return {
      completed,
      total,
      percent: Math.round((completed / total) * 100),
    };
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
    toggleViews(true);
  }

  function toggleViews(showDashboard) {
    authSection.hidden = showDashboard;
    applicationView.hidden = showDashboard;
    dashboardRoot.hidden = !showDashboard;
  }

  function renderAuth() {
    if (!state.authAvailable) {
      authRoot.innerHTML = `
        <div class="candidate-portal-card candidate-portal-card--muted">
          <span class="candidate-portal-eyebrow">Candidate account</span>
          <h2>Portal tools are temporarily unavailable.</h2>
          <p>You can still submit your profile below. The Netlify application workflow will continue as normal.</p>
        </div>
      `;
      toggleViews(false);
      return;
    }

    const mode = state.authMode;
    const message = state.authMessage
      ? `<div class="candidate-portal-alert candidate-portal-alert--${escapeHtml(state.authMessage.tone)}">${escapeHtml(state.authMessage.text)}</div>`
      : '';
    const isBusy = state.authBusy ? 'disabled' : '';

    authRoot.innerHTML = `
      <div class="candidate-portal-shell">
        <article class="candidate-portal-card candidate-portal-card--secondary">
          <span class="candidate-portal-eyebrow">Optional candidate account</span>
          <h2>Want to save your details for next time?</h2>
          <p>You can still apply below as normal. A candidate account simply lets you keep your profile, documents, and HMJ application history in one place.</p>
          ${message}
          <p class="candidate-portal-note candidate-portal-note--strong">Prefer the quickest route? Ignore this section and use the application form below.</p>
          <div class="candidate-portal-tabs" role="tablist" aria-label="Candidate account actions">
            <button type="button" class="candidate-portal-tab ${mode === 'signin' ? 'is-active' : ''}" data-auth-mode="signin">Sign in</button>
            <button type="button" class="candidate-portal-tab ${mode === 'signup' ? 'is-active' : ''}" data-auth-mode="signup">Create account</button>
            <button type="button" class="candidate-portal-tab ${mode === 'reset' ? 'is-active' : ''}" data-auth-mode="reset">Reset password</button>
          </div>
          <div class="candidate-portal-panel ${mode === 'signin' ? 'is-active' : ''}" data-auth-panel="signin">
            <form class="candidate-portal-form" data-auth-form="signin">
              <label>Email
                <input type="email" name="email" autocomplete="email" required>
              </label>
              <label>Password
                <input type="password" name="password" autocomplete="current-password" required minlength="8">
              </label>
              <div class="candidate-dashboard-actions">
                <button class="candidate-portal-btn" type="submit" ${isBusy}>${state.authBusy && mode === 'signin' ? 'Signing in…' : 'Sign in'}</button>
                <button class="candidate-portal-btn candidate-portal-btn--ghost" type="button" data-auth-action="resend-verification" ${isBusy}>Resend verification email</button>
              </div>
              <p class="candidate-field-help">If your confirmation email has expired, enter the same email address here and resend a fresh one.</p>
            </form>
          </div>
          <div class="candidate-portal-panel ${mode === 'signup' ? 'is-active' : ''}" data-auth-panel="signup">
            <form class="candidate-portal-form" data-auth-form="signup">
              <label>Full name
                <input type="text" name="name" autocomplete="name" required>
              </label>
              <label>Email
                <input type="email" name="email" autocomplete="email" required>
              </label>
              <label>Password
                <input type="password" name="password" autocomplete="new-password" required minlength="8">
              </label>
              <button class="candidate-portal-btn" type="submit" ${isBusy}>${state.authBusy && mode === 'signup' ? 'Creating account…' : 'Create account'}</button>
              <p class="candidate-portal-note">We’ll email you a verification link before the account is ready to use.</p>
            </form>
          </div>
          <div class="candidate-portal-panel ${mode === 'reset' ? 'is-active' : ''}" data-auth-panel="reset">
            <form class="candidate-portal-form" data-auth-form="reset">
              <label>Email
                <input type="email" name="email" autocomplete="email" required>
              </label>
              <button class="candidate-portal-btn candidate-portal-btn--ghost" type="submit" ${isBusy}>${state.authBusy && mode === 'reset' ? 'Sending…' : 'Send reset link'}</button>
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
            </form>
          </div>
        </article>
        <aside class="candidate-portal-card candidate-portal-card--tint">
          <span class="candidate-portal-eyebrow">Candidate account benefits</span>
          <ul class="candidate-portal-list">
            <li>Save your core profile once and reuse it for future HMJ roles</li>
            <li>See your submitted applications and plain-English status updates</li>
            <li>Keep your latest CV and supporting documents in one secure place</li>
          </ul>
        </aside>
      </div>
    `;
    toggleViews(false);
  }

  function renderDashboard() {
    const candidate = state.candidate || {};
    const applications = state.applications || [];
    const documents = state.documents || [];
    const fullName = candidateName();
    const userEmail = trimText(state.user?.email, 320) || trimText(candidate.email, 320);
    const authMessage = state.authMessage
      ? `<div class="candidate-portal-alert candidate-portal-alert--${escapeHtml(state.authMessage.tone)}">${escapeHtml(state.authMessage.text)}</div>`
      : '';
    const profileSkills = Array.isArray(candidate.skills) ? candidate.skills.join(', ') : '';
    const verified = state.user?.email_confirmed_at ? 'Verified' : 'Check your inbox to verify';
    const tabs = ['profile', 'applications', 'documents', 'settings'];
    const completion = profileCompletion(candidate);

    const profilePane = `
      <section class="candidate-dashboard-pane ${state.activeTab === 'profile' ? 'is-active' : ''}" data-dashboard-pane="profile">
        <div class="candidate-dashboard-card">
          <div class="candidate-dashboard-card__head">
            <h3>Profile</h3>
            <p>Keep the details HMJ uses to represent you up to date.</p>
          </div>
          <div class="candidate-inline-panel">
            <strong>Profile completion</strong>
            <p>${completion.completed} of ${completion.total} profile areas completed. Adding the missing detail helps recruiters assess fit faster.</p>
            <div class="candidate-meter" aria-hidden="true"><span style="width:${completion.percent}%"></span></div>
          </div>
          <form class="candidate-dashboard-form" data-dashboard-form="profile">
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
            <label>Location
              <input type="text" name="location" value="${escapeHtml(candidate.location || '')}" placeholder="City, country">
            </label>
            <label>Sector focus
              <input type="text" name="sector_focus" value="${escapeHtml(candidate.sector_focus || '')}" placeholder="Data centres, pharma, substations…">
            </label>
            <label>Headline role
              <input type="text" name="headline_role" value="${escapeHtml(candidate.headline_role || '')}" placeholder="Lead CSA Engineer">
            </label>
            <label>Skills
              <input type="text" name="skills" value="${escapeHtml(profileSkills)}" placeholder="IST, LV, BMS, QA/QC">
            </label>
            <label>Availability
              <input type="text" name="availability" value="${escapeHtml(candidate.availability || '')}" placeholder="Immediate, 2 weeks, mid-April">
            </label>
            <label>LinkedIn
              <input type="url" name="linkedin_url" value="${escapeHtml(candidate.linkedin_url || '')}" placeholder="https://linkedin.com/in/your-profile">
            </label>
            <label class="candidate-dashboard-form__full">Summary
              <textarea name="summary" rows="6" placeholder="Tell HMJ about your current focus, preferred rotations and the sites that fit best.">${escapeHtml(candidate.summary || '')}</textarea>
            </label>
            <div class="candidate-dashboard-actions candidate-dashboard-form__full">
              <button class="candidate-portal-btn" type="submit" ${state.dashboardBusy ? 'disabled' : ''}>${state.dashboardBusy && state.activeTab === 'profile' ? 'Saving…' : 'Save profile'}</button>
              <span class="candidate-field-help">We only update your candidate record after you press save.</span>
            </div>
          </form>
        </div>
      </section>
    `;

    const applicationsPane = `
      <section class="candidate-dashboard-pane ${state.activeTab === 'applications' ? 'is-active' : ''}" data-dashboard-pane="applications">
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
      <section class="candidate-dashboard-pane ${state.activeTab === 'documents' ? 'is-active' : ''}" data-dashboard-pane="documents">
        <div class="candidate-dashboard-card">
          <div class="candidate-dashboard-card__head">
            <h3>Documents</h3>
            <p>Upload your latest CV and supporting documents into your private candidate area.</p>
          </div>
          <div class="candidate-inline-panel candidate-inline-panel--subtle">
            <strong>Accepted files</strong>
            <p>PDF, DOC, DOCX, PNG, JPG, JPEG, and WEBP files up to 15 MB.</p>
          </div>
          <form class="candidate-dashboard-form candidate-dashboard-form--documents" data-dashboard-form="documents">
            <label>Document type
              <select name="document_type" required>
                <option value="cv">CV</option>
                <option value="certificate">Certificate</option>
                <option value="right_to_work">Right to work</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Label
              <input type="text" name="label" placeholder="Updated March CV">
            </label>
            <label class="candidate-dashboard-form__full">File
              <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" required>
              <span class="candidate-field-help">The file will be linked to your candidate record and available to HMJ recruiters.</span>
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

    const settingsPane = `
      <section class="candidate-dashboard-pane ${state.activeTab === 'settings' ? 'is-active' : ''}" data-dashboard-pane="settings">
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
            </div>
          </div>
          <div class="candidate-dashboard-hero__meta">
            <span class="candidate-dashboard-stat"><strong>${applications.length}</strong><span>Applications</span></span>
            <span class="candidate-dashboard-stat"><strong>${documents.length}</strong><span>Documents</span></span>
            <a class="candidate-portal-btn candidate-portal-btn--ghost" href="/jobs.html">Browse jobs</a>
            <button class="candidate-portal-btn candidate-portal-btn--subtle" type="button" data-dashboard-action="signout">Sign out</button>
          </div>
        </header>
        ${authMessage}
        <div class="candidate-dashboard-layout">
          <nav class="candidate-dashboard-nav" aria-label="Candidate dashboard sections">
            ${tabs.map((tab) => `
              <button type="button" class="candidate-dashboard-nav__item ${state.activeTab === tab ? 'is-active' : ''}" data-dashboard-tab="${tab}">${escapeHtml(tab.charAt(0).toUpperCase() + tab.slice(1))}</button>
            `).join('')}
          </nav>
          <div class="candidate-dashboard-content">
            ${profilePane}
            ${applicationsPane}
            ${documentsPane}
            ${settingsPane}
          </div>
        </div>
      </section>
    `;

    toggleViews(true);
  }

  function render() {
    if (state.hydrating) {
      renderDashboardSkeleton();
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
      state.dashboardError = '';
      render();
      return;
    }

    state.dashboardBusy = true;
    render();

    try {
      const candidate = await loadCandidateProfile();
      const [applications, documents] = await Promise.all([
        loadCandidateApplications(candidate.id),
        loadCandidateDocuments(candidate.id),
      ]);
      state.candidate = candidate;
      state.applications = applications;
      state.documents = documents;
      state.dashboardError = '';
    } catch (error) {
      state.dashboardError = error?.message || 'Candidate dashboard unavailable.';
      state.authMessage = {
        tone: 'warn',
        text: 'Candidate dashboard tools are unavailable right now. You can still use the application form below.',
      };
      state.candidate = null;
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
        const authData = await signInCandidate({
          email: formData.get('email'),
          password: formData.get('password'),
        });
        state.user = authData?.user || authData?.session?.user || state.user;
        state.session = authData?.session || state.session;
        state.authMessage = { tone: 'success', text: 'Signed in. Loading your candidate dashboard…' };
        if (state.user) {
          await refreshDashboard();
        }
      } else if (mode === 'signup') {
        await signUpCandidate({
          name: formData.get('name'),
          email: formData.get('email'),
          password: formData.get('password'),
        });
        state.authMode = 'signin';
        state.authMessage = {
          tone: 'success',
          text: 'Account created. Check your inbox to verify your email before signing in. If the email expires, you can resend it from Sign in.',
        };
      } else if (mode === 'reset') {
        await requestCandidatePasswordReset(formData.get('email'));
        state.authMessage = {
          tone: 'success',
          text: 'Reset link sent. Check your inbox for the Supabase recovery email.',
        };
      } else if (mode === 'recovery') {
        const password = trimText(formData.get('password'), 200);
        const confirm = trimText(formData.get('confirm_password'), 200);
        if (!password || password !== confirm) {
          throw new Error('Passwords do not match.');
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
        if (!name) {
          throw new Error('Please enter your name before saving.');
        }
        if (linkedinUrl && !/^https?:\/\//i.test(linkedinUrl)) {
          throw new Error('Please enter your LinkedIn URL in full, for example https://linkedin.com/in/your-name.');
        }
        const saved = await saveCandidateProfile({
          name,
          phone: formData.get('phone'),
          location: formData.get('location'),
          sector_focus: formData.get('sector_focus'),
          headline_role: formData.get('headline_role'),
          skills: normaliseSkillList(formData.get('skills')),
          availability: formData.get('availability'),
          linkedin_url: linkedinUrl,
          summary: formData.get('summary'),
        });
        state.candidate = saved;
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
      render();
    }
  }

  async function handleDashboardAction(event) {
    const button = event.target.closest('[data-dashboard-action],[data-dashboard-tab],[data-auth-mode],[data-auth-action],[data-document-delete],[data-dashboard-toggle]');
    if (!button) return;

    if (button.hasAttribute('data-auth-mode')) {
      state.authMode = button.getAttribute('data-auth-mode');
      state.authMessage = null;
      render();
      return;
    }

    const authAction = button.getAttribute('data-auth-action');
    if (authAction === 'resend-verification') {
      const signInForm = authRoot.querySelector('[data-auth-form="signin"]');
      const email = trimText(signInForm?.elements?.email?.value, 320);
      if (!email) {
        state.authMessage = {
          tone: 'warn',
          text: 'Enter your email address first, then resend the verification email.',
        };
        render();
        return;
      }

      state.authBusy = true;
      render();

      try {
        await resendCandidateVerification(email);
        state.authMessage = {
          tone: 'success',
          text: 'A fresh verification email has been sent. Please open the newest email only.',
        };
      } catch (error) {
        state.authMessage = {
          tone: 'error',
          text: authErrorMessage('signin', error),
        };
      } finally {
        state.authBusy = false;
        render();
      }
      return;
    }

    if (button.hasAttribute('data-dashboard-tab')) {
      state.activeTab = button.getAttribute('data-dashboard-tab');
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

  function attachFormSync() {
    form.addEventListener('submit', () => {
      if (!form.checkValidity() || state.formSyncSent) return;
      try {
        const formData = new FormData(form);
        const submissionId = window.crypto?.randomUUID?.() || `candidate-${Date.now()}`;
        state.formSyncSent = true;
        const payload = {
          source: 'candidates_form',
          submission_id: submissionId,
          candidate: {
            first_name: formData.get('first_name'),
            surname: formData.get('surname'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            location: formData.get('location'),
            discipline: formData.get('discipline'),
            role: formData.get('role'),
            notice_period: formData.get('notice_period'),
            linkedin: formData.get('linkedin'),
            message: formData.get('message'),
            skills: normaliseSkillList(formData.get('skills')),
            source_submission_id: submissionId,
          },
        };
        void backgroundSyncCandidatePayload(payload);
      } catch (error) {
        // Never allow portal sync code to interrupt the native Netlify submission.
      }
    });
  }

  authRoot.addEventListener('submit', handleAuthForm);
  dashboardRoot.addEventListener('submit', handleDashboardForm);
  authRoot.addEventListener('click', handleDashboardAction);
  dashboardRoot.addEventListener('click', handleDashboardAction);
  attachFormSync();

  initialiseAuthState().then(() => {
    onCandidateAuthStateChange(async ({ user, session }) => {
      state.user = user;
      state.session = session;
      if (user) {
        await refreshDashboard();
      } else {
        state.candidate = null;
        state.applications = [];
        state.documents = [];
        state.activeTab = 'profile';
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
