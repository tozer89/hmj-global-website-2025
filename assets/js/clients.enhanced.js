(function () {
  'use strict';

  const doc = document;
  const win = window;
  const prefersReducedMotion = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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

  function initToasts() {
    if (!toastRegion) {
      win.hmjToast = function hmjToastFallback(message) {
        if (typeof console !== 'undefined') {
          console.info('[hmj-toast]', message);
        }
      };
      return;
    }
    win.hmjToast = function hmjToast(message, type = 'info', duration = 2800) {
      const toast = doc.createElement('div');
      toast.className = 'toast';
      toast.dataset.type = type;
      toast.textContent = message;
      toastRegion.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      const timeout = win.setTimeout(() => {
        toast.classList.remove('show');
        const remove = () => toast.remove();
        toast.addEventListener('transitionend', remove, { once: true });
        if (prefersReducedMotion()) remove();
      }, duration);
      toast.addEventListener('mouseenter', () => win.clearTimeout(timeout));
    };
  }

  function applyTheme(theme) {
    doc.documentElement.dataset.theme = theme;
    if (safeStorage) {
      try { safeStorage.setItem('hmj.theme', theme); } catch (_) { /* noop */ }
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
      try { initial = safeStorage.getItem('hmj.theme') || 'auto'; } catch (_) { initial = 'auto'; }
    }
    if (initial !== 'auto') {
      applyTheme(initial);
      toggle.setAttribute('aria-pressed', initial === 'dark');
    }
    toggle.addEventListener('click', () => {
      const active = currentTheme();
      const next = active === 'dark' ? 'auto' : active === 'auto' ? 'dark' : 'dark';
      applyTheme(next);
      toggle.setAttribute('aria-pressed', next === 'dark');
      hmjToast(`Theme ${next === 'dark' ? 'enabled' : 'set to system'}`, 'info');
    });
  }

  function initNav() {
    const burger = doc.querySelector('.hmj-burger');
    const menu = doc.getElementById('hmj-menu');
    const scrim = doc.querySelector('.hmj-scrim');
    if (!burger || !menu || !scrim) return;
    const close = () => {
      burger.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      scrim.setAttribute('aria-hidden', 'true');
      doc.body.style.overflow = '';
    };
    const open = () => {
      burger.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open');
      scrim.setAttribute('aria-hidden', 'false');
      doc.body.style.overflow = 'hidden';
    };
    burger.addEventListener('click', () => {
      const expanded = burger.getAttribute('aria-expanded') === 'true';
      expanded ? close() : open();
    });
    scrim.addEventListener('click', close);
    doc.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') close();
    });
    menu.addEventListener('click', (evt) => {
      if (evt.target.closest('a')) close();
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
      trigger.innerHTML = '<span aria-hidden="true">ⓘ</span>';
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
      trigger.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') {
          hide();
          trigger.blur();
        }
      });
    });
    doc.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape' && openTip) {
        const tip = openTip;
        tip.dataset.visible = 'false';
        openTip = null;
      }
    });
  }

  function initValidation(form) {
    if (!form) return;
    const fields = Array.from(form.querySelectorAll('input, textarea, select'))
      .filter((field) => field.type !== 'hidden' && field.name !== 'form-name');
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
      const existingDescribedBy = field.getAttribute('aria-describedby');
      field.setAttribute('aria-describedby', existingDescribedBy ? `${existingDescribedBy} ${feedbackId}` : feedbackId);

      const renderState = () => {
        const value = field.value.trim();
        const isValid = field.checkValidity();
        const isRequired = field.required;
        const hasValue = value.length > 0;
        feedback.classList.remove('visible');
        indicator.className = 'field-indicator';
        if (!hasValue && !isRequired) {
          return;
        }
        if (isValid) {
          indicator.classList.add('is-valid', 'visible');
          indicator.textContent = '✔';
        } else {
          indicator.classList.add('is-invalid', 'visible');
          indicator.textContent = '⚠';
          feedback.textContent = field.validationMessage;
          feedback.classList.add('visible');
        }
      };
      field.addEventListener('blur', renderState);
      field.addEventListener('input', () => {
        if (field === doc.activeElement) return;
        renderState();
      });
      if (field.tagName === 'SELECT') {
        field.addEventListener('change', renderState);
      }
    });
  }

  function initProgressMeter(form) {
    if (!form) return;
    const progressLabel = doc.querySelector('[data-progress-value]');
    const progressBar = doc.querySelector('[data-progress-bar]');
    const required = Array.from(form.querySelectorAll('[required]')).filter((el) => el.type !== 'hidden');
    if (!progressLabel || !progressBar || !required.length) return;
    const update = () => {
      const complete = required.filter((field) => field.value && field.value.trim().length > 0 && field.checkValidity()).length;
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
    const key = 'hmj.client.draft:v2';
    const clearBtn = doc.querySelector('[data-clear-draft]');
    const fields = Array.from(form.elements)
      .filter((el) => el.name && el.type !== 'file' && el.type !== 'hidden');
    let timer = null;

    const save = () => {
      const data = {};
      fields.forEach((field) => {
        data[field.name] = field.value;
      });
      try { safeStorage.setItem(key, JSON.stringify(data)); } catch (_) { /* noop */ }
    };

    const scheduleSave = () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(save, 1000);
    };

    fields.forEach((field) => {
      field.addEventListener('input', scheduleSave);
      field.addEventListener('change', scheduleSave);
    });

    let restored = false;
    try {
      const raw = safeStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        fields.forEach((field) => {
          if (data[field.name]) {
            field.value = data[field.name];
          }
        });
        restored = true;
      }
    } catch (_) { restored = false; }
    if (restored) {
      hmjToast('Draft restored from your last visit', 'success');
      form.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('change', { bubbles: true }));
    }

    clearBtn?.addEventListener('click', () => {
      try { safeStorage.removeItem(key); } catch (_) { /* noop */ }
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

    // Ensure the overlay starts hidden even if previous sessions toggled it.
    shortcutsOverlay.hidden = true;
    if (!shortcutsOverlay.hasAttribute('hidden')) {
      shortcutsOverlay.setAttribute('hidden', '');
    }
    shortcutsOverlay.setAttribute('aria-hidden', 'true');

    const trapFocus = (event) => {
      if (shortcutsOverlay.hasAttribute('hidden')) return;
      const focusable = Array.from(shortcutsOverlay.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled'));
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
      if (lastFocusedBeforeShortcuts) {
        lastFocusedBeforeShortcuts.focus?.();
      }
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
    shortcutsOverlay.addEventListener('click', (evt) => {
      if (evt.target === shortcutsOverlay) {
        closeOverlay();
      }
    });
    const isEditableTarget = (target) => {
      if (!target) return false;
      if (target.isContentEditable) return true;
      const name = target.nodeName;
      return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
    };

    doc.addEventListener('keydown', (evt) => {
      if (evt.key === '?' && !evt.altKey && !evt.ctrlKey && !evt.metaKey) {
        if (isEditableTarget(evt.target)) return;
        evt.preventDefault();
        if (shortcutsOverlay.hasAttribute('hidden')) openOverlay(); else closeOverlay();
      }
      if (evt.key === 'Escape' || evt.key === 'Esc') {
        closeOverlay();
      }
      if (evt.key.toLowerCase() === 's' && evt.altKey && submitButton) {
        evt.preventDefault();
        const top = submitButton.getBoundingClientRect().top + win.scrollY - 80;
        win.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        submitButton.focus({ preventScroll: true });
      }
    });
    shortcutsOverlay.addEventListener('pointerdown', (evt) => {
      if (evt.target === shortcutsOverlay) {
        closeOverlay();
      }
    });
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
  }

  function initScopeBuilder(container) {
    const scopes = [
      {
        id: 'csa',
        label: 'CSA Package Manager',
        bullets: ['Coordinate civils & structural trades', 'Drive programme against milestones', 'Report on risk & mitigations'],
        duration: '12–16 weeks'
      },
      {
        id: 'electrical-pm',
        label: 'Electrical PM',
        bullets: ['Manage HV/LV installs & energisation', 'Oversee subcontractor QA/QC', 'Align commissioning with IST plan'],
        duration: '14–18 weeks'
      },
      {
        id: 'commissioning-lead',
        label: 'Commissioning Lead',
        bullets: ['Own Level 3–5 scripts & execution', 'Coordinate vendor witness testing', 'Deliver punchlist close-out'],
        duration: '10–14 weeks'
      },
      {
        id: 'planner',
        label: 'Planner',
        bullets: ['Maintain Primavera / MSP schedule', 'Integrate CSA, MEP & vendor inputs', 'Report float & slippage weekly'],
        duration: '8–12 weeks'
      },
      {
        id: 'qs',
        label: 'Quantity Surveyor',
        bullets: ['Track valuations & change orders', 'Manage procurement cadence', 'Provide cashflow forecasting'],
        duration: '16–24 weeks'
      }
    ];

    const card = doc.createElement('article');
    card.className = 'tool-card';
    card.innerHTML = '<h3>Role scope builder</h3><p>Select typical mission-critical scopes and build a paragraph you can paste into the brief.</p>';
    const chipsWrap = doc.createElement('div');
    chipsWrap.className = 'scope-chips';
    const output = doc.createElement('div');
    output.className = 'scope-output';
    output.setAttribute('role', 'status');
    output.textContent = 'Choose one or more scopes to compose deliverables.';
    const actions = doc.createElement('div');
    actions.className = 'scope-actions';
    const copyBtn = doc.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'tool-secondary';
    copyBtn.textContent = 'Copy scope';
    actions.appendChild(copyBtn);

    const selected = new Set();

    const render = () => {
      if (!selected.size) {
        output.textContent = 'Choose one or more scopes to compose deliverables.';
        return;
      }
      const lines = [];
      selected.forEach((id) => {
        const scope = scopes.find((s) => s.id === id);
        if (!scope) return;
        lines.push(`• ${scope.label} (${scope.duration}) — ${scope.bullets.join('; ')}`);
      });
      output.textContent = lines.join('\n');
    };

    scopes.forEach((scope) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'scope-chip';
      btn.textContent = scope.label;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        if (selected.has(scope.id)) {
          selected.delete(scope.id);
          btn.setAttribute('aria-pressed', 'false');
        } else {
          selected.add(scope.id);
          btn.setAttribute('aria-pressed', 'true');
        }
        render();
      });
      chipsWrap.appendChild(btn);
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(output.textContent || '');
        hmjToast('Scope copied', 'success');
      } catch (_) {
        hmjToast('Copy failed — select text manually', 'warning');
      }
    });

    card.append(chipsWrap, output, actions);
    container.appendChild(card);
  }

  function initBudgetEstimator(container) {
    const card = doc.createElement('article');
    card.className = 'tool-card';
    card.innerHTML = '<h3>Budget &amp; rate estimator</h3><p>Use this quick calculator to model day-rate engagements. Figures are indicative.</p>';

    const inputs = doc.createElement('div');
    inputs.className = 'budget-inputs';

    const weeksLabel = doc.createElement('label');
    weeksLabel.textContent = 'Duration (weeks)';
    const weeksRange = doc.createElement('input');
    weeksRange.type = 'range';
    weeksRange.min = '2';
    weeksRange.max = '52';
    weeksRange.value = '12';
    weeksRange.step = '1';
    const weeksNumber = doc.createElement('input');
    weeksNumber.type = 'number';
    weeksNumber.min = '2';
    weeksNumber.max = '52';
    weeksNumber.value = '12';
    weeksNumber.step = '1';
    weeksLabel.append(weeksRange, weeksNumber);

    const rateLabel = doc.createElement('label');
    rateLabel.textContent = 'Day rate (£)';
    const rateRange = doc.createElement('input');
    rateRange.type = 'range';
    rateRange.min = '250';
    rateRange.max = '1200';
    rateRange.step = '10';
    rateRange.value = '550';
    const rateNumber = doc.createElement('input');
    rateNumber.type = 'number';
    rateNumber.min = '250';
    rateNumber.max = '1500';
    rateNumber.step = '10';
    rateNumber.value = '550';
    rateLabel.append(rateRange, rateNumber);

    const qtyLabel = doc.createElement('label');
    qtyLabel.textContent = 'Quantity of hires';
    const qtyInput = doc.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.max = '25';
    qtyInput.value = '1';
    qtyInput.step = '1';
    qtyLabel.append(qtyInput);

    inputs.append(weeksLabel, rateLabel, qtyLabel);

    const output = doc.createElement('div');
    output.className = 'budget-output';
    const disclaimer = doc.createElement('p');
    disclaimer.className = 'budget-disclaimer';
    disclaimer.textContent = 'For guidance only. Contact HMJ-Global for a tailored proposal.';

    const actions = doc.createElement('div');
    actions.className = 'budget-actions';
    const copyBtn = doc.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'tool-secondary';
    copyBtn.textContent = 'Copy estimate';
    actions.append(copyBtn);

    const update = () => {
      const weeks = parseInt(weeksNumber.value || weeksRange.value, 10) || 0;
      const rate = parseInt(rateNumber.value || rateRange.value, 10) || 0;
      const qty = parseInt(qtyInput.value, 10) || 1;
      weeksRange.value = weeks;
      weeksNumber.value = weeks;
      rateRange.value = rate;
      rateNumber.value = rate;
      const days = weeks * 5;
      const base = days * rate * qty;
      const low = base * 0.85;
      const high = base * 1.15;
      const feeRate = 0.12;
      const fee = base * feeRate;
      output.innerHTML = `<strong>Estimated project value:</strong> ${formatCurrency(low)} – ${formatCurrency(high)} (median ${formatCurrency(base)}).<br><strong>Indicative HMJ service fee @12%:</strong> ${formatCurrency(fee)}.`;
    };

    weeksRange.addEventListener('input', () => { weeksNumber.value = weeksRange.value; update(); });
    weeksNumber.addEventListener('input', () => { weeksRange.value = weeksNumber.value; update(); });
    rateRange.addEventListener('input', () => { rateNumber.value = rateRange.value; update(); });
    rateNumber.addEventListener('input', () => { rateRange.value = rateNumber.value; update(); });
    qtyInput.addEventListener('input', update);

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(output.textContent || '');
        hmjToast('Budget estimate copied', 'success');
      } catch (_) {
        hmjToast('Copy failed — select text manually', 'warning');
      }
    });

    card.append(inputs, output, disclaimer, actions);
    container.appendChild(card);
    update();
  }

  function initChecklist(container) {
    const card = doc.createElement('article');
    card.className = 'tool-card';
    card.innerHTML = '<h3>Document checklist</h3><p>Tick off what you have ready for onboarding. Saved on this device.</p>';
    const list = doc.createElement('div');
    list.className = 'checklist';
    const clearBtn = doc.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'tool-secondary';
    clearBtn.textContent = 'Clear checklist';
    const actions = doc.createElement('div');
    actions.className = 'checklist-actions';
    actions.appendChild(clearBtn);

    const key = 'hmj.client.checklist:v1';
    let state = { JobDescription: false, SiteInduction: false, VendorPolicy: false, TimesheetPortal: false };
    if (safeStorage) {
      try {
        const saved = JSON.parse(safeStorage.getItem(key));
        if (saved) state = { ...state, ...saved };
      } catch (_) { /* noop */ }
    }

    const items = [
      ['JobDescription', 'Job Description'],
      ['SiteInduction', 'Site Induction'],
      ['VendorPolicy', 'Vendor Policy'],
      ['TimesheetPortal', 'Timesheet Portal Access']
    ];

    const persist = () => {
      if (!safeStorage) return;
      try { safeStorage.setItem(key, JSON.stringify(state)); } catch (_) { /* noop */ }
    };

    items.forEach(([value, label]) => {
      const row = doc.createElement('label');
      row.className = 'checklist-item';
      const checkbox = doc.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(state[value]);
      checkbox.addEventListener('change', () => {
        state[value] = checkbox.checked;
        persist();
      });
      const span = doc.createElement('span');
      span.textContent = label;
      row.append(checkbox, span);
      list.appendChild(row);
    });

    clearBtn.addEventListener('click', () => {
      items.forEach(([value], index) => {
        state[value] = false;
        list.querySelectorAll('input')[index].checked = false;
      });
      persist();
      hmjToast('Checklist cleared', 'info');
    });

    card.append(list, actions);
    container.appendChild(card);
  }

  function initFAQ(container) {
    const card = doc.createElement('article');
    card.className = 'tool-card';
    card.innerHTML = '<h3>FAQ</h3>';
    const faq = doc.createElement('div');
    faq.className = 'faq';
    const items = [
      { title: 'How we screen?', body: 'We interview every specialist, verify technical competencies, right-to-work, insurances and references before submission.' },
      { title: 'How soon can we mobilise?', body: 'Most briefs receive a curated shortlist within 48 hours. Mobilisation aligns with your induction, travel and permitting requirements.' },
      { title: 'Compliance & Insurance', body: 'HMJ-Global covers A1 portability, tax registrations, IR35 assessments and site insurances with full audit trails.' },
      { title: 'Payroll & Terms', body: 'Weekly payroll across the UK & EU with consolidated invoicing, rate management and transparent mark-ups.' }
    ];

    items.forEach((item, index) => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'faq-item';
      const button = doc.createElement('button');
      const contentId = `faq-panel-${index}`;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', contentId);
      button.innerHTML = `<span>${item.title}</span><span aria-hidden="true">+</span>`;
      const panel = doc.createElement('div');
      panel.className = 'faq-panel';
      panel.id = contentId;
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-hidden', 'true');
      panel.textContent = item.body;
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!expanded));
        panel.setAttribute('aria-hidden', String(expanded));
        button.lastElementChild.textContent = expanded ? '+' : '−';
      });
      wrapper.append(button, panel);
      faq.appendChild(wrapper);
    });

    card.appendChild(faq);
    container.appendChild(card);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  }

  function renderMarkdownLite(str) {
    const escaped = escapeHtml(str);
    return escaped
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function initNotesPad() {
    const region = doc.querySelector('[data-notes-region]');
    if (!region) return;
    region.innerHTML = '';

    const key = 'hmj.client.notes:v1';
    let notes = [];
    if (safeStorage) {
      try {
        const saved = JSON.parse(safeStorage.getItem(key));
        if (Array.isArray(saved)) notes = saved;
      } catch (_) { /* noop */ }
    }

    const inputWrap = doc.createElement('div');
    inputWrap.className = 'notes-input';
    const textarea = doc.createElement('textarea');
    textarea.placeholder = 'Add decisions, client notes or reminders… Markdown links like [SOW](https://example.com) are supported.';
    const actions = doc.createElement('div');
    actions.className = 'notes-actions';
    const addBtn = doc.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-primary';
    addBtn.textContent = 'Add note';
    const exportBtn = doc.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'tool-secondary';
    exportBtn.textContent = 'Export JSON';
    const importBtn = doc.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'tool-secondary';
    importBtn.textContent = 'Import JSON';
    const clearBtn = doc.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'tool-secondary';
    clearBtn.textContent = 'Clear board';
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    fileInput.hidden = true;
    actions.append(addBtn, exportBtn, importBtn, clearBtn);
    inputWrap.append(textarea, actions, fileInput);

    const listWrap = doc.createElement('div');
    listWrap.className = 'notes-list';

    const persist = () => {
      if (!safeStorage) return;
      try { safeStorage.setItem(key, JSON.stringify(notes)); } catch (_) { /* noop */ }
    };

    const render = () => {
      listWrap.innerHTML = '';
      if (!notes.length) {
        const empty = doc.createElement('p');
        empty.className = 'notes-fallback';
        empty.textContent = 'No notes yet. Add your first above.';
        listWrap.appendChild(empty);
        return;
      }
      const ordered = [...notes].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.updatedAt - a.updatedAt;
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
        time.textContent = new Date(note.updatedAt).toLocaleString('en-GB');
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
          notes = notes.filter((n) => n.id !== note.id);
          persist();
          render();
        });
        editBtn.addEventListener('click', () => {
          const editor = doc.createElement('textarea');
          editor.value = note.text;
          editor.className = 'notes-edit';
          const saveBtn = doc.createElement('button');
          saveBtn.type = 'button';
          saveBtn.textContent = 'Save';
          saveBtn.className = 'tool-secondary';
          const cancelBtn = doc.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.className = 'tool-secondary';
          const editRow = doc.createElement('div');
          editRow.className = 'notes-actions';
          editRow.append(saveBtn, cancelBtn);
          card.innerHTML = '';
          card.append(editor, editRow);
          saveBtn.addEventListener('click', () => {
            note.text = editor.value;
            note.updatedAt = Date.now();
            persist();
            hmjToast('Note saved', 'success');
            render();
          });
          cancelBtn.addEventListener('click', render);
        });

        listWrap.appendChild(card);
      });
    };

    addBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) {
        hmjToast('Add a message before saving', 'warning');
        return;
      }
      const note = { id: crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}`, text, pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
      notes.push(note);
      textarea.value = '';
      persist();
      hmjToast('Note saved', 'success');
      render();
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
            id: item.id || `note-${Date.now()}`,
            text: String(item.text || ''),
            pinned: Boolean(item.pinned),
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now()
          }));
          persist();
          hmjToast('Notes imported', 'success');
          render();
        } catch (_) {
          hmjToast('Import failed. Check the JSON file.', 'error');
        }
      };
      reader.readAsText(file);
    });

    clearBtn.addEventListener('click', () => {
      notes = [];
      persist();
      hmjToast('Notes cleared', 'info');
      render();
    });

    region.append(inputWrap, listWrap);
    render();
  }

  function lazyToolsInit() {
    const wrap = doc.querySelector('#clientTools .tools-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    const heading = doc.createElement('h2');
    heading.textContent = 'Tools & resources';
    const grid = doc.createElement('div');
    grid.className = 'tools-grid';
    wrap.append(heading, grid);
    initScopeBuilder(grid);
    initBudgetEstimator(grid);
    initChecklist(grid);
    initFAQ(grid);
  }

  function initFormSubmission(form) {
    if (!form) return;
    form.addEventListener('submit', () => {
      hmjToast('Thanks — we’ll be in touch shortly.', 'success');
    }, { once: true });
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
      }, 250);
    }
  });
})();
