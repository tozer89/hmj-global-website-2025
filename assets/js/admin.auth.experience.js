(function () {
  'use strict';

  const flowHelpers = window.HMJAuthFlow || {};
  const supportEmail = 'info@hmj-global.com';
  const supportMailto = `mailto:${supportEmail}?subject=${encodeURIComponent('HMJ Admin Access Help')}`;
  const autoOpenStore = 'hmj.admin.auth.auto-opened';

  const copyByIntent = {
    invite: {
      badge: 'Invite link detected',
      title: 'Finish setting your password',
      intro: 'You opened an HMJ invite link. Continue below to create your password and activate admin access.',
      steps: [
        ['Open the secure setup dialog', 'Use Continue secure email link to launch the secure password setup flow.'],
        ['Create a new password', 'Choose a strong password for your HMJ work account and complete the confirmation step.'],
        ['Return to admin', 'You will be brought back into HMJ admin as soon as the secure setup completes.']
      ],
      continueLabel: 'Continue secure email link',
      recoveryHint: 'If this invite has expired or has already been used, contact HMJ access support for a fresh invite.'
    },
    recovery: {
      badge: 'Password reset link detected',
      title: 'Reset your password',
      intro: 'This HMJ access link is ready to reset your password. Continue below to open the secure reset dialog.',
      steps: [
        ['Open the reset dialog', 'Use Continue secure email link to finish the password reset flow on this page.'],
        ['Choose a new password', 'Create your new password in the secure password dialog.'],
        ['Sign straight back in', 'After the password reset succeeds you will be returned to HMJ admin.']
      ],
      continueLabel: 'Continue secure email link',
      recoveryHint: 'If the link has expired, send yourself a fresh reset email using the form below.'
    },
    confirmation: {
      badge: 'Confirmation link detected',
      title: 'Confirm your HMJ access',
      intro: 'We detected a confirmation link for this account. Continue below to finish sign-in and return to HMJ admin.',
      steps: [
        ['Open the secure confirmation dialog', 'Use Continue secure email link to finish the confirmation step.'],
        ['Review the account prompt', 'If you are asked to sign in or set a password, follow the secure dialog on screen.'],
        ['Return to admin', 'Once the confirmation succeeds, HMJ admin will reload with your active session.']
      ],
      continueLabel: 'Continue secure email link',
      recoveryHint: 'If the confirmation no longer works, send a password reset instead or contact HMJ access support.'
    },
    'email-change': {
      badge: 'Email change link detected',
      title: 'Confirm your email change',
      intro: 'This link is ready to confirm an account email change. Continue below to open the secure confirmation dialog.',
      steps: [
        ['Open the secure dialog', 'Use Continue secure email link to finish the confirmation.'],
        ['Complete the verification', 'Follow the prompt on screen and review any confirmation details.'],
        ['Return to admin', 'After the change is accepted you can continue into HMJ admin with the updated account details.']
      ],
      continueLabel: 'Continue secure email link',
      recoveryHint: 'If the link has expired, contact HMJ access support so the account change can be reviewed.'
    },
    session: {
      badge: 'Secure session detected',
      title: 'Finish signing in',
      intro: 'We detected a secure sign-in link on this page. Continue below to let HMJ finish your access safely.',
      steps: [
        ['Open the secure dialog', 'Use Continue secure email link to finish the current sign-in step.'],
        ['Review any prompts', 'Follow the secure on-screen prompt if extra confirmation is required.'],
        ['Continue to admin', 'Once the sign-in step completes, HMJ admin will refresh automatically.']
      ],
      continueLabel: 'Continue secure email link',
      recoveryHint: 'If this secure sign-in step fails, reload the page or send yourself a new reset email.'
    },
    default: {
      badge: 'Secure HMJ access',
      title: 'Secure access guidance',
      intro: 'Use your HMJ work email to sign in, reset your password, or complete an access email on this page.',
      steps: [
        ['Sign in with your HMJ email', 'Open the secure sign-in dialog and enter the work email tied to your HMJ admin account.'],
        ['Reset a forgotten password', 'Use the password reset form if you need a fresh reset email sent to your inbox.'],
        ['Need a first-time setup?', 'Open the latest invite on this page, or contact HMJ access support if it has expired.']
      ],
      continueLabel: 'Continue secure email link',
      recoveryHint: 'Use your HMJ work email. If you never created a password and no longer have the invite email, contact HMJ access support.'
    }
  };

  const selectors = {
    cardHeading: '#authCardHeading',
    cardIntro: '#authCardIntro',
    contextBadge: '#authContextBadge',
    continueButton: '[data-auth-action="continue-token"]',
    message: '#authMessage',
    note: '#authRecoveryNote',
    recoveryForm: '#authRecoveryForm',
    recoveryInput: '#authRecoveryEmail',
    recoverySubmit: '#authRecoverySubmit',
    resetButton: '[data-auth-action="show-reset"]',
    setupButton: '[data-auth-action="show-setup"]',
    statusCopy: '#authStateCopy',
    statusList: '#authStateSteps',
    statusTitle: '#authStateTitle',
  };

  function safeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function parseAuthState() {
    if (typeof flowHelpers.parseAuthState === 'function') {
      return flowHelpers.parseAuthState(window.location);
    }
    return {
      intent: '',
      hasError: false,
      hasTokenPayload: false,
      isAuthCallback: false,
      authParams: {}
    };
  }

  function select(name) {
    return document.querySelector(selectors[name]);
  }

  function toneMessage(text, tone) {
    const node = select('message');
    if (!node) return;
    if (!text) {
      node.hidden = true;
      node.removeAttribute('data-tone');
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.setAttribute('data-tone', tone || 'info');
    node.textContent = text;
  }

  function updatePressedButton(active) {
    ['resetButton', 'setupButton'].forEach((name) => {
      const node = select(name);
      if (!node) return;
      const pressed = active === name;
      node.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }

  function renderStatus(copy) {
    const title = select('statusTitle');
    const body = select('statusCopy');
    const badge = select('contextBadge');
    const note = select('note');
    const list = select('statusList');
    const continueButton = select('continueButton');

    if (title) title.textContent = copy.title;
    if (body) body.textContent = copy.intro;
    if (badge) badge.textContent = copy.badge;
    if (note) note.textContent = copy.recoveryHint;

    if (continueButton) {
      continueButton.textContent = copy.continueLabel;
      continueButton.hidden = false;
    }

    if (list) {
      list.innerHTML = '';
      copy.steps.forEach((step, index) => {
        const item = document.createElement('li');
        item.setAttribute('data-step', String(index + 1));
        const text = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = step[0];
        const small = document.createElement('span');
        small.textContent = step[1];
        text.appendChild(strong);
        text.appendChild(small);
        item.appendChild(text);
        list.appendChild(item);
      });
    }
  }

  function currentCopy(state) {
    const key = state.intent && copyByIntent[state.intent] ? state.intent : 'default';
    return copyByIntent[key];
  }

  function readAuthEmail(state) {
    return safeString(state?.authParams?.email).trim();
  }

  function normaliseErrorMessage(error) {
    const raw = safeString(error?.message || error?.error || error?.error_description || error).trim();
    const text = raw.replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    if (!text) return 'We could not complete that request. Please try again.';
    if (lower.includes('expired') || lower.includes('already been used') || lower.includes('already used')) {
      return 'This email link has expired or has already been used. Send yourself a new password reset or contact HMJ access support for a fresh invite.';
    }
    if (lower.includes('invalid') || lower.includes('not valid') || lower.includes('missing')) {
      return 'This email link is no longer valid. Open the newest email you received, or request a new password reset.';
    }
    if (lower.includes('network') || lower.includes('fetch')) {
      return 'HMJ could not reach the secure sign-in service just now. Check your connection and try again.';
    }
    if (lower.includes('not found') || lower.includes('no user')) {
      return 'That account could not be matched. Check the work email you entered or contact HMJ access support.';
    }
    return text;
  }

  function ensureMailtoLinks() {
    document.querySelectorAll('[data-auth-support-link]').forEach((node) => {
      node.setAttribute('href', supportMailto);
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function resolveIdentity(maxMs) {
    const limit = Number.isFinite(maxMs) ? maxMs : 6000;
    const started = Date.now();

    while ((Date.now() - started) < limit) {
      try {
        if (typeof window.hmjEnsureIdentityWidget === 'function') {
          window.hmjEnsureIdentityWidget();
        }
      } catch (err) {
        console.warn('[HMJ auth] identity ensure failed', err);
      }

      try {
        if (typeof window.hmjConfigureIdentity === 'function') {
          window.hmjConfigureIdentity(true);
        }
      } catch (err) {
        console.warn('[HMJ auth] identity configure failed', err);
      }

      const identity = window.netlifyIdentity || null;
      if (identity) {
        try {
          if (typeof identity.init === 'function' && !identity.__hmjAuthExperienceInit) {
            identity.__hmjAuthExperienceInit = true;
            const apiUrl = safeString(window.ADMIN_IDENTITY_URL || window.HMJ_IDENTITY_URL || window.NETLIFY_IDENTITY_URL).trim();
            identity.init(apiUrl ? { APIUrl: apiUrl, autologin: false } : { autologin: false });
          }
        } catch (err) {
          console.warn('[HMJ auth] identity init failed', err);
        }
        return identity;
      }
      await wait(120);
    }

    return window.netlifyIdentity || null;
  }

  function bindIdentityEvents(identity, state) {
    if (!identity || identity.__hmjAuthExperienceBound || typeof identity.on !== 'function') return;
    identity.__hmjAuthExperienceBound = true;

    identity.on('error', (error) => {
      toneMessage(normaliseErrorMessage(error), 'error');
    });

    identity.on('login', () => {
      if (state.hasTokenPayload || state.hasError) {
        toneMessage('Secure account step complete. Finishing sign-in and returning you to HMJ admin…', 'ok');
      }
    });
  }

  async function openIdentityDialog(state, mode) {
    const identity = await resolveIdentity(6000);
    if (!identity || typeof identity.open !== 'function') {
      toneMessage('Secure sign-in is still loading in this browser. Refresh and try again.', 'error');
      return false;
    }

    bindIdentityEvents(identity, state);

    try {
      if (mode === 'token' && state.hasTokenPayload) {
        identity.open();
      } else {
        identity.open('login');
      }
      return true;
    } catch (error) {
      toneMessage(normaliseErrorMessage(error), 'error');
      return false;
    }
  }

  async function requestPasswordReset(state) {
    const form = select('recoveryForm');
    const input = select('recoveryInput');
    const submit = select('recoverySubmit');
    const email = safeString(input?.value).trim();

    if (!email) {
      toneMessage('Enter the HMJ work email linked to the account you need help with.', 'error');
      input?.focus();
      return;
    }

    const identity = await resolveIdentity(6000);
    const client = identity?.gotrue;
    if (!client || typeof client.requestPasswordRecovery !== 'function') {
      toneMessage('Password recovery is not ready yet in this browser. Refresh and try again.', 'error');
      return;
    }

    if (submit) submit.disabled = true;
    if (form) form.setAttribute('aria-busy', 'true');

    try {
      bindIdentityEvents(identity, state);
      await client.requestPasswordRecovery(email);
      toneMessage(`If ${email} is recognised, a password reset email is on its way. Open the newest link on this HMJ admin page to finish the reset.`, 'ok');
      renderStatus({
        badge: 'Reset email requested',
        title: 'Check your inbox',
        intro: 'Use the newest password email we send you. Open that link on this HMJ admin page so the secure password flow can complete here.',
        steps: [
          ['Open the newest email', 'Use the latest HMJ password email so you do not hit an older expired link.'],
          ['Finish the secure reset here', 'Open the link on this page and continue with the secure password reset dialog.'],
          ['Still no access?', 'If no email arrives or the link has expired, contact HMJ access support for account help.']
        ],
        continueLabel: state.hasTokenPayload ? currentCopy(state).continueLabel : 'Continue secure email link',
        recoveryHint: 'For security, HMJ shows the same confirmation message whether or not the email address exists.'
      });
    } catch (error) {
      toneMessage(normaliseErrorMessage(error), 'error');
    } finally {
      if (submit) submit.disabled = false;
      if (form) form.removeAttribute('aria-busy');
    }
  }

  function maybeAutoOpen(state) {
    if (!state.hasTokenPayload) return;
    const key = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    try {
      if (window.sessionStorage.getItem(autoOpenStore) === key) {
        return;
      }
      window.sessionStorage.setItem(autoOpenStore, key);
    } catch (err) {
      console.warn('[HMJ auth] auto-open store failed', err);
    }

    window.setTimeout(() => {
      openIdentityDialog(state, 'token');
    }, 320);
  }

  function bindActions(state) {
    const continueButton = select('continueButton');
    const recoveryForm = select('recoveryForm');
    const resetButton = select('resetButton');
    const setupButton = select('setupButton');
    const input = select('recoveryInput');

    continueButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!state.hasTokenPayload) {
        toneMessage('Open the latest invite or password email on this page, then select Continue secure email link. If the link has expired, send yourself a fresh reset email instead.', 'info');
        return;
      }
      await openIdentityDialog(state, 'token');
    });

    resetButton?.addEventListener('click', (event) => {
      event.preventDefault();
      updatePressedButton('resetButton');
      toneMessage('Enter your HMJ work email below and we will send a secure password reset email if the account is recognised.', 'info');
      input?.focus();
    });

    setupButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      updatePressedButton('setupButton');
      if (state.hasTokenPayload) {
        await openIdentityDialog(state, 'token');
        return;
      }
      toneMessage('Use the latest invite or setup email on this page to create your password. If that email has expired, contact HMJ access support for a fresh invite.', 'info');
    });

    recoveryForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      updatePressedButton('resetButton');
      await requestPasswordReset(state);
    });
  }

  function updateCardIntro(state) {
    const heading = select('cardHeading');
    const intro = select('cardIntro');
    const copy = currentCopy(state);

    if (heading) {
      heading.textContent = state.hasTokenPayload ? copy.title : 'Sign in to continue';
    }
    if (intro) {
      intro.textContent = state.hasTokenPayload
        ? copy.intro
        : 'Use your HMJ work email. If you opened an invite or password email, this page will guide you through the next step.';
    }
  }

  function applyInitialEmail(state) {
    const email = readAuthEmail(state);
    const input = select('recoveryInput');
    if (email && input && !safeString(input.value).trim()) {
      input.value = email;
    }
  }

  function syncInitialMessage(state) {
    if (state.hasError) {
      toneMessage(normaliseErrorMessage(state.authParams.error_description || state.authParams.error), 'error');
      return;
    }
    if (state.hasTokenPayload) {
      toneMessage(currentCopy(state).intro, 'info');
      return;
    }
    toneMessage('', '');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const gate = document.getElementById('gate');
    if (!gate) return;

    ensureMailtoLinks();

    const state = parseAuthState();
    const copy = currentCopy(state);

    updateCardIntro(state);
    renderStatus(copy);
    applyInitialEmail(state);
    syncInitialMessage(state);
    bindActions(state);
    maybeAutoOpen(state);
  });
})();
