(function () {
  'use strict';

  const doc = document;
  const win = window;
  const prefersReducedMotion = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const STORAGE_KEYS = {
    draft: 'hmj.client.draft:v3',
    scope: 'hmj.client.tools.scope:v3',
    budget: 'hmj.client.tools.budget:v3',
    checklist: 'hmj.client.tools.checklist:v3',
    notes: 'hmj.client.notes:v2'
  };

  const safeStorage = (() => {
    try {
      const testKey = '__hmj__';
      win.localStorage.setItem(testKey, '1');
      win.localStorage.removeItem(testKey);
      return win.localStorage;
    } catch (_) {
      return null;
    }
  })();

  const toastRegion = doc.querySelector('.toast-region');
  const shortcutsOverlay = doc.getElementById('shortcutOverlay');
  let lastFocusedBeforeShortcuts = null;

  const ROLE_LIBRARY = [
    {
      id: 'csa-package-manager',
      label: 'CSA Package Manager',
      summary: 'Own civil, structural and architectural package delivery.',
      responsibilities: [
        'coordinate civils, structural and architectural interfaces across live programme milestones',
        'own package sequencing, subcontractor management and short-interval reporting',
        'drive quality close-out, look-ahead planning and daily issue resolution'
      ],
      outcomes: [
        'stable package handovers',
        'clear coordination across upstream and downstream trades',
        'reduced programme slippage at key stage gates'
      ],
      requirements: [
        'experience leading CSA packages in live data centre or regulated build environments',
        'strong subcontractor coordination and reporting discipline',
        'confidence working to schedule, QA/QC and commercial constraints'
      ]
    },
    {
      id: 'electrical-project-manager',
      label: 'Electrical Project Manager',
      summary: 'Lead electrical delivery, interfaces and energisation readiness.',
      responsibilities: [
        'manage HV/LV installation activity, trade interfaces and energisation planning',
        'coordinate subcontractor performance, RAMS compliance and QA/QC close-out',
        'align electrical works with testing, commissioning and client reporting requirements'
      ],
      outcomes: [
        'controlled electrical package progress',
        'cleaner test readiness and witness support',
        'better visibility on delivery risks and blockers'
      ],
      requirements: [
        'electrical project leadership on hyperscale, industrial or pharma programmes',
        'knowledge of commissioning interfaces and energisation risk',
        'clear communication across site, design and commercial stakeholders'
      ]
    },
    {
      id: 'commissioning-lead',
      label: 'Commissioning Lead',
      summary: 'Coordinate completions, scripts and test readiness.',
      responsibilities: [
        'own commissioning strategy, level 3-5 planning and witness coordination',
        'drive completions, punch list closure and vendor interface management',
        'report readiness, test outcomes and escalation items to programme leadership'
      ],
      outcomes: [
        'stronger test readiness',
        'faster issue resolution through completions',
        'more structured handover documentation'
      ],
      requirements: [
        'delivery experience across commissioning, completions and integrated systems testing',
        'comfort managing vendors, site teams and client stakeholders under deadline pressure',
        'clear understanding of documentation quality and handover expectations'
      ]
    },
    {
      id: 'planner',
      label: 'Planner / Project Controls',
      summary: 'Strengthen schedule visibility and delivery reporting.',
      responsibilities: [
        'maintain integrated programmes and package-level look-aheads',
        'track float, slippage, recovery actions and milestone ownership',
        'provide structured reporting for delivery, commercial and leadership teams'
      ],
      outcomes: [
        'better programme visibility',
        'clearer critical path management',
        'more credible recovery planning'
      ],
      requirements: [
        'experience with Primavera or MSP in construction, commissioning or shutdown environments',
        'ability to build reporting discipline across multiple package owners',
        'confidence translating schedule data into practical delivery decisions'
      ]
    },
    {
      id: 'quantity-surveyor',
      label: 'Quantity Surveyor / Commercial',
      summary: 'Improve cost control, changes and commercial visibility.',
      responsibilities: [
        'track valuations, variations, procurement status and change control',
        'support commercial forecasting, cost reporting and subcontractor management',
        'surface commercial risk early and keep package decisions documented'
      ],
      outcomes: [
        'sharper cost visibility',
        'cleaner change management',
        'stronger commercial control through package delivery'
      ],
      requirements: [
        'commercial experience on complex MEP, CSA or fit-out packages',
        'confidence with valuations, variations and reporting cadence',
        'ability to work closely with project delivery and procurement teams'
      ]
    },
    {
      id: 'qa-qc-manager',
      label: 'QA / QC Manager',
      summary: 'Tighten inspection, snags and document quality.',
      responsibilities: [
        'manage inspections, test packs, red lines and close-out processes',
        'coordinate quality issues across subcontractors and package leaders',
        'maintain document control standards that support handover and client review'
      ],
      outcomes: [
        'fewer quality-driven delays',
        'cleaner documentation at handover',
        'stronger close-out discipline across live packages'
      ],
      requirements: [
        'quality leadership on technical construction or commissioning-heavy projects',
        'strong document control habits and close-out follow-through',
        'ability to challenge delivery teams constructively when standards slip'
      ]
    },
    {
      id: 'hse-lead',
      label: 'HSE Lead',
      summary: 'Support safe delivery and onboarding discipline.',
      responsibilities: [
        'drive site safety culture, incident prevention and compliance reporting',
        'coordinate inductions, audits and corrective action tracking',
        'work with package teams to keep productivity aligned to safe systems of work'
      ],
      outcomes: [
        'safer mobilisation',
        'stronger onboarding standards',
        'better visibility on actions and compliance gaps'
      ],
      requirements: [
        'site HSE leadership in complex construction or regulated project environments',
        'confidence with audits, inductions and cross-team intervention',
        'clear reporting discipline and practical communication style'
      ]
    },
    {
      id: 'package-director',
      label: 'Package Director / Senior Delivery Lead',
      summary: 'Provide senior leadership across high-pressure packages.',
      responsibilities: [
        'own package strategy, executive reporting and stakeholder alignment',
        'stabilise delivery teams, commercial decisions and escalation routes',
        'set expectations on performance, handover and mobilisation planning'
      ],
      outcomes: [
        'stronger accountability across the package',
        'clearer leadership for risk and decision-making',
        'improved confidence at client and programme level'
      ],
      requirements: [
        'senior project or package leadership in mission-critical delivery environments',
        'confidence aligning delivery, commercial and client stakeholders',
        'ability to impose structure quickly on pressured programmes'
      ]
    }
  ];

  const FOCUS_LIBRARY = [
    {
      id: 'programme',
      label: 'Programme focus',
      narrative: 'milestone ownership, look-ahead planning and interface management'
    },
    {
      id: 'commercial',
      label: 'Commercial focus',
      narrative: 'budget discipline, change visibility and commercially clean package management'
    },
    {
      id: 'commissioning',
      label: 'Commissioning focus',
      narrative: 'completions, test readiness, witness support and structured handover quality'
    },
    {
      id: 'package',
      label: 'Package leadership focus',
      narrative: 'clear ownership, subcontractor coordination and decisive package accountability'
    }
  ];

  const URGENCY_LIBRARY = [
    { id: 'standard', label: 'Standard', multiplier: 1, note: 'Typical market conditions' },
    { id: 'priority', label: 'Priority', multiplier: 1.07, note: 'Faster turnaround or narrower pool' },
    { id: 'critical', label: 'Critical', multiplier: 1.14, note: 'Time-sensitive or hard-to-fill brief' }
  ];

  const CHECKLIST_TEMPLATE = [
    {
      id: 'commercial',
      label: 'Commercial',
      items: [
        {
          id: 'commercial-rate',
          label: 'Approved rate or salary band',
          description: 'Confirm the commercial range the hiring manager can actually take to market.'
        },
        {
          id: 'commercial-po',
          label: 'PO / vendor route confirmed',
          description: 'Clarify invoicing route, billing entity and internal approval path.'
        },
        {
          id: 'commercial-terms',
          label: 'Terms and sign-off contacts identified',
          description: 'Know who approves terms, mark-up and any site-specific commercial add-ons.'
        }
      ]
    },
    {
      id: 'onboarding',
      label: 'Onboarding',
      items: [
        {
          id: 'onboarding-start',
          label: 'Target start date agreed',
          description: 'Give delivery teams and candidates a realistic mobilisation window.'
        },
        {
          id: 'onboarding-line-manager',
          label: 'Reporting line and site contact confirmed',
          description: 'Avoid ambiguity around who owns day-one handover and site access support.'
        },
        {
          id: 'onboarding-timesheets',
          label: 'Timesheet / attendance route ready',
          description: 'Make sure contractor approval workflows are understood before arrival.'
        }
      ]
    },
    {
      id: 'access',
      label: 'Access & compliance',
      items: [
        {
          id: 'access-induction',
          label: 'Induction and site access requirements listed',
          description: 'Capture passes, inductions, permits and badging needs upfront.'
        },
        {
          id: 'access-docs',
          label: 'Required IDs and compliance documents known',
          description: 'Surface right-to-work, insurance or training requirements before offer stage.'
        },
        {
          id: 'access-travel',
          label: 'Travel or rotation assumptions clarified',
          description: 'Useful where accommodation, flights or rotation pattern affect mobilisation.'
        }
      ]
    },
    {
      id: 'project',
      label: 'Project documentation',
      items: [
        {
          id: 'project-brief',
          label: 'Role brief or spec is ready to send',
          description: 'Even a one-page outline improves candidate fit and internal consistency.'
        },
        {
          id: 'project-priorities',
          label: 'Top delivery priorities are documented',
          description: 'Clarify what success looks like in the first 30-60 days.'
        },
        {
          id: 'project-handover',
          label: 'Key milestones or handover dates are visible',
          description: 'Useful for programme-critical roles where timing directly affects site delivery.'
        }
      ]
    }
  ];

  const roleMap = new Map(ROLE_LIBRARY.map((role) => [role.id, role]));
  const focusMap = new Map(FOCUS_LIBRARY.map((focus) => [focus.id, focus]));
  const urgencyMap = new Map(URGENCY_LIBRARY.map((urgency) => [urgency.id, urgency]));

  function hmjToast(message, type = 'info', duration = 2800) {
    if (!toastRegion) {
      if (typeof console !== 'undefined') console.info('[hmj-toast]', message);
      return;
    }

    const toast = doc.createElement('div');
    toast.className = 'toast';
    toast.dataset.type = type;
    toast.textContent = message;
    toastRegion.appendChild(toast);

    let timeoutId = null;
    const dismiss = () => {
      toast.classList.remove('show');
      const remove = () => toast.remove();
      toast.addEventListener('transitionend', remove, { once: true });
      if (prefersReducedMotion()) remove();
    };

    const scheduleDismiss = (ms = duration) => {
      win.clearTimeout(timeoutId);
      timeoutId = win.setTimeout(dismiss, ms);
    };

    requestAnimationFrame(() => {
      toast.classList.add('show');
      scheduleDismiss();
    });

    toast.addEventListener('mouseenter', () => win.clearTimeout(timeoutId));
    toast.addEventListener('mouseleave', () => scheduleDismiss(1400));
  }

  function initToasts() {
    win.hmjToast = hmjToast;
  }

  function readStorage(key, fallback) {
    if (!safeStorage) return fallback;
    try {
      const raw = safeStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    if (!safeStorage) return;
    try {
      safeStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* noop */
    }
  }

  function removeStorage(key) {
    if (!safeStorage) return;
    try {
      safeStorage.removeItem(key);
    } catch (_) {
      /* noop */
    }
  }

  function clampNumber(value, min, max, fallback = min) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function createId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getLines(value) {
    return String(value || '')
      .split(/\n|;/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function uniqueList(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function humanJoin(items) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  function formatCurrency(value, digits = 0) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: digits
    }).format(value);
  }

  function formatDateTime(value) {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.nodeName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  async function copyText(value, successMessage, button) {
    const text = String(value || '').trim();
    if (!text) {
      hmjToast('Nothing to copy yet', 'warning');
      return false;
    }

    let copied = false;

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (_) {
        copied = false;
      }
    }

    if (!copied) {
      const fallback = doc.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      fallback.style.pointerEvents = 'none';
      doc.body.appendChild(fallback);
      fallback.select();
      copied = doc.execCommand('copy');
      doc.body.removeChild(fallback);
    }

    if (copied) {
      hmjToast(successMessage, 'success');
      if (button) flashButtonLabel(button, 'Copied');
      return true;
    }

    hmjToast('Copy failed. Please copy the text manually.', 'warning');
    return false;
  }

  function flashButtonLabel(button, label, duration = 1600) {
    if (!(button instanceof HTMLElement)) return;
    const original = button.dataset.defaultLabel || button.textContent;
    button.dataset.defaultLabel = original;
    button.textContent = label;
    win.clearTimeout(button._labelTimer);
    button._labelTimer = win.setTimeout(() => {
      button.textContent = original;
    }, duration);
  }

  function applyTheme(theme) {
    doc.documentElement.dataset.theme = theme;
    if (safeStorage) {
      try {
        safeStorage.setItem('hmj.theme', theme);
      } catch (_) {
        /* noop */
      }
    }
  }

  function currentTheme() {
    return doc.documentElement.dataset.theme || 'auto';
  }

  function initThemeToggle() {
    const toggle = doc.querySelector('[data-theme-toggle]');
    if (!toggle) return;
    let initial = 'auto';
    if (safeStorage) {
      try {
        initial = safeStorage.getItem('hmj.theme') || 'auto';
      } catch (_) {
        initial = 'auto';
      }
    }
    if (initial !== 'auto') {
      applyTheme(initial);
      toggle.setAttribute('aria-pressed', String(initial === 'dark'));
    }
    toggle.addEventListener('click', () => {
      const active = currentTheme();
      const next = active === 'dark' ? 'auto' : 'dark';
      applyTheme(next);
      toggle.setAttribute('aria-pressed', String(next === 'dark'));
      hmjToast(`Theme ${next === 'dark' ? 'enabled' : 'set to system'}`, 'info');
    });
  }

  function initNav() {
    const burger = doc.querySelector('.hmj-burger');
    const menu = doc.getElementById('hmj-menu');
    const scrim = doc.querySelector('.hmj-scrim');
    if (!burger || !menu || !scrim || burger.dataset.hmjNavBound === 'true') return;
    burger.dataset.hmjNavBound = 'true';

    const close = () => {
      burger.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open', 'open');
      scrim.hidden = true;
      scrim.setAttribute('aria-hidden', 'true');
      doc.body.style.overflow = '';
    };

    const open = () => {
      burger.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open', 'open');
      scrim.hidden = false;
      scrim.setAttribute('aria-hidden', 'false');
      doc.body.style.overflow = 'hidden';
    };

    burger.addEventListener('click', () => {
      const expanded = burger.getAttribute('aria-expanded') === 'true';
      if (expanded) close();
      else open();
    });

    scrim.addEventListener('click', close);

    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });

    win.addEventListener('resize', () => {
      if (win.innerWidth > 900) close();
    });
  }

  function initTooltips() {
    const targets = doc.querySelectorAll('[data-help]');
    let openTip = null;

    targets.forEach((target, index) => {
      if (!(target instanceof HTMLElement)) return;
      const help = target.getAttribute('data-help');
      if (!help || !help.trim()) return;

      const id = `tooltip-${index}`;
      const trigger = doc.createElement('button');
      trigger.type = 'button';
      trigger.className = 'tooltip-trigger';
      trigger.innerHTML = '<span aria-hidden="true">i</span>';
      trigger.setAttribute('aria-describedby', id);

      const bubble = doc.createElement('span');
      bubble.className = 'tooltip-bubble';
      bubble.id = id;
      bubble.setAttribute('role', 'tooltip');
      bubble.textContent = help.trim();
      bubble.dataset.visible = 'false';

      target.appendChild(trigger);
      target.style.position = 'relative';
      target.style.display = 'inline-flex';
      target.style.alignItems = 'center';
      target.appendChild(bubble);

      const show = () => {
        if (openTip && openTip !== bubble) hide(openTip);
        bubble.dataset.visible = 'true';
        openTip = bubble;
      };

      const hide = (tip = bubble) => {
        tip.dataset.visible = 'false';
        if (openTip === tip) openTip = null;
      };

      trigger.addEventListener('mouseenter', show);
      trigger.addEventListener('focus', show);
      trigger.addEventListener('mouseleave', () => hide());
      trigger.addEventListener('blur', () => hide());
      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          hide();
          trigger.blur();
        }
      });
    });

    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openTip) {
        openTip.dataset.visible = 'false';
        openTip = null;
      }
    });
  }

  function initValidation(form) {
    if (!form) return;

    const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter((field) => {
      return field.type !== 'hidden' && field.name !== 'form-name';
    });

    fields.forEach((field) => {
      const wrapper = field.closest('.field');
      const control = wrapper?.querySelector('.field-control');
      if (!wrapper || !control) return;

      const indicator = doc.createElement('span');
      indicator.className = 'field-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      control.appendChild(indicator);

      const feedback = doc.createElement('p');
      feedback.className = 'field-feedback';
      const feedbackId = `${field.id || field.name}-feedback`;
      feedback.id = feedbackId;
      wrapper.appendChild(feedback);

      const describedBy = field.getAttribute('aria-describedby');
      field.setAttribute('aria-describedby', describedBy ? `${describedBy} ${feedbackId}` : feedbackId);

      const renderState = () => {
        const value = String(field.value || '').trim();
        const isValid = field.checkValidity();
        const isRequired = field.required;
        const hasValue = value.length > 0;
        feedback.classList.remove('visible');
        indicator.className = 'field-indicator';

        if (!hasValue && !isRequired) return;

        if (isValid) {
          indicator.classList.add('is-valid', 'visible');
          indicator.textContent = 'OK';
        } else {
          indicator.classList.add('is-invalid', 'visible');
          indicator.textContent = '!';
          feedback.textContent = field.validationMessage;
          feedback.classList.add('visible');
        }
      };

      field.addEventListener('blur', renderState);
      field.addEventListener('change', renderState);
      field.addEventListener('input', () => {
        if (field !== doc.activeElement) renderState();
      });
    });
  }

  function initProgressMeter(form) {
    if (!form) return;
    const progressLabel = doc.querySelector('[data-progress-value]');
    const progressBar = doc.querySelector('[data-progress-bar]');
    const required = Array.from(form.querySelectorAll('[required]')).filter((field) => field.type !== 'hidden');
    if (!progressLabel || !progressBar || !required.length) return;

    const update = () => {
      const complete = required.filter((field) => {
        return String(field.value || '').trim().length > 0 && field.checkValidity();
      }).length;
      const percent = Math.round((complete / required.length) * 100);
      progressLabel.textContent = `${percent}%`;
      progressBar.style.width = `${percent}%`;
    };

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  }

  function initAutosave(form) {
    if (!form || !safeStorage) return;
    const clearBtn = doc.querySelector('[data-clear-draft]');
    const fields = Array.from(form.elements).filter((field) => {
      return field.name && field.type !== 'file' && field.type !== 'hidden';
    });

    let timer = null;

    const save = () => {
      const payload = {};
      fields.forEach((field) => {
        payload[field.name] = field.value;
      });
      writeStorage(STORAGE_KEYS.draft, payload);
    };

    const scheduleSave = () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(save, 700);
    };

    fields.forEach((field) => {
      field.addEventListener('input', scheduleSave);
      field.addEventListener('change', scheduleSave);
    });

    const saved = readStorage(STORAGE_KEYS.draft, null);
    let restored = false;
    if (saved && typeof saved === 'object') {
      fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(saved, field.name)) {
          field.value = saved[field.name];
          restored = true;
        }
      });
    }

    if (restored) {
      hmjToast('Draft restored from your last visit', 'success');
      form.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('change', { bubbles: true }));
    }

    clearBtn?.addEventListener('click', () => {
      removeStorage(STORAGE_KEYS.draft);
      fields.forEach((field) => {
        field.value = '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
      hmjToast('Draft cleared', 'info');
    });
  }

  function initShortcuts(form) {
    if (!shortcutsOverlay) return;

    const closeBtn = shortcutsOverlay.querySelector('[data-close-shortcuts]');
    const submitButton = form?.querySelector('button[type="submit"]');

    shortcutsOverlay.hidden = true;
    shortcutsOverlay.setAttribute('hidden', '');
    shortcutsOverlay.setAttribute('aria-hidden', 'true');

    const trapFocus = (event) => {
      if (shortcutsOverlay.hasAttribute('hidden')) return;
      const focusable = Array.from(shortcutsOverlay.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.key === 'Tab') {
        if (event.shiftKey && doc.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && doc.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    const closeOverlay = () => {
      if (shortcutsOverlay.hasAttribute('hidden')) return;
      shortcutsOverlay.hidden = true;
      shortcutsOverlay.setAttribute('hidden', '');
      shortcutsOverlay.setAttribute('aria-hidden', 'true');
      doc.removeEventListener('keydown', trapFocus, true);
      if (lastFocusedBeforeShortcuts) lastFocusedBeforeShortcuts.focus?.();
    };

    const openOverlay = () => {
      if (!shortcutsOverlay.hasAttribute('hidden')) return;
      shortcutsOverlay.hidden = false;
      shortcutsOverlay.removeAttribute('hidden');
      shortcutsOverlay.setAttribute('aria-hidden', 'false');
      lastFocusedBeforeShortcuts = doc.activeElement;
      closeBtn?.focus();
      doc.addEventListener('keydown', trapFocus, true);
    };

    closeBtn?.addEventListener('click', closeOverlay);
    shortcutsOverlay.addEventListener('click', (event) => {
      if (event.target === shortcutsOverlay) closeOverlay();
    });

    doc.addEventListener('keydown', (event) => {
      if (event.key === '?' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        if (shortcutsOverlay.hasAttribute('hidden')) openOverlay();
        else closeOverlay();
      }

      if (event.key === 'Escape' || event.key === 'Esc') {
        closeOverlay();
      }

      if (event.key.toLowerCase() === 's' && event.altKey && submitButton) {
        event.preventDefault();
        const top = submitButton.getBoundingClientRect().top + win.scrollY - 80;
        win.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        submitButton.focus({ preventScroll: true });
      }
    });
  }

  function initFormSubmission(form) {
    if (!form) return;
    form.addEventListener(
      'submit',
      () => {
        hmjToast('Thanks. HMJ client services will review this shortly.', 'success');
      },
      { once: true }
    );
  }

  function initHeroMotion() {
    const hero = doc.getElementById('clientHero');
    if (!hero || prefersReducedMotion()) return;

    const updateFromPointer = (event) => {
      const rect = hero.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      hero.style.setProperty('--hero-mx', x.toFixed(3));
      hero.style.setProperty('--hero-my', y.toFixed(3));
    };

    const reset = () => {
      hero.style.setProperty('--hero-mx', '0');
      hero.style.setProperty('--hero-my', '0');
    };

    hero.addEventListener('pointermove', updateFromPointer);
    hero.addEventListener('pointerleave', reset);
    reset();
  }

  function initRevealOnScroll() {
    const nodes = Array.from(doc.querySelectorAll('[data-reveal]'));
    if (!nodes.length) return;

    if (!('IntersectionObserver' in win) || prefersReducedMotion()) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -40px 0px' }
    );

    nodes.forEach((node) => observer.observe(node));
  }

  function makeHeading(eyebrowText, title, copy) {
    const head = doc.createElement('div');
    head.className = 'tool-card__head';

    const eyebrow = doc.createElement('p');
    eyebrow.className = 'tool-card__eyebrow';
    eyebrow.textContent = eyebrowText;

    const heading = doc.createElement('h3');
    heading.textContent = title;

    const intro = doc.createElement('p');
    intro.textContent = copy;

    head.append(eyebrow, heading, intro);
    return head;
  }

  function summarizeLabels(items, max = 2) {
    const list = items.filter(Boolean);
    if (!list.length) return '';
    if (list.length <= max) return humanJoin(list);
    return `${list.slice(0, max).join(', ')} +${list.length - max} more`;
  }

  function createToolCardShell(options) {
    const { sizeClass, eyebrow, title, copy, allowWide = true } = options;

    const card = doc.createElement('article');
    card.className = `tool-card ${sizeClass} is-collapsed`;

    const frame = doc.createElement('div');
    frame.className = 'tool-card__frame';

    const heading = makeHeading(eyebrow, title, copy);

    const controls = doc.createElement('div');
    controls.className = 'tool-card__controls';

    const toggleBtn = createButton('tool-secondary tool-card__toggle', 'Open tool');
    toggleBtn.setAttribute('aria-expanded', 'false');

    controls.appendChild(toggleBtn);

    let wideBtn = null;
    if (allowWide) {
      wideBtn = createButton('tool-ghost tool-card__widen', 'Open wide');
      controls.appendChild(wideBtn);
    }

    frame.append(heading, controls);

    const preview = doc.createElement('div');
    preview.className = 'tool-card__peek';
    const previewTitle = doc.createElement('strong');
    previewTitle.className = 'tool-card__peek-title';
    const previewMeta = doc.createElement('p');
    previewMeta.className = 'tool-card__peek-meta';
    preview.append(previewTitle, previewMeta);

    const content = doc.createElement('div');
    content.className = 'tool-card__content';
    content.hidden = true;

    function syncControls() {
      const expanded = card.classList.contains('is-expanded');
      const stretched = card.classList.contains('tool-card--stretched');

      toggleBtn.textContent = expanded ? 'Minimise' : 'Open tool';
      toggleBtn.setAttribute('aria-expanded', String(expanded));

      if (wideBtn) {
        wideBtn.textContent = !expanded ? 'Open wide' : stretched ? 'Standard width' : 'Widen';
      }
    }

    function setExpanded(nextExpanded) {
      if (!nextExpanded) {
        if (content.contains(doc.activeElement)) toggleBtn.focus();
        card.classList.remove('tool-card--stretched');
      }

      card.classList.toggle('is-expanded', nextExpanded);
      card.classList.toggle('is-collapsed', !nextExpanded);
      preview.hidden = nextExpanded;
      content.hidden = !nextExpanded;
      syncControls();
    }

    toggleBtn.addEventListener('click', () => {
      setExpanded(!card.classList.contains('is-expanded'));
    });

    if (wideBtn) {
      wideBtn.addEventListener('click', () => {
        if (!card.classList.contains('is-expanded')) {
          setExpanded(true);
          card.classList.add('tool-card--stretched');
          syncControls();
          return;
        }

        card.classList.toggle('tool-card--stretched');
        syncControls();
      });
    }

    card.append(frame, preview, content);
    syncControls();

    return {
      card,
      content,
      setExpanded,
      setPreview(titleText, metaText) {
        previewTitle.textContent = titleText || 'Ready when you are';
        previewMeta.textContent = metaText || 'Open the tool to work through the detail.';
      }
    };
  }

  function normalizeScopeState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const selectedRoleIds = uniqueList(Array.isArray(source.selectedRoleIds) ? source.selectedRoleIds : []).filter((id) => roleMap.has(id));
    const focusIds = uniqueList(Array.isArray(source.focusIds) ? source.focusIds : ['programme']).filter((id) => focusMap.has(id));

    return {
      selectedRoleIds,
      focusIds: focusIds.length ? focusIds : ['programme'],
      tone: source.tone === 'concise' ? 'concise' : 'full',
      projectName: String(source.projectName || ''),
      location: String(source.location || ''),
      startWindow: String(source.startWindow || ''),
      duration: String(source.duration || ''),
      priorities: String(source.priorities || ''),
      mustHaves: String(source.mustHaves || ''),
      outputText: String(source.outputText || ''),
      manualEdit: Boolean(source.manualEdit)
    };
  }

  function defaultScopeState() {
    return normalizeScopeState({});
  }

  function buildScopeCopy(state) {
    const roles = state.selectedRoleIds.map((id) => roleMap.get(id)).filter(Boolean);
    if (!roles.length) return '';

    const roleLabels = roles.map((role) => role.label);
    const focusLabels = state.focusIds.map((id) => focusMap.get(id)?.label).filter(Boolean);
    const focusNarratives = state.focusIds.map((id) => focusMap.get(id)?.narrative).filter(Boolean);
    const responsibilities = uniqueList(roles.flatMap((role) => role.responsibilities));
    const outcomes = uniqueList(roles.flatMap((role) => role.outcomes));
    const requirements = uniqueList(roles.flatMap((role) => role.requirements));
    const priorities = uniqueList(getLines(state.priorities));
    const mustHaves = uniqueList(getLines(state.mustHaves));

    const project = state.projectName.trim();
    const location = state.location.trim();
    const startWindow = state.startWindow.trim();
    const duration = state.duration.trim();

    const projectLine = project
      ? `${project}${location ? ` in ${location}` : ''}`
      : location
        ? `a live programme in ${location}`
        : 'a live mission-critical programme';

    const focusLine = focusNarratives.length
      ? humanJoin(focusNarratives)
      : 'delivery ownership, programme clarity and structured mobilisation';

    const roleSummary = roleLabels.length === 1 ? roleLabels[0] : humanJoin(roleLabels);
    const intro = `We are looking to engage ${roleSummary} support for ${projectLine}. The brief should prioritise ${focusLine}.`;

    const timelineBits = [];
    if (startWindow) timelineBits.push(`Preferred start / mobilisation window: ${startWindow}.`);
    if (duration) timelineBits.push(`Indicative engagement length: ${duration}.`);

    const dutyBullets = responsibilities.slice(0, state.tone === 'concise' ? 3 : 5);
    const outcomeBullets = priorities.length ? priorities.slice(0, state.tone === 'concise' ? 3 : 4) : outcomes.slice(0, state.tone === 'concise' ? 3 : 4);
    const requirementBullets = mustHaves.length ? mustHaves.slice(0, state.tone === 'concise' ? 3 : 4) : requirements.slice(0, state.tone === 'concise' ? 3 : 4);

    if (state.tone === 'concise') {
      const lines = [
        'Role requirement overview',
        intro,
        timelineBits.join(' '),
        '',
        'Key responsibilities',
        ...dutyBullets.map((item) => `- ${item}`),
        '',
        'Priority outcomes',
        ...outcomeBullets.map((item) => `- ${item}`),
        '',
        'Preferred profile',
        ...requirementBullets.map((item) => `- ${item}`)
      ].filter(Boolean);

      return lines.join('\n');
    }

    const fullerLines = [
      'Role requirement overview',
      `${intro} The appointment should help the client keep pace on delivery while maintaining a professional standard of reporting, coordination and handover readiness.`,
      timelineBits.join(' '),
      '',
      'Scope of work',
      ...dutyBullets.map((item) => `- ${item}`),
      '',
      'Immediate priorities',
      ...outcomeBullets.map((item) => `- ${item}`),
      '',
      `Focus areas: ${focusLabels.length ? humanJoin(focusLabels) : 'Programme focus'}.`,
      '',
      'Candidate profile',
      ...requirementBullets.map((item) => `- ${item}`),
      '',
      'Useful context for shortlist alignment',
      `- Project / package context: ${project || 'To be confirmed'}`,
      `- Location / site: ${location || 'To be confirmed'}`,
      `- Start / mobilisation: ${startWindow || 'To be confirmed'}`,
      `- Expected duration: ${duration || 'To be confirmed'}`
    ];

    return fullerLines.filter(Boolean).join('\n');
  }

  function insertScopeIntoForm(text, state) {
    const detailsField = doc.getElementById('role_details');
    const titleField = doc.getElementById('role_title');
    if (!detailsField || !text.trim()) return false;

    const cleanText = text.trim();
    detailsField.value = detailsField.value.trim() ? `${detailsField.value.trim()}\n\n${cleanText}` : cleanText;
    detailsField.dispatchEvent(new Event('input', { bubbles: true }));
    detailsField.dispatchEvent(new Event('change', { bubbles: true }));

    if (titleField && !String(titleField.value || '').trim()) {
      const roleLabels = state.selectedRoleIds.map((id) => roleMap.get(id)?.label).filter(Boolean);
      titleField.value = roleLabels.length > 1 ? `${humanJoin(roleLabels)} package support` : roleLabels[0] || '';
      titleField.dispatchEvent(new Event('input', { bubbles: true }));
      titleField.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const formHeading = doc.getElementById('clientFormTitle');
    if (formHeading && typeof formHeading.scrollIntoView === 'function') {
      formHeading.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    detailsField.focus();
    hmjToast('Scope inserted into the vacancy brief', 'success');
    return true;
  }

  function initScopeBuilder(container) {
    const cardUi = createToolCardShell({
      sizeClass: 'tool-card--wide',
      eyebrow: 'Briefing tool',
      title: 'Role scope builder',
      copy: 'Select one or more roles, add key context and generate copy you can edit, copy or send straight into the HMJ vacancy form.'
    });
    const { card, content, setPreview } = cardUi;

    const state = normalizeScopeState(readStorage(STORAGE_KEYS.scope, defaultScopeState()));
    if (!state.outputText && state.selectedRoleIds.length && !state.manualEdit) {
      state.outputText = buildScopeCopy(state);
    }

    const summary = doc.createElement('div');
    summary.className = 'scope-selection-summary';
    let summaryTitleText = 'No roles selected yet';
    let summaryMetaText = 'Pick the roles you want to blend into one working brief.';

    const roleGrid = doc.createElement('div');
    roleGrid.className = 'scope-role-grid';

    const configGrid = doc.createElement('div');
    configGrid.className = 'scope-config-grid';

    const projectField = createTextField('Project / programme', 'Example: Frankfurt data centre expansion', state.projectName);
    const locationField = createTextField('Location / site', 'Example: Frankfurt, DE', state.location);
    const startField = createTextField('Start / mobilisation', 'Example: April 2026', state.startWindow);
    const durationField = createTextField('Duration / package stage', 'Example: 6-month contract or fit-out stage 2', state.duration);
    const prioritiesField = createTextareaField('Delivery priorities', 'List key deliverables, problem areas or first-90-day priorities.', state.priorities, 4);
    const mustHavesField = createTextareaField('Must-have experience', 'List technical background, package exposure or stakeholder expectations.', state.mustHaves, 4);

    configGrid.append(
      projectField.wrapper,
      locationField.wrapper,
      startField.wrapper,
      durationField.wrapper,
      prioritiesField.wrapper,
      mustHavesField.wrapper
    );

    const focusLabel = doc.createElement('p');
    focusLabel.className = 'tool-helper';
    focusLabel.textContent = 'Choose the emphasis areas the brief should foreground.';

    const focusRow = doc.createElement('div');
    focusRow.className = 'focus-chip-row';

    const toneRow = doc.createElement('div');
    toneRow.className = 'tool-inline-row';
    const toneLabel = doc.createElement('strong');
    toneLabel.textContent = 'Output style';
    const toneToggle = doc.createElement('div');
    toneToggle.className = 'segmented-control';
    toneRow.append(toneLabel, toneToggle);

    const outputShell = doc.createElement('div');
    outputShell.className = 'scope-output-shell';
    const outputMeta = doc.createElement('div');
    outputMeta.className = 'scope-output-meta';
    const outputTitle = doc.createElement('strong');
    outputTitle.textContent = 'Editable scope draft';
    const outputStatus = doc.createElement('span');
    outputStatus.className = 'scope-status';
    outputMeta.append(outputTitle, outputStatus);

    const outputTextarea = doc.createElement('textarea');
    outputTextarea.className = 'tool-textarea scope-output-text';
    outputTextarea.placeholder = 'Select a role mix to start building an editable brief.';
    outputTextarea.value = state.outputText;

    const outputHelper = doc.createElement('p');
    outputHelper.className = 'tool-helper';
    outputHelper.textContent = 'You can edit the text directly. Use Regenerate if you want the builder to rewrite it from the current selections.';

    outputShell.append(outputMeta, outputTextarea, outputHelper);

    const actions = doc.createElement('div');
    actions.className = 'tool-action-row';

    const sampleBtn = createButton('tool-secondary', 'Use sample brief');
    const regenerateBtn = createButton('tool-ghost', 'Regenerate');
    const copyBtn = createButton('tool-secondary', 'Copy scope');
    const sendBtn = createButton('tool-secondary', 'Send to vacancy brief');
    const clearBtn = createButton('tool-ghost', 'Clear output');
    const resetBtn = createButton('tool-ghost', 'Reset builder');

    actions.append(sampleBtn, regenerateBtn, copyBtn, sendBtn, clearBtn, resetBtn);

    const roleButtons = new Map();
    ROLE_LIBRARY.forEach((role) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'scope-role';
      button.setAttribute('aria-pressed', String(state.selectedRoleIds.includes(role.id)));
      button.innerHTML = `<strong>${role.label}</strong><small>${role.summary}</small>`;
      button.addEventListener('click', () => {
        const next = new Set(state.selectedRoleIds);
        if (next.has(role.id)) next.delete(role.id);
        else next.add(role.id);
        state.selectedRoleIds = Array.from(next);
        syncScopeOutput();
      });
      roleButtons.set(role.id, button);
      roleGrid.appendChild(button);
    });

    const focusButtons = new Map();
    FOCUS_LIBRARY.forEach((focus) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'focus-chip';
      button.textContent = focus.label;
      button.setAttribute('aria-pressed', String(state.focusIds.includes(focus.id)));
      button.addEventListener('click', () => {
        const next = new Set(state.focusIds);
        if (next.has(focus.id)) next.delete(focus.id);
        else next.add(focus.id);
        state.focusIds = Array.from(next);
        if (!state.focusIds.length) state.focusIds = ['programme'];
        syncScopeOutput();
      });
      focusButtons.set(focus.id, button);
      focusRow.appendChild(button);
    });

    ['full', 'concise'].forEach((tone) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = tone === 'full' ? 'Generate fuller version' : 'Generate concise version';
      button.setAttribute('aria-pressed', String(state.tone === tone));
      button.addEventListener('click', () => {
        state.tone = tone;
        state.manualEdit = false;
        syncScopeOutput();
      });
      toneToggle.appendChild(button);
    });

    function persist() {
      writeStorage(STORAGE_KEYS.scope, state);
    }

    function updateSummary() {
      const roleLabels = state.selectedRoleIds.map((id) => roleMap.get(id)?.label).filter(Boolean);
      const focusLabels = state.focusIds.map((id) => focusMap.get(id)?.label).filter(Boolean);
      summary.innerHTML = '';
      const title = doc.createElement('strong');
      summaryTitleText = roleLabels.length ? `${roleLabels.length} role${roleLabels.length > 1 ? 's' : ''} selected` : 'No roles selected yet';
      title.textContent = summaryTitleText;
      const meta = doc.createElement('span');
      summaryMetaText = roleLabels.length
        ? `${summarizeLabels(roleLabels)}${focusLabels.length ? ` | ${summarizeLabels(focusLabels)}` : ''}`
        : 'Pick the roles you want to blend into one working brief.';
      meta.textContent = roleLabels.length
        ? `${humanJoin(roleLabels)}${focusLabels.length ? ` | ${humanJoin(focusLabels)}` : ''}`
        : summaryMetaText;
      summary.append(title, meta);
    }

    function updateRoleButtons() {
      roleButtons.forEach((button, id) => {
        button.setAttribute('aria-pressed', String(state.selectedRoleIds.includes(id)));
      });
      focusButtons.forEach((button, id) => {
        button.setAttribute('aria-pressed', String(state.focusIds.includes(id)));
      });
      Array.from(toneToggle.children).forEach((button, index) => {
        const tone = index === 0 ? 'full' : 'concise';
        button.setAttribute('aria-pressed', String(state.tone === tone));
      });
    }

    function updateStatus() {
      if (!state.selectedRoleIds.length && !state.outputText.trim()) {
        outputStatus.textContent = 'Select roles to start';
      } else if (state.manualEdit) {
        outputStatus.textContent = 'Edited manually';
      } else if (state.outputText.trim()) {
        outputStatus.textContent = 'Ready to copy';
      } else {
        outputStatus.textContent = 'Awaiting detail';
      }

      const hasOutput = Boolean(state.outputText.trim());
      copyBtn.disabled = !hasOutput;
      clearBtn.disabled = !hasOutput;
      sendBtn.disabled = !hasOutput;
      regenerateBtn.disabled = !state.selectedRoleIds.length;
      setPreview(summaryTitleText, `${summaryMetaText} | ${outputStatus.textContent}`);
    }

    function applyStateToFields() {
      projectField.input.value = state.projectName;
      locationField.input.value = state.location;
      startField.input.value = state.startWindow;
      durationField.input.value = state.duration;
      prioritiesField.input.value = state.priorities;
      mustHavesField.input.value = state.mustHaves;
      outputTextarea.value = state.outputText;
    }

    function syncScopeOutput(options = {}) {
      const { readInputs = true, syncFields = false } = options;

      if (readInputs) {
        state.projectName = projectField.input.value;
        state.location = locationField.input.value;
        state.startWindow = startField.input.value;
        state.duration = durationField.input.value;
        state.priorities = prioritiesField.input.value;
        state.mustHaves = mustHavesField.input.value;
      }

      if (!state.manualEdit) {
        state.outputText = buildScopeCopy(state);
      }

      updateSummary();
      updateRoleButtons();
      if (syncFields) {
        applyStateToFields();
      } else if (doc.activeElement !== outputTextarea) {
        outputTextarea.value = state.outputText;
      }
      updateStatus();
      persist();
    }

    [projectField.input, locationField.input, startField.input, durationField.input, prioritiesField.input, mustHavesField.input].forEach((input) => {
      input.addEventListener('input', () => {
        if (state.manualEdit && !state.outputText.trim()) state.manualEdit = false;
        syncScopeOutput();
      });
    });

    outputTextarea.addEventListener('input', () => {
      state.outputText = outputTextarea.value;
      state.manualEdit = true;
      updateStatus();
      persist();
    });

    sampleBtn.addEventListener('click', () => {
      Object.assign(state, {
        selectedRoleIds: ['electrical-project-manager', 'commissioning-lead'],
        focusIds: ['programme', 'commissioning', 'package'],
        tone: 'full',
        projectName: 'European hyperscale data centre fit-out',
        location: 'Frankfurt, Germany',
        startWindow: 'April 2026',
        duration: '6-month contract with extension potential',
        priorities: 'Stabilise package coordination ahead of energisation.\nImprove readiness for witness testing and handover.\nProvide clear weekly reporting on blockers and recovery actions.',
        mustHaves: 'Recent live data centre or equivalent mission-critical experience.\nStrong coordination across subcontractors, commissioning teams and client stakeholders.\nComfort leading under programme pressure.',
        manualEdit: false
      });
      state.outputText = buildScopeCopy(state);
      syncScopeOutput({ readInputs: false, syncFields: true });
      hmjToast('Sample brief loaded', 'success');
    });

    regenerateBtn.addEventListener('click', () => {
      state.manualEdit = false;
      state.outputText = buildScopeCopy(state);
      syncScopeOutput();
      hmjToast('Scope regenerated from the current selections', 'success');
    });

    clearBtn.addEventListener('click', () => {
      state.outputText = '';
      state.manualEdit = true;
      outputTextarea.value = '';
      updateStatus();
      persist();
      hmjToast('Scope output cleared', 'info');
    });

    resetBtn.addEventListener('click', () => {
      Object.assign(state, defaultScopeState());
      syncScopeOutput({ readInputs: false, syncFields: true });
      hmjToast('Role scope builder reset', 'info');
    });

    copyBtn.addEventListener('click', async () => {
      await copyText(state.outputText, 'Scope copied', copyBtn);
    });

    sendBtn.addEventListener('click', () => {
      insertScopeIntoForm(state.outputText, state);
    });

    content.append(
      summary,
      roleGrid,
      focusLabel,
      focusRow,
      toneRow,
      configGrid,
      outputShell,
      actions
    );

    container.appendChild(card);
    syncScopeOutput({ readInputs: false, syncFields: true });
  }

  function defaultBudgetState() {
    return {
      mode: 'contractor',
      rateBasis: 'daily',
      urgency: 'standard',
      contractor: {
        duration: '12',
        rate: '650',
        hires: '2',
        feePct: '12'
      },
      permanent: {
        salary: '85000',
        hires: '1',
        feePct: '18'
      }
    };
  }

  function normalizeBudgetState(raw) {
    const defaults = defaultBudgetState();
    const source = raw && typeof raw === 'object' ? raw : {};

    return {
      mode: source.mode === 'permanent' ? 'permanent' : defaults.mode,
      rateBasis: source.rateBasis === 'weekly' ? 'weekly' : defaults.rateBasis,
      urgency: urgencyMap.has(source.urgency) ? source.urgency : defaults.urgency,
      contractor: {
        duration: String(source.contractor?.duration ?? defaults.contractor.duration),
        rate: String(source.contractor?.rate ?? defaults.contractor.rate),
        hires: String(source.contractor?.hires ?? defaults.contractor.hires),
        feePct: String(source.contractor?.feePct ?? defaults.contractor.feePct)
      },
      permanent: {
        salary: String(source.permanent?.salary ?? defaults.permanent.salary),
        hires: String(source.permanent?.hires ?? defaults.permanent.hires),
        feePct: String(source.permanent?.feePct ?? defaults.permanent.feePct)
      }
    };
  }

  function createBudgetControl(labelText, config) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'budget-control';

    const head = doc.createElement('div');
    head.className = 'budget-control__head';
    const label = doc.createElement('label');
    label.textContent = labelText;
    const hint = doc.createElement('span');
    hint.className = 'tool-helper';
    hint.textContent = config.hint || '';
    head.append(label, hint);

    const pair = doc.createElement('div');
    pair.className = 'budget-inline-inputs';

    const range = doc.createElement('input');
    range.type = 'range';

    const number = doc.createElement('input');
    number.type = 'number';
    number.className = 'tool-input';

    pair.append(range, number);
    wrapper.append(head, pair);

    function setBounds(bounds) {
      range.min = String(bounds.min);
      range.max = String(bounds.max);
      range.step = String(bounds.step);
      number.min = String(bounds.min);
      number.max = String(bounds.max);
      number.step = String(bounds.step);
    }

    function setValue(rawValue, syncRange = true) {
      if (rawValue === '' || rawValue == null) {
        number.value = '';
        return;
      }
      const numeric = clampNumber(rawValue, Number(range.min), Number(range.max), Number(range.min));
      number.value = String(numeric);
      if (syncRange) range.value = String(numeric);
    }

    function getNumber() {
      if (number.value === '') return null;
      return Number(number.value);
    }

    setBounds(config);
    setValue(config.value);

    return { wrapper, label, hint, range, number, setBounds, setValue, getNumber };
  }

  function computeBudgetSummary(state) {
    const urgency = urgencyMap.get(state.urgency) || urgencyMap.get('standard');

    if (state.mode === 'contractor') {
      const duration = Number(state.contractor.duration);
      const rate = Number(state.contractor.rate);
      const hires = Number(state.contractor.hires);
      const feePct = Number(state.contractor.feePct);

      if (![duration, rate, hires, feePct].every(Number.isFinite) || duration <= 0 || rate <= 0 || hires <= 0 || feePct <= 0) {
        return null;
      }

      const weeklyRate = state.rateBasis === 'daily' ? rate * 5 : rate;
      const midpoint = weeklyRate * duration * hires * urgency.multiplier;
      const low = midpoint * 0.93;
      const high = midpoint * 1.08;
      const fee = midpoint * (feePct / 100);
      const total = midpoint + fee;

      return {
        title: 'Indicative contractor estimate',
        low,
        midpoint,
        high,
        fee,
        total,
        note: `Based on ${duration} week${duration === 1 ? '' : 's'}, ${hires} hire${hires === 1 ? '' : 's'}, ${formatCurrency(rate)} per ${state.rateBasis === 'daily' ? 'day' : 'week'} and ${urgency.label.toLowerCase()} market pressure.`,
        summary: [
          `Engagement model: Contractor`,
          `Rate basis: ${state.rateBasis === 'daily' ? 'Daily' : 'Weekly'} (${formatCurrency(rate)} per ${state.rateBasis === 'daily' ? 'day' : 'week'})`,
          `Duration: ${duration} week${duration === 1 ? '' : 's'}`,
          `Quantity of hires: ${hires}`,
          `Urgency factor: ${urgency.label} (${urgency.note})`,
          `HMJ fee assumption: ${feePct}%`
        ]
      };
    }

    const salary = Number(state.permanent.salary);
    const hires = Number(state.permanent.hires);
    const feePct = Number(state.permanent.feePct);

    if (![salary, hires, feePct].every(Number.isFinite) || salary <= 0 || hires <= 0 || feePct <= 0) {
      return null;
    }

    const midpoint = salary * hires * urgency.multiplier;
    const low = midpoint * 0.96;
    const high = midpoint * 1.06;
    const fee = midpoint * (feePct / 100);
    const total = midpoint + fee;

    return {
      title: 'Indicative permanent estimate',
      low,
      midpoint,
      high,
      fee,
      total,
      note: `Based on ${hires} permanent hire${hires === 1 ? '' : 's'}, ${formatCurrency(salary)} annual salary and ${urgency.label.toLowerCase()} search complexity.`,
      summary: [
        'Engagement model: Permanent',
        `Annual salary basis: ${formatCurrency(salary)}`,
        `Quantity of hires: ${hires}`,
        `Urgency factor: ${urgency.label} (${urgency.note})`,
        `HMJ fee assumption: ${feePct}%`
      ]
    };
  }

  function initBudgetEstimator(container) {
    const cardUi = createToolCardShell({
      sizeClass: 'tool-card--compact',
      eyebrow: 'Planning tool',
      title: 'Budget & rate estimator',
      copy: 'Switch between contractor and permanent modelling, edit every value directly and copy a clean estimate summary for internal planning.'
    });
    const { card, content, setPreview } = cardUi;

    const state = normalizeBudgetState(readStorage(STORAGE_KEYS.budget, defaultBudgetState()));
    let currentSummary = null;

    const modeRow = doc.createElement('div');
    modeRow.className = 'budget-mode-row';
    const modeLabel = doc.createElement('strong');
    modeLabel.textContent = 'Engagement model';
    const modeToggle = doc.createElement('div');
    modeToggle.className = 'segmented-control';
    modeRow.append(modeLabel, modeToggle);

    const urgencyRow = doc.createElement('div');
    urgencyRow.className = 'budget-mode-row';
    const urgencyLabel = doc.createElement('strong');
    urgencyLabel.textContent = 'Urgency / fill difficulty';
    const urgencyToggle = doc.createElement('div');
    urgencyToggle.className = 'segmented-control';
    urgencyRow.append(urgencyLabel, urgencyToggle);

    const contractorControls = doc.createElement('div');
    contractorControls.className = 'budget-controls';

    const rateBasisRow = doc.createElement('div');
    rateBasisRow.className = 'budget-mode-row';
    const rateBasisLabel = doc.createElement('strong');
    rateBasisLabel.textContent = 'Rate basis';
    const rateBasisToggle = doc.createElement('div');
    rateBasisToggle.className = 'segmented-control';
    rateBasisRow.append(rateBasisLabel, rateBasisToggle);

    const durationControl = createBudgetControl('Duration (weeks)', {
      min: 1,
      max: 52,
      step: 1,
      value: state.contractor.duration,
      hint: 'Edit directly or use the slider'
    });

    const rateControl = createBudgetControl('Rate', {
      min: 150,
      max: 2000,
      step: 10,
      value: state.contractor.rate,
      hint: 'Daily or weekly basis'
    });

    const hiresControl = createBudgetControl('Quantity of hires', {
      min: 1,
      max: 20,
      step: 1,
      value: state.contractor.hires,
      hint: 'Use for single or multi-hire packages'
    });

    const feeControl = createBudgetControl('HMJ fee (%)', {
      min: 5,
      max: 30,
      step: 1,
      value: state.contractor.feePct,
      hint: 'Adjust if you want to model a different fee assumption'
    });

    contractorControls.append(rateBasisRow, durationControl.wrapper, rateControl.wrapper, hiresControl.wrapper, feeControl.wrapper);

    const permanentControls = doc.createElement('div');
    permanentControls.className = 'budget-controls';

    const salaryControl = createBudgetControl('Annual salary (GBP)', {
      min: 30000,
      max: 250000,
      step: 1000,
      value: state.permanent.salary,
      hint: 'Indicative annual salary basis'
    });

    const permanentHiresControl = createBudgetControl('Quantity of hires', {
      min: 1,
      max: 20,
      step: 1,
      value: state.permanent.hires,
      hint: 'Use for single or batch permanent searches'
    });

    const permanentFeeControl = createBudgetControl('HMJ fee (%)', {
      min: 5,
      max: 35,
      step: 1,
      value: state.permanent.feePct,
      hint: 'Useful when internal budgets vary by search type'
    });

    permanentControls.append(salaryControl.wrapper, permanentHiresControl.wrapper, permanentFeeControl.wrapper);

    const summaryCard = doc.createElement('div');
    summaryCard.className = 'budget-summary';
    const summaryTitle = doc.createElement('strong');
    summaryTitle.textContent = 'Indicative estimate';
    const metricsGrid = doc.createElement('div');
    metricsGrid.className = 'budget-metrics';
    const breakdownList = doc.createElement('ul');
    breakdownList.className = 'budget-breakdown';
    const note = doc.createElement('p');
    note.className = 'budget-note';
    summaryCard.append(summaryTitle, metricsGrid, breakdownList, note);

    const actions = doc.createElement('div');
    actions.className = 'tool-action-row';
    const copyEstimateBtn = createButton('tool-secondary', 'Copy estimate');
    const copySummaryBtn = createButton('tool-ghost', 'Copy summary');
    const clearBtn = createButton('tool-ghost', 'Clear values');
    const resetBtn = createButton('tool-ghost', 'Reset defaults');
    actions.append(copyEstimateBtn, copySummaryBtn, clearBtn, resetBtn);

    const helper = doc.createElement('p');
    helper.className = 'tool-helper';
    helper.textContent = 'These figures are indicative planning ranges rather than a formal quotation. They help frame approvals and brief quality before you speak to HMJ.';

    const modeButtons = new Map();
    ['contractor', 'permanent'].forEach((mode) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = mode === 'contractor' ? 'Contractor' : 'Permanent';
      button.setAttribute('aria-pressed', String(state.mode === mode));
      button.addEventListener('click', () => {
        state.mode = mode;
        render();
      });
      modeButtons.set(mode, button);
      modeToggle.appendChild(button);
    });

    const urgencyButtons = new Map();
    URGENCY_LIBRARY.forEach((urgency) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = urgency.label;
      button.setAttribute('aria-pressed', String(state.urgency === urgency.id));
      button.addEventListener('click', () => {
        state.urgency = urgency.id;
        render();
      });
      urgencyButtons.set(urgency.id, button);
      urgencyToggle.appendChild(button);
    });

    const rateBasisButtons = new Map();
    ['daily', 'weekly'].forEach((basis) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = basis === 'daily' ? 'Daily' : 'Weekly';
      button.setAttribute('aria-pressed', String(state.rateBasis === basis));
      button.addEventListener('click', () => {
        if (state.rateBasis === basis) return;
        const currentRate = Number(state.contractor.rate || 0);
        if (currentRate > 0) {
          state.contractor.rate = String(basis === 'weekly' ? currentRate * 5 : Math.round(currentRate / 5));
        }
        state.rateBasis = basis;
        render();
      });
      rateBasisButtons.set(basis, button);
      rateBasisToggle.appendChild(button);
    });

    function persist() {
      writeStorage(STORAGE_KEYS.budget, state);
    }

    function syncControl(control, rawValue, options) {
      const value = String(rawValue ?? '');
      control.setBounds(options);
      control.setValue(value, true);
    }

    function updateRateControl() {
      const bounds =
        state.rateBasis === 'daily'
          ? { min: 150, max: 2000, step: 10 }
          : { min: 750, max: 10000, step: 50 };
      rateControl.label.textContent = state.rateBasis === 'daily' ? 'Rate (GBP per day)' : 'Rate (GBP per week)';
      rateControl.hint.textContent = state.rateBasis === 'daily' ? 'Daily day-rate basis' : 'Weekly contract rate basis';
      rateControl.setBounds(bounds);
      if (state.contractor.rate !== '') {
        const clamped = clampNumber(state.contractor.rate, bounds.min, bounds.max, bounds.min);
        state.contractor.rate = String(clamped);
      }
      rateControl.setValue(state.contractor.rate, true);
    }

    function metricCard(label, value) {
      const item = doc.createElement('div');
      item.className = 'budget-metric';
      const title = doc.createElement('span');
      title.textContent = label;
      const amount = doc.createElement('strong');
      amount.textContent = value;
      item.append(title, amount);
      return item;
    }

    function buildEstimateText() {
      if (!currentSummary) return '';
      return [
        currentSummary.title,
        `Lower estimate: ${formatCurrency(currentSummary.low)}`,
        `Indicative midpoint: ${formatCurrency(currentSummary.midpoint)}`,
        `Upper estimate: ${formatCurrency(currentSummary.high)}`,
        `HMJ fee estimate: ${formatCurrency(currentSummary.fee)}`,
        `Estimated total incl. fee: ${formatCurrency(currentSummary.total)}`,
        '',
        ...currentSummary.summary,
        '',
        currentSummary.note
      ].join('\n');
    }

    function buildSummaryText() {
      if (!currentSummary) return '';
      return `${currentSummary.title}: ${formatCurrency(currentSummary.low)} to ${formatCurrency(currentSummary.high)} with an indicative midpoint of ${formatCurrency(currentSummary.midpoint)} and HMJ fee estimate of ${formatCurrency(currentSummary.fee)}. ${currentSummary.note}`;
    }

    function renderSummary() {
      currentSummary = computeBudgetSummary(state);
      metricsGrid.innerHTML = '';
      breakdownList.innerHTML = '';

      if (!currentSummary) {
        summaryTitle.textContent = 'Indicative estimate';
        note.textContent = 'Enter or restore the core values to generate an estimate.';
        metricsGrid.appendChild(metricCard('Status', 'Awaiting values'));
        copyEstimateBtn.disabled = true;
        copySummaryBtn.disabled = true;
        setPreview('Estimate waiting for values', 'Open the estimator to model rates, fees and urgency.');
        return;
      }

      summaryTitle.textContent = currentSummary.title;
      metricsGrid.append(
        metricCard('Lower estimate', formatCurrency(currentSummary.low)),
        metricCard('Indicative midpoint', formatCurrency(currentSummary.midpoint)),
        metricCard('Upper estimate', formatCurrency(currentSummary.high)),
        metricCard('HMJ fee estimate', formatCurrency(currentSummary.fee)),
        metricCard('Total incl. fee', formatCurrency(currentSummary.total))
      );

      currentSummary.summary.forEach((entry) => {
        const [label, ...rest] = entry.split(':');
        const item = doc.createElement('li');
        const left = doc.createElement('span');
        left.textContent = label;
        const right = doc.createElement('strong');
        right.textContent = rest.join(':').trim() || '';
        item.append(left, right);
        breakdownList.appendChild(item);
      });

      note.textContent = currentSummary.note;
      copyEstimateBtn.disabled = false;
      copySummaryBtn.disabled = false;

      if (state.mode === 'contractor') {
        const duration = Number(state.contractor.duration);
        const rate = Number(state.contractor.rate);
        const hires = Number(state.contractor.hires);
        setPreview(
          currentSummary.title,
          `${duration} wk | ${formatCurrency(rate)} per ${state.rateBasis === 'daily' ? 'day' : 'week'} | ${hires} hire${hires === 1 ? '' : 's'} | ${formatCurrency(currentSummary.low)} to ${formatCurrency(currentSummary.high)}`
        );
        return;
      }

      const salary = Number(state.permanent.salary);
      const hires = Number(state.permanent.hires);
      setPreview(
        currentSummary.title,
        `${formatCurrency(salary)} salary | ${hires} hire${hires === 1 ? '' : 's'} | ${formatCurrency(currentSummary.low)} to ${formatCurrency(currentSummary.high)}`
      );
    }

    function render() {
      modeButtons.forEach((button, mode) => {
        button.setAttribute('aria-pressed', String(state.mode === mode));
      });
      urgencyButtons.forEach((button, urgencyId) => {
        button.setAttribute('aria-pressed', String(state.urgency === urgencyId));
      });
      rateBasisButtons.forEach((button, basis) => {
        button.setAttribute('aria-pressed', String(state.rateBasis === basis));
      });

      contractorControls.hidden = state.mode !== 'contractor';
      permanentControls.hidden = state.mode !== 'permanent';

      durationControl.setValue(state.contractor.duration, true);
      hiresControl.setValue(state.contractor.hires, true);
      feeControl.setValue(state.contractor.feePct, true);
      salaryControl.setValue(state.permanent.salary, true);
      permanentHiresControl.setValue(state.permanent.hires, true);
      permanentFeeControl.setValue(state.permanent.feePct, true);
      updateRateControl();

      renderSummary();
      persist();
    }

    function wireControl(control, getter, setter) {
      control.range.addEventListener('input', () => {
        const value = String(clampNumber(control.range.value, Number(control.range.min), Number(control.range.max), Number(control.range.min)));
        setter(value);
        control.number.value = value;
        render();
      });

      control.number.addEventListener('input', () => {
        const rawValue = control.number.value.trim();
        if (!rawValue) {
          setter('');
          render();
          return;
        }
        const numeric = clampNumber(rawValue, Number(control.number.min), Number(control.number.max), Number(control.number.min));
        setter(String(numeric));
        control.range.value = String(numeric);
        render();
      });

      control.number.addEventListener('blur', () => {
        const value = getter();
        control.setValue(value === '' ? '' : value, true);
      });
    }

    wireControl(durationControl, () => state.contractor.duration, (value) => {
      state.contractor.duration = value;
    });
    wireControl(rateControl, () => state.contractor.rate, (value) => {
      state.contractor.rate = value;
    });
    wireControl(hiresControl, () => state.contractor.hires, (value) => {
      state.contractor.hires = value;
    });
    wireControl(feeControl, () => state.contractor.feePct, (value) => {
      state.contractor.feePct = value;
    });
    wireControl(salaryControl, () => state.permanent.salary, (value) => {
      state.permanent.salary = value;
    });
    wireControl(permanentHiresControl, () => state.permanent.hires, (value) => {
      state.permanent.hires = value;
    });
    wireControl(permanentFeeControl, () => state.permanent.feePct, (value) => {
      state.permanent.feePct = value;
    });

    copyEstimateBtn.addEventListener('click', async () => {
      await copyText(buildEstimateText(), 'Estimate copied', copyEstimateBtn);
    });

    copySummaryBtn.addEventListener('click', async () => {
      await copyText(buildSummaryText(), 'Summary copied', copySummaryBtn);
    });

    clearBtn.addEventListener('click', () => {
      if (state.mode === 'contractor') {
        state.contractor.duration = '';
        state.contractor.rate = '';
        state.contractor.hires = '';
        state.contractor.feePct = '';
      } else {
        state.permanent.salary = '';
        state.permanent.hires = '';
        state.permanent.feePct = '';
      }
      render();
      hmjToast('Calculator values cleared', 'info');
    });

    resetBtn.addEventListener('click', () => {
      const resetState = defaultBudgetState();
      Object.assign(state, resetState);
      state.contractor = { ...resetState.contractor };
      state.permanent = { ...resetState.permanent };
      render();
      hmjToast('Budget estimator reset', 'info');
    });

    content.append(
      modeRow,
      urgencyRow,
      contractorControls,
      permanentControls,
      summaryCard,
      actions,
      helper
    );

    container.appendChild(card);
    render();
  }

  function defaultChecklistState() {
    return {
      groups: CHECKLIST_TEMPLATE.map((group) => ({
        id: group.id,
        label: group.label,
        items: group.items.map((item) => ({
          id: item.id,
          label: item.label,
          description: item.description,
          checked: false,
          custom: false
        }))
      }))
    };
  }

  function normalizeChecklistState(raw) {
    const defaults = defaultChecklistState();
    const sourceGroups = Array.isArray(raw?.groups) ? raw.groups : [];

    return {
      groups: defaults.groups.map((defaultGroup) => {
        const foundGroup = sourceGroups.find((group) => group.id === defaultGroup.id);
        const groupItems = Array.isArray(foundGroup?.items) ? foundGroup.items : [];
        const mergedDefaultItems = defaultGroup.items.map((defaultItem) => {
          const foundItem = groupItems.find((item) => item.id === defaultItem.id);
          return {
            ...defaultItem,
            checked: Boolean(foundItem?.checked)
          };
        });

        const customItems = groupItems
          .filter((item) => item && item.custom)
          .map((item) => ({
            id: item.id || createId('custom-check'),
            label: String(item.label || 'Custom item'),
            description: String(item.description || 'Custom checklist item'),
            checked: Boolean(item.checked),
            custom: true
          }));

        return {
          id: defaultGroup.id,
          label: defaultGroup.label,
          items: [...mergedDefaultItems, ...customItems]
        };
      })
    };
  }

  function initChecklist(container) {
    const cardUi = createToolCardShell({
      sizeClass: 'tool-card--full',
      eyebrow: 'Readiness tool',
      title: 'Document checklist',
      copy: 'Track commercial, onboarding, access and project documentation items, add your own checklist points and copy a clean readiness summary.',
      allowWide: false
    });
    const { card, content, setPreview } = cardUi;

    const state = normalizeChecklistState(readStorage(STORAGE_KEYS.checklist, defaultChecklistState()));

    const summaryCard = doc.createElement('div');
    summaryCard.className = 'checklist-summary-card';
    const summaryRow = doc.createElement('div');
    summaryRow.className = 'checklist-summary-row';
    const summaryMeta = doc.createElement('div');
    summaryMeta.className = 'checklist-summary-meta';
    const summaryTitle = doc.createElement('strong');
    const summaryText = doc.createElement('span');
    summaryText.className = 'tool-helper';
    summaryMeta.append(summaryTitle, summaryText);
    const statusPill = doc.createElement('span');
    statusPill.className = 'checklist-status-pill';
    summaryRow.append(summaryMeta, statusPill);
    const progress = doc.createElement('div');
    progress.className = 'checklist-progress';
    const progressFill = doc.createElement('span');
    progress.appendChild(progressFill);
    const missingText = doc.createElement('p');
    missingText.className = 'checklist-missing';
    summaryCard.append(summaryRow, progress, missingText);

    const layout = doc.createElement('div');
    layout.className = 'checklist-layout';

    const groupsWrap = doc.createElement('div');
    groupsWrap.className = 'checklist-groups';

    const customWrap = doc.createElement('div');
    customWrap.className = 'checklist-custom';
    const customTitle = doc.createElement('strong');
    customTitle.textContent = 'Add a custom checklist item';
    const customHelper = doc.createElement('p');
    customHelper.className = 'tool-helper';
    customHelper.textContent = 'Useful when a specific client, site or procurement route needs extra steps.';
    const customGrid = doc.createElement('div');
    customGrid.className = 'checklist-custom-grid';
    const customInput = doc.createElement('input');
    customInput.type = 'text';
    customInput.className = 'tool-input';
    customInput.placeholder = 'Add a custom item';
    const customSelect = doc.createElement('select');
    customSelect.className = 'tool-select';
    const addBtn = createButton('tool-secondary', 'Add item');
    customGrid.append(customInput, customSelect, addBtn);
    customWrap.append(customTitle, customHelper, customGrid);

    const actions = doc.createElement('div');
    actions.className = 'tool-action-row';
    const copyBtn = createButton('tool-secondary', 'Copy summary');
    const clearBtn = createButton('tool-ghost', 'Clear ticks');
    const resetBtn = createButton('tool-ghost', 'Reset checklist');
    actions.append(copyBtn, clearBtn, resetBtn);

    function persist() {
      writeStorage(STORAGE_KEYS.checklist, state);
    }

    function getTotals() {
      const allItems = state.groups.flatMap((group) => group.items);
      const complete = allItems.filter((item) => item.checked).length;
      return { total: allItems.length, complete, allItems };
    }

    function getMissingItems() {
      return state.groups
        .flatMap((group) => group.items.filter((item) => !item.checked).map((item) => `${group.label}: ${item.label}`));
    }

    function buildSummaryText() {
      const totals = getTotals();
      const missingItems = getMissingItems();
      const status = statusPill.textContent;
      return [
        'Client readiness checklist',
        `Completion: ${totals.complete} of ${totals.total}`,
        `Status: ${status}`,
        '',
        missingItems.length ? 'Missing items' : 'Missing items: None',
        ...(missingItems.length ? missingItems.map((item) => `- ${item}`) : []),
        '',
        'Completed items',
        ...state.groups.flatMap((group) => group.items.filter((item) => item.checked).map((item) => `- ${group.label}: ${item.label}`))
      ].join('\n');
    }

    function renderSummary() {
      const totals = getTotals();
      const percent = totals.total ? Math.round((totals.complete / totals.total) * 100) : 0;
      const missingItems = getMissingItems();

      summaryTitle.textContent = `${totals.complete} of ${totals.total} complete`;
      summaryText.textContent =
        percent === 100
          ? 'Everything is marked complete and ready to share.'
          : percent >= 75
            ? 'Nearly ready. A few final items remain.'
            : percent > 0
              ? 'In progress. Use the checklist to tighten onboarding readiness.'
              : 'Nothing marked yet. Start checking items as they are confirmed.';

      statusPill.textContent =
        percent === 100 ? 'Ready to send' : percent >= 75 ? 'Nearly ready' : percent > 0 ? 'In progress' : 'Not started';
      progressFill.style.width = `${percent}%`;
      missingText.textContent = missingItems.length
        ? `Missing items: ${missingItems.slice(0, 4).join(' | ')}${missingItems.length > 4 ? ` +${missingItems.length - 4} more` : ''}`
        : 'No missing items. The current checklist is complete.';

      copyBtn.disabled = totals.total === 0;
      setPreview(
        `${totals.complete} of ${totals.total} complete`,
        missingItems.length
          ? `${statusPill.textContent} | ${missingItems.length} item${missingItems.length === 1 ? '' : 's'} still open`
          : `${statusPill.textContent} | All checklist items are marked complete`
      );
    }

    function renderGroups() {
      groupsWrap.innerHTML = '';
      customSelect.innerHTML = '';

      state.groups.forEach((group) => {
        const option = doc.createElement('option');
        option.value = group.id;
        option.textContent = group.label;
        customSelect.appendChild(option);

        const wrapper = doc.createElement('section');
        wrapper.className = 'checklist-group';

        const head = doc.createElement('div');
        head.className = 'checklist-group__head';
        const title = doc.createElement('h4');
        title.textContent = group.label;
        const count = doc.createElement('span');
        count.className = 'checklist-group__count';
        const complete = group.items.filter((item) => item.checked).length;
        count.textContent = `${complete}/${group.items.length}`;
        head.append(title, count);

        const list = doc.createElement('div');
        list.className = 'checklist-item-list';

        group.items.forEach((item) => {
          const row = doc.createElement('div');
          row.className = 'checklist-item';
          if (item.checked) row.classList.add('is-checked');

          const checkbox = doc.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = item.checked;
          checkbox.setAttribute('aria-label', item.label);
          checkbox.addEventListener('change', () => {
            item.checked = checkbox.checked;
            persist();
            render();
          });

          const text = doc.createElement('div');
          text.className = 'checklist-item__text';
          const itemLabel = doc.createElement('strong');
          itemLabel.textContent = item.label;
          const itemDescription = doc.createElement('span');
          itemDescription.textContent = item.description;
          text.append(itemLabel, itemDescription);

          row.append(checkbox, text);

          if (item.custom) {
            const removeBtn = createButton('tool-ghost', 'Remove');
            removeBtn.addEventListener('click', () => {
              group.items = group.items.filter((entry) => entry.id !== item.id);
              persist();
              render();
            });
            row.appendChild(removeBtn);
          }

          list.appendChild(row);
        });

        wrapper.append(head, list);
        groupsWrap.appendChild(wrapper);
      });
    }

    function render() {
      renderGroups();
      renderSummary();
      persist();
    }

    addBtn.addEventListener('click', () => {
      const label = customInput.value.trim();
      const groupId = customSelect.value;
      if (!label) {
        hmjToast('Add an item label first', 'warning');
        return;
      }
      const targetGroup = state.groups.find((group) => group.id === groupId) || state.groups[0];
      targetGroup.items.push({
        id: createId('custom-check'),
        label,
        description: 'Custom checklist item',
        checked: false,
        custom: true
      });
      customInput.value = '';
      render();
      hmjToast('Checklist item added', 'success');
    });

    customInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addBtn.click();
      }
    });

    copyBtn.addEventListener('click', async () => {
      await copyText(buildSummaryText(), 'Checklist summary copied', copyBtn);
    });

    clearBtn.addEventListener('click', () => {
      state.groups.forEach((group) => {
        group.items.forEach((item) => {
          item.checked = false;
        });
      });
      render();
      hmjToast('Checklist ticks cleared', 'info');
    });

    resetBtn.addEventListener('click', () => {
      const resetState = defaultChecklistState();
      state.groups = resetState.groups;
      render();
      hmjToast('Checklist reset to defaults', 'info');
    });

    layout.append(groupsWrap, customWrap);
    content.append(summaryCard, layout, actions);
    container.appendChild(card);
    render();
  }

  function createTextField(labelText, placeholder, value) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'tool-field';
    const label = doc.createElement('label');
    label.textContent = labelText;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'tool-input';
    input.placeholder = placeholder;
    input.value = value || '';
    wrapper.append(label, input);
    return { wrapper, input };
  }

  function createTextareaField(labelText, placeholder, value, rows = 4) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'tool-field';
    const label = doc.createElement('label');
    label.textContent = labelText;
    const input = doc.createElement('textarea');
    input.className = 'tool-textarea';
    input.placeholder = placeholder;
    input.rows = rows;
    input.value = value || '';
    wrapper.append(label, input);
    return { wrapper, input };
  }

  function createButton(className, label) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.dataset.defaultLabel = label;
    return button;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char] || char;
    });
  }

  function renderMarkdownLite(value) {
    const escaped = escapeHtml(value);
    return escaped
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function initNotesPad() {
    const region = doc.querySelector('[data-notes-region]');
    if (!region) return;
    region.innerHTML = '';

    let notes = readStorage(STORAGE_KEYS.notes, []);
    if (!Array.isArray(notes)) notes = [];

    const inputWrap = doc.createElement('div');
    inputWrap.className = 'notes-input';

    const textarea = doc.createElement('textarea');
    textarea.placeholder = 'Add decisions, approvals, outstanding questions or links to specs. Markdown links like [SOW](https://example.com) are supported.';

    const actions = doc.createElement('div');
    actions.className = 'notes-actions';

    const addBtn = doc.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-primary';
    addBtn.textContent = 'Add note';

    const exportBtn = createButton('tool-secondary', 'Export JSON');
    const importBtn = createButton('tool-secondary', 'Import JSON');
    const clearBtn = createButton('tool-ghost', 'Clear board');
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    fileInput.hidden = true;

    actions.append(addBtn, exportBtn, importBtn, clearBtn);
    inputWrap.append(textarea, actions, fileInput);

    const listWrap = doc.createElement('div');
    listWrap.className = 'notes-list';

    function persist() {
      writeStorage(STORAGE_KEYS.notes, notes);
    }

    function render() {
      listWrap.innerHTML = '';

      if (!notes.length) {
        const empty = doc.createElement('p');
        empty.className = 'notes-fallback';
        empty.textContent = 'No notes yet. Add the first one above.';
        listWrap.appendChild(empty);
        return;
      }

      const ordered = [...notes].sort((left, right) => {
        if (left.pinned && !right.pinned) return -1;
        if (!left.pinned && right.pinned) return 1;
        return Number(right.updatedAt) - Number(left.updatedAt);
      });

      ordered.forEach((note) => {
        const card = doc.createElement('article');
        card.className = 'note-card';
        if (note.pinned) card.classList.add('pinned');

        const content = doc.createElement('div');
        content.className = 'note-content';
        content.innerHTML = renderMarkdownLite(note.text || '');

        const time = doc.createElement('time');
        time.dateTime = new Date(note.updatedAt).toISOString();
        time.textContent = formatDateTime(note.updatedAt);

        const actionsRow = doc.createElement('div');
        actionsRow.className = 'note-actions';

        const pinBtn = doc.createElement('button');
        pinBtn.type = 'button';
        pinBtn.textContent = note.pinned ? 'Unpin' : 'Pin';

        const editBtn = doc.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Edit';

        const deleteBtn = doc.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Delete';

        actionsRow.append(pinBtn, editBtn, deleteBtn);
        card.append(content, time, actionsRow);

        pinBtn.addEventListener('click', () => {
          note.pinned = !note.pinned;
          note.updatedAt = Date.now();
          persist();
          render();
        });

        deleteBtn.addEventListener('click', () => {
          notes = notes.filter((entry) => entry.id !== note.id);
          persist();
          render();
          hmjToast('Note removed', 'info');
        });

        editBtn.addEventListener('click', () => {
          const editor = doc.createElement('textarea');
          editor.className = 'notes-edit';
          editor.value = note.text || '';

          const editActions = doc.createElement('div');
          editActions.className = 'notes-actions';
          const saveBtn = createButton('tool-secondary', 'Save');
          const cancelBtn = createButton('tool-ghost', 'Cancel');
          editActions.append(saveBtn, cancelBtn);

          card.innerHTML = '';
          card.append(editor, editActions);
          editor.focus();

          saveBtn.addEventListener('click', () => {
            note.text = editor.value;
            note.updatedAt = Date.now();
            persist();
            render();
            hmjToast('Note saved', 'success');
          });

          cancelBtn.addEventListener('click', render);
        });

        listWrap.appendChild(card);
      });
    }

    addBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) {
        hmjToast('Add some note content before saving', 'warning');
        return;
      }

      const note = {
        id: crypto.randomUUID ? crypto.randomUUID() : createId('note'),
        text,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      notes.push(note);
      textarea.value = '';
      persist();
      render();
      hmjToast('Note saved', 'success');
    });

    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = 'hmj-client-notes.json';
      doc.body.appendChild(link);
      link.click();
      doc.body.removeChild(link);
      URL.revokeObjectURL(url);
      hmjToast('Notes exported', 'success');
    });

    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed)) throw new Error('Invalid format');

          notes = parsed.map((item) => ({
            id: item.id || createId('note'),
            text: String(item.text || ''),
            pinned: Boolean(item.pinned),
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now()
          }));
          persist();
          render();
          hmjToast('Notes imported', 'success');
        } catch (_) {
          hmjToast('Import failed. Please check the JSON file.', 'error');
        }
      };
      reader.readAsText(file);
    });

    clearBtn.addEventListener('click', () => {
      notes = [];
      persist();
      render();
      hmjToast('Notes cleared', 'info');
    });

    region.append(inputWrap, listWrap);
    render();
  }

  function lazyToolsInit() {
    const grid = doc.querySelector('[data-tools-grid]');
    if (!grid) return;
    grid.innerHTML = '';
    initScopeBuilder(grid);
    initBudgetEstimator(grid);
    initChecklist(grid);
  }

  function ready(fn) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    initToasts();
    initThemeToggle();
    initNav();
    initTooltips();
    initHeroMotion();
    initRevealOnScroll();

    const form = doc.querySelector('[data-client-form]');
    initValidation(form);
    initProgressMeter(form);
    initAutosave(form);
    initShortcuts(form);
    initFormSubmission(form);

    if ('requestIdleCallback' in win) {
      win.requestIdleCallback(() => {
        lazyToolsInit();
        initNotesPad();
      });
    } else {
      win.setTimeout(() => {
        lazyToolsInit();
        initNotesPad();
      }, 150);
    }
  });
})();
