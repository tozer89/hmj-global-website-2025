(function () {
  'use strict';

  const doc = document;
  const form = doc.getElementById('candForm');
  if (!form) return;

  const isDisabled = (node) => node && node.getAttribute('data-hmj-enhancements') === 'off';
  if (isDisabled(doc.body) || isDisabled(form)) {
    return;
  }

  const body = doc.body;
  if (body) {
    body.classList.add('candidates-enhanced');
  }

  const safeStorage = (() => {
    try {
      const key = '__hmj_test__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return window.localStorage;
    } catch (err) {
      return null;
    }
  })();

  const STORE_KEY = 'hmj.candidate.draft:v2';
  const RATE_KEY = 'hmj.candidate.ratePrefs';
  const AUTOSAVE_DELAY = 1000;
  const MAX_SKILLS = 20;

  const els = {
    first: doc.getElementById('fname'),
    last: doc.getElementById('lname'),
    email: doc.getElementById('email'),
    phone: doc.getElementById('phone'),
    location: doc.getElementById('location'),
    discipline: doc.getElementById('discipline'),
    role: doc.getElementById('role'),
    salary: doc.getElementById('salary'),
    notice: doc.getElementById('notice'),
    reloc: doc.getElementById('reloc'),
    linkedin: doc.getElementById('linkedin'),
    message: doc.getElementById('message'),
    cv: doc.getElementById('cv'),
    rtwGroup: doc.getElementById('rtwGroup'),
    rtwHidden: doc.getElementById('rtwHidden'),
    skillsHidden: doc.getElementById('skillsHidden'),
    tagInput: doc.getElementById('tagInput'),
    tagBox: doc.getElementById('tagBox'),
    skillHints: doc.getElementById('skillHints'),
    roleTip: doc.getElementById('roleTip'),
    strength: doc.getElementById('profileStrength'),
    preview: doc.getElementById('livePreview'),
    clearDraftWrap: doc.getElementById('clearDraftWrap'),
    clearDraftLink: doc.getElementById('clearDraftLink'),
    jobsWidget: doc.getElementById('jobsWidget'),
    formSubmit: doc.getElementById('submitBtn'),
    pageUrlHidden: doc.getElementById('pageUrlHidden'),
    rtwHelp: doc.getElementById('rtwHelp')
  };

  const state = {
    skills: [],
    pdfExcerpt: '',
    fileMeta: null,
    rateCurrency: 'GBP',
    rateBasis: 'per day',
    autosaveTimer: null,
    toast: null,
    otherRtw: '',
    disableAutosave: false,
    rateApply: null,
    otherRtwInput: null,
    rtwUpdate: null
  };

  const SKILL_SUGGESTIONS = ['IST', 'SAT', 'BMS', 'EPMS', 'Black Start', 'LV'];
  const ROLE_TIPS = {
    'Commissioning': 'Try titles like “MEP Commissioning Manager”, “Lead IST Engineer”, “BMS Commissioning Engineer”.',
    'Electrical (MEP)': 'Popular: “Electrical Supervisor”, “MEP Package Manager”, “AP/AE Electrical Engineer”.',
    'Mechanical (MEP)': 'Popular: “Mechanical Supervisor”, “MEP Coordinator”, “Piping/Utilities Engineer”.',
    'HV / Substations': 'Popular: “SAP (HV)”, “Protection Engineer”, “Cable Jointer”, “Substation Supervisor”.',
    'Security & Cabling': 'Popular: “CCTV/Access Control Engineer”, “Structured Cabling Engineer”.',
    'Pharma / CQV': 'Popular: “CQV Engineer”, “Validation Engineer”, “Process Utilities Engineer”.',
    'CSA': 'Popular: “CSA Package Manager”, “Site Engineer (CSA)”, “Planner (CSA)”.'
  };

  const LOCATION_SUGGESTIONS = [
    'London',
    'Dublin',
    'Frankfurt',
    'Amsterdam',
    'Helsinki',
    'Espoo',
    'Groningen',
    'Macclesfield',
    'Hull',
    'Berlin',
    'Paris',
    'Madrid',
    'Warsaw'
  ];

  function getValue(el) {
    if (!el) return '';
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked ? 'on' : '';
    }
    return (el.value || '').trim();
  }

  function getRTWSelections() {
    if (!els.rtwGroup) return [];
    return Array.from(els.rtwGroup.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value.trim());
  }

  function updateRTWHidden() {
    if (!els.rtwHidden) return;
    els.rtwHidden.value = getRTWSelections().join(', ');
  }

  function ensureLocationDatalist() {
    if (!els.location) return;
    const listId = 'candidate-location-suggest';
    if (!doc.getElementById(listId)) {
      const dl = doc.createElement('datalist');
      dl.id = listId;
      LOCATION_SUGGESTIONS.forEach((city) => {
        const option = doc.createElement('option');
        option.value = city;
        dl.appendChild(option);
      });
      doc.body.appendChild(dl);
    }
    els.location.setAttribute('list', listId);
    const note = doc.createElement('p');
    note.className = 'c-locationNote';
    note.textContent = 'Start typing to see common cities. You can still enter anywhere worldwide.';
    els.location.insertAdjacentElement('afterend', note);
  }

  function setupRoleTips() {
    if (!els.discipline || !els.roleTip) return;
    const update = () => {
      els.roleTip.textContent = ROLE_TIPS[els.discipline.value] || '';
    };
    els.discipline.addEventListener('change', update);
    update();
  }

  function createSkillChip(value, index) {
    const chip = doc.createElement('span');
    chip.className = 'c-chip';
    chip.setAttribute('data-index', String(index));
    chip.innerHTML = `${value}<button type="button" aria-label="Remove ${value}">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.skills.splice(index, 1);
      syncSkills();
    });
    return chip;
  }

  function syncSkills() {
    const unique = [];
    const seen = new Set();
    state.skills.forEach((item) => {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    });
    state.skills = unique.slice(0, MAX_SKILLS);
    if (els.skillsHidden) {
      els.skillsHidden.value = state.skills.join(', ');
    }
    renderSkillChips();
    updatePreview();
    scheduleAutosave();
  }

  function renderSkillChips() {
    if (!els.tagBox) return;
    els.tagBox.classList.add('c-skillBox');
    Array.from(els.tagBox.querySelectorAll('.c-chip')).forEach((chip) => chip.remove());
    state.skills.forEach((skill, index) => {
      const chip = createSkillChip(skill, index);
      els.tagBox.insertBefore(chip, els.tagInput);
    });
    if (els.skillHints) {
      els.skillHints.classList.add('c-skillHints');
      els.skillHints.innerHTML = '';
      const available = SKILL_SUGGESTIONS.filter((skill) => !state.skills.some((item) => item.toLowerCase() === skill.toLowerCase()));
      available.forEach((skill) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.skill = skill;
        button.textContent = `+ ${skill}`;
        button.addEventListener('click', () => {
          if (state.skills.length >= MAX_SKILLS) return;
          state.skills.push(skill);
          syncSkills();
        });
        els.skillHints.appendChild(button);
      });
      if (!available.length) {
        const info = doc.createElement('span');
        info.className = 'c-tagLimit';
        info.textContent = 'All suggestions added. You can type more above (20 max).';
        els.skillHints.appendChild(info);
      }
    }
    if (els.tagInput) {
      els.tagInput.setAttribute('aria-describedby', 'skillLimitNote');
    }
    let note = doc.getElementById('skillLimitNote');
    if (!note) {
      note = doc.createElement('span');
      note.id = 'skillLimitNote';
      note.className = 'c-tagLimit';
      note.textContent = 'Add up to 20 key skills. Use comma or Enter to create chips.';
      if (els.skillHints) {
        els.skillHints.insertAdjacentElement('beforebegin', note);
      }
    }
  }

  function addSkill(value) {
    const clean = value.replace(/[,]+/g, ' ').trim();
    if (!clean) return;
    if (state.skills.length >= MAX_SKILLS) return;
    state.skills.push(clean);
    syncSkills();
  }

  function handleSkillInput() {
    if (!els.tagInput) return;
    els.tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addSkill(els.tagInput.value);
        els.tagInput.value = '';
      } else if (event.key === 'Backspace' && !els.tagInput.value && state.skills.length) {
        event.preventDefault();
        state.skills.pop();
        syncSkills();
      }
    });
    els.tagInput.addEventListener('blur', () => {
      addSkill(els.tagInput.value);
      els.tagInput.value = '';
    });
    els.tagBox?.addEventListener('click', () => {
      els.tagInput?.focus();
    });
    if (els.skillHints) {
      els.skillHints.addEventListener('mousedown', (event) => event.preventDefault());
    }
  }

  function initSkillsFromHidden() {
    if (!els.skillsHidden) return;
    const initial = (els.skillsHidden.value || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (initial.length) {
      state.skills = initial.slice(0, MAX_SKILLS);
    }
    syncSkills();
  }

  function buildPreviewShell() {
    if (!els.preview) return;
    els.preview.innerHTML = '';
    const header = doc.createElement('div');
    header.className = 'c-preview__header';

    const badge = doc.createElement('span');
    badge.className = 'c-preview__badge';
    badge.innerHTML = '<svg width="14" height="14" aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path d="M2 11l4 4 12-12" fill="none" stroke="currentColor" stroke-width="2"/></svg> Local preview only';

    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'c-preview__copy';
    copy.innerHTML = '<svg width="16" height="16" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M8 3h9a2 2 0 0 1 2 2v11M8 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2m-6-6h-7a2 2 0 0 1-2-2V5"/></svg> Copy as text';
    copy.setAttribute('data-default-label', copy.innerHTML);
    copy.addEventListener('click', handleCopyPreview);

    header.appendChild(badge);
    header.appendChild(copy);

    const grid = doc.createElement('div');
    grid.className = 'c-preview__grid';

    const createSection = (id, title) => {
      const section = doc.createElement('section');
      section.className = 'c-preview__section';
      section.setAttribute('data-section', id);
      const h3 = doc.createElement('h3');
      h3.textContent = title;
      section.appendChild(h3);
      const container = doc.createElement('div');
      container.className = 'c-preview__meta';
      section.appendChild(container);
      return section;
    };

    const summarySection = createSection('summary', 'Snapshot');
    const availabilitySection = createSection('availability', 'Availability & Rate');
    const skillsSection = createSection('skills', 'Key skills');
    const locationSection = createSection('locations', 'Locations & Right-to-work');
    const notesSection = createSection('notes', 'Notes & Links');

    grid.appendChild(summarySection);
    grid.appendChild(availabilitySection);
    grid.appendChild(skillsSection);
    grid.appendChild(locationSection);
    grid.appendChild(notesSection);

    const footer = doc.createElement('div');
    footer.className = 'c-preview__footer';
    footer.innerHTML = '<span class="has-icon"><svg width="16" height="16" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 5v6l4 2"/></svg>Updates as you type</span><span aria-hidden="true">Press “Copy as text” to share your summary.</span>';

    els.preview.appendChild(header);
    els.preview.appendChild(grid);
    els.preview.appendChild(footer);
  }

  function renderPreviewSection(id, rows, emptyText) {
    const section = els.preview?.querySelector(`.c-preview__section[data-section="${id}"] .c-preview__meta`);
    if (!section) return;
    section.innerHTML = '';
    if (!rows.length) {
      const empty = doc.createElement('p');
      empty.className = 'c-preview__empty';
      empty.textContent = emptyText;
      section.appendChild(empty);
      return;
    }
    rows.forEach((text) => {
      if (Array.isArray(text)) {
        const list = doc.createElement('ul');
        list.className = 'c-preview__skills';
        text.forEach((item) => {
          const li = doc.createElement('li');
          li.className = 'c-chip';
          li.textContent = item;
          list.appendChild(li);
        });
        section.appendChild(list);
      } else {
        const p = doc.createElement('p');
        p.className = 'c-preview__row';
        p.textContent = text;
        section.appendChild(p);
      }
    });
  }

  function updatePreviewFile() {
    const metaContainer = els.preview?.querySelector('.c-preview__section[data-section="notes"] .c-preview__meta');
    if (!metaContainer) return;
    const existing = metaContainer.querySelector('.c-preview__file');
    if (existing) existing.remove();
    if (state.fileMeta) {
      const fileRow = doc.createElement('p');
      fileRow.className = 'c-preview__file';
      fileRow.innerHTML = `<svg width="18" height="18" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg>${state.fileMeta}`;
      metaContainer.appendChild(fileRow);
    }
    const existingPreview = els.preview?.querySelector('.c-preview__pdf');
    if (existingPreview) existingPreview.remove();
    if (state.pdfExcerpt) {
      const excerpt = doc.createElement('div');
      excerpt.className = 'c-preview__pdf';
      excerpt.textContent = state.pdfExcerpt;
      metaContainer.appendChild(excerpt);
    }
  }

  function updatePreview() {
    const summaryRows = [];
    const name = `${getValue(els.first)} ${getValue(els.last)}`.trim();
    const discipline = getValue(els.discipline) || 'Discipline not yet set';
    const role = getValue(els.role) || 'Role of interest pending';
    if (name) {
      summaryRows.push(`${name} — ${discipline}`);
    } else {
      summaryRows.push('Add your name to personalise this preview.');
    }
    summaryRows.push(`Role of interest: ${role}`);
    const locationText = getValue(els.location);
    if (locationText) {
      summaryRows.push(`Current location: ${locationText}`);
    }

    const availabilityRows = [];
    const notice = getValue(els.notice);
    const salaryValue = getValue(els.salary);
    const basisLabel = state.rateBasis === 'per hour' ? 'per hour' : 'per day';
    if (notice) availabilityRows.push(`Notice period: ${notice}`);
    if (salaryValue) {
      const label = `${state.rateCurrency} ${salaryValue} ${basisLabel}`;
      availabilityRows.push(`Desired rate: ${label}`);
    }
    const reloc = getValue(els.reloc);
    if (reloc) availabilityRows.push(`Open to relocation: ${reloc}`);
    const linkedin = getValue(els.linkedin);
    if (linkedin) availabilityRows.push(`LinkedIn: ${linkedin}`);

    const skillsRows = state.skills.length ? [state.skills] : [];
    const rtw = getRTWSelections();
    const locationRows = [];
    if (rtw.length) {
      locationRows.push(`Right to work: ${rtw.join(', ')}`);
    }
    if (state.otherRtw) {
      locationRows.push(`Additional note: ${state.otherRtw}`);
    }
    if (locationRows.length === 0) {
      locationRows.push('Add right-to-work regions to complete this section.');
    }

    const notesRows = [];
    if (getValue(els.message)) {
      notesRows.push(getValue(els.message));
    }
    if (!notesRows.length) {
      notesRows.push('Add a short note to highlight preferences or upcoming availability.');
    }

    renderPreviewSection('summary', summaryRows, 'Start with your name and discipline.');
    renderPreviewSection('availability', availabilityRows, 'Notice period, rate and relocation preferences will appear here.');
    renderPreviewSection('skills', skillsRows, 'Add up to 20 skills—comma or Enter to create chips.');
    renderPreviewSection('locations', locationRows, 'Select the regions you are authorised to work in.');
    renderPreviewSection('notes', notesRows, 'Use the message box for context, preferences or project highlights.');
    updatePreviewFile();
    updateStrength();
  }

  function buildStrengthMeter() {
    if (!els.strength) return;
    els.strength.innerHTML = '';
    els.strength.setAttribute('role', 'status');
    els.strength.setAttribute('aria-live', 'polite');
    const label = doc.createElement('div');
    label.className = 'c-strength__label';
    label.id = 'strengthLabel';
    label.textContent = 'Profile strength: Getting started (0 / 100)';

    const bar = doc.createElement('div');
    bar.className = 'c-strength__bar';
    const span = doc.createElement('span');
    span.id = 'strengthBar';
    bar.appendChild(span);

    const tier = doc.createElement('div');
    tier.className = 'c-strength__tier';
    tier.id = 'strengthTier';
    tier.textContent = 'Add required details to boost your profile.';

    els.strength.appendChild(label);
    els.strength.appendChild(bar);
    els.strength.appendChild(tier);
  }

  function updateStrength() {
    if (!els.strength) return;
    const span = doc.getElementById('strengthBar');
    const label = doc.getElementById('strengthLabel');
    const tier = doc.getElementById('strengthTier');
    if (!span || !label || !tier) return;

    const required = [els.first, els.last, els.email, els.phone, els.location, els.discipline, els.role, els.notice, els.reloc];
    let score = 0;
    let completed = 0;
    required.forEach((el) => {
      if (getValue(el)) completed += 1;
    });
    score += Math.round((completed / required.length) * 60);
    if (getRTWSelections().length) score += 12;
    if (Number(getValue(els.salary))) score += 10;
    if (state.skills.length >= 5) score += 8;
    if (getValue(els.linkedin)) score += 5;
    if (getValue(els.notice)) score += 5;
    if (score > 100) score = 100;

    let tierLabel = 'Getting started';
    let tierHint = 'Add more required fields to strengthen your profile.';
    if (score >= 85) {
      tierLabel = 'Outstanding';
      tierHint = 'Great work! You are ready to submit.';
    } else if (score >= 60) {
      tierLabel = 'Strong';
      tierHint = 'Just a few optional fields left for a standout profile.';
    } else if (score >= 35) {
      tierLabel = 'Good';
      tierHint = 'Keep going—add skills, rate and RTW regions for more impact.';
    }

    span.style.width = `${score}%`;
    label.textContent = `Profile strength: ${tierLabel} (${score} / 100)`;
    tier.textContent = `${tierLabel} – ${tierHint}`;
    els.strength.dataset.tier = tierLabel.toLowerCase();
  }

  function buildRateHelper() {
    if (!els.salary) return;
    const helper = doc.createElement('div');
    helper.className = 'c-rateHelper';

    const currency = doc.createElement('select');
    currency.setAttribute('aria-label', 'Preferred currency for preview');
    ['GBP', 'EUR'].forEach((code) => {
      const option = doc.createElement('option');
      option.value = code;
      option.textContent = code;
      currency.appendChild(option);
    });

    const perDay = doc.createElement('button');
    perDay.type = 'button';
    perDay.textContent = 'Per day';
    perDay.setAttribute('aria-pressed', 'true');

    const perHour = doc.createElement('button');
    perHour.type = 'button';
    perHour.textContent = 'Per hour';
    perHour.setAttribute('aria-pressed', 'false');

    const basisButtons = [perDay, perHour];

    const applyRateState = () => {
      currency.value = state.rateCurrency;
      basisButtons.forEach((btn) => {
        const isDayButton = btn === perDay;
        const pressed = isDayButton ? state.rateBasis === 'per day' : state.rateBasis === 'per hour';
        btn.setAttribute('aria-pressed', String(pressed));
      });
    };

    const setBasis = (basis) => {
      state.rateBasis = basis;
      applyRateState();
      scheduleAutosave();
      updatePreview();
    };

    perDay.addEventListener('click', () => setBasis('per day'));
    perHour.addEventListener('click', () => setBasis('per hour'));

    currency.addEventListener('change', () => {
      state.rateCurrency = currency.value;
      applyRateState();
      scheduleAutosave();
      updatePreview();
    });

    helper.appendChild(currency);
    helper.appendChild(perDay);
    helper.appendChild(perHour);
    els.salary.insertAdjacentElement('afterend', helper);

    const saved = safeStorage && safeStorage.getItem(RATE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.currency) {
          state.rateCurrency = parsed.currency;
        }
        if (parsed.basis) {
          state.rateBasis = parsed.basis;
        }
      } catch (err) {
        /* noop */
      }
    }
    state.rateApply = applyRateState;
    applyRateState();
  }

  function buildRtwHelper() {
    if (!els.rtwGroup) return;
    const chipWrap = doc.createElement('div');
    chipWrap.className = 'c-rtwChips';
    chipWrap.id = 'rtwChipWrap';
    els.rtwGroup.insertAdjacentElement('afterend', chipWrap);

    if (els.rtwHelp) {
      els.rtwHelp.classList.add('c-tooltip');
      els.rtwHelp.innerHTML = '<svg width="16" height="16" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="6" r="1.5" fill="currentColor"/></svg>Tip: choose all that apply (dual nationality welcome).';
    }

    const otherWrap = doc.createElement('div');
    otherWrap.className = 'c-otherText';
    const otherLabel = doc.createElement('label');
    otherLabel.setAttribute('for', 'rtwOther');
    otherLabel.textContent = 'Other details (for preview only)';
    const otherInput = doc.createElement('input');
    otherInput.id = 'rtwOther';
    otherInput.type = 'text';
    otherInput.setAttribute('aria-describedby', 'rtwHelp');
    otherWrap.appendChild(otherLabel);
    otherWrap.appendChild(otherInput);
    chipWrap.insertAdjacentElement('afterend', otherWrap);

    otherInput.addEventListener('input', () => {
      state.otherRtw = otherInput.value.trim();
      scheduleAutosave();
      updatePreview();
    });

    const updateChips = () => {
      chipWrap.innerHTML = '';
      const selections = getRTWSelections();
      if (!selections.length) {
        const placeholder = doc.createElement('span');
        placeholder.className = 'c-tagLimit';
        placeholder.textContent = 'No regions selected yet.';
        chipWrap.appendChild(placeholder);
      }
      selections.forEach((value) => {
        const chip = doc.createElement('span');
        chip.className = 'c-chip';
        chip.textContent = value;
        chipWrap.appendChild(chip);
      });
      const otherChecked = selections.some((value) => value.toLowerCase().includes('other'));
      otherWrap.style.display = otherChecked ? 'block' : 'none';
      if (!otherChecked) {
        state.otherRtw = '';
        otherInput.value = '';
      }
      updateRTWHidden();
      updatePreview();
      scheduleAutosave();
    };

    els.rtwGroup.addEventListener('change', updateChips);
    state.otherRtwInput = otherInput;
    state.rtwUpdate = updateChips;
    if (state.otherRtw) {
      otherInput.value = state.otherRtw;
    }
    updateChips();
  }

  function handleFileChange() {
    if (!els.cv) return;
    const meta = doc.createElement('p');
    meta.className = 'c-fileMeta';
    els.cv.insertAdjacentElement('afterend', meta);

    const warn = (message) => {
      meta.className = 'c-fileMeta c-fileMeta--warn';
      meta.innerHTML = `<svg width="16" height="16" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 2l10 18H2z"/><circle cx="12" cy="17" r="1" fill="currentColor"/><path d="M12 10v4" stroke="currentColor" stroke-width="2"/></svg>${message}`;
    };

    const ok = (message) => {
      meta.className = 'c-fileMeta';
      meta.innerHTML = `<svg width="16" height="16" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 12l5 5 11-11"/></svg>${message}`;
    };

    const reset = () => {
      state.fileMeta = null;
      state.pdfExcerpt = '';
      meta.textContent = '';
      updatePreview();
    };

    els.cv.addEventListener('change', async () => {
      const file = els.cv.files && els.cv.files[0];
      if (!file) {
        reset();
        return;
      }
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const allowed = ['pdf', 'doc', 'docx'];
      state.fileMeta = `${file.name} • ${file.type || ext.toUpperCase()} • ${sizeMb} MB`;
      if (!allowed.includes(ext)) {
        warn(`The selected file is ${ext || 'unknown'} format. Accepted: PDF, DOC, DOCX.`);
      } else if (file.size > 10 * 1024 * 1024) {
        warn('File is larger than 10 MB. You can still submit, but consider a smaller file.');
      } else {
        ok(`${file.name} (${sizeMb} MB)`);
      }
      if (file.type === 'application/pdf' || ext === 'pdf') {
        try {
          const text = await file.text();
          const cleaned = text.replace(/[^\x20-\x7E\n]+/g, ' ');
          const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 200);
          state.pdfExcerpt = words.join(' ');
        } catch (err) {
          state.pdfExcerpt = '';
        }
      } else {
        state.pdfExcerpt = '';
      }
      updatePreview();
      scheduleAutosave();
    });
  }

  function buildStrengthWatchers() {
    const inputs = [els.first, els.last, els.email, els.phone, els.location, els.discipline, els.role, els.notice, els.reloc, els.salary, els.linkedin, els.message];
    inputs.forEach((input) => {
      input?.addEventListener('input', () => {
        updatePreview();
        scheduleAutosave();
      });
      input?.addEventListener('change', () => {
        updatePreview();
        scheduleAutosave();
      });
    });
    els.discipline?.addEventListener('change', () => {
      renderSkillChips();
    });
  }

  function handleCopyPreview() {
    if (!els.preview) return;
    const sections = els.preview.querySelectorAll('.c-preview__section');
    const lines = [];
    sections.forEach((section) => {
      const title = section.querySelector('h3');
      const content = section.querySelector('.c-preview__meta');
      if (!title || !content) return;
      const items = Array.from(content.children);
      if (!items.length) return;
      lines.push(title.textContent || '');
      items.forEach((item) => {
        if (item.classList.contains('c-preview__skills')) {
          lines.push(` • ${Array.from(item.children).map((chip) => chip.textContent).join(', ')}`);
        } else {
          lines.push(` • ${item.textContent}`);
        }
      });
      lines.push('');
    });
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flashCopyState(true)).catch(() => flashCopyState(false));
    } else {
      const textarea = doc.createElement('textarea');
      textarea.value = text;
      doc.body.appendChild(textarea);
      textarea.select();
      try {
        doc.execCommand('copy');
        flashCopyState(true);
      } catch (err) {
        flashCopyState(false);
      }
      textarea.remove();
    }
  }

  function flashCopyState(success) {
    const button = els.preview?.querySelector('.c-preview__copy');
    if (!button) return;
    const original = button.getAttribute('data-default-label') || button.innerHTML;
    button.disabled = true;
    button.innerHTML = success ? 'Copied!' : 'Copy not available';
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = original;
    }, 1800);
  }

  function scheduleAutosave() {
    if (!safeStorage || state.disableAutosave) return;
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = window.setTimeout(saveDraft, AUTOSAVE_DELAY);
  }

  function collectFormValues() {
    const data = {};
    Array.from(form.elements).forEach((el) => {
      if (!el.name) return;
      if (el.type === 'file') return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        data[el.name] = el.checked;
      } else {
        data[el.name] = el.value;
      }
    });
    data.__skills = state.skills;
    data.__rateCurrency = state.rateCurrency;
    data.__rateBasis = state.rateBasis;
    data.__otherRtw = state.otherRtw;
    return data;
  }

  function saveDraft() {
    if (!safeStorage) return;
    try {
      const payload = collectFormValues();
      safeStorage.setItem(STORE_KEY, JSON.stringify(payload));
      safeStorage.setItem(RATE_KEY, JSON.stringify({ currency: state.rateCurrency, basis: state.rateBasis }));
      if (els.clearDraftWrap) {
        els.clearDraftWrap.style.display = 'inline';
      }
    } catch (err) {
      /* ignore */
    }
  }

  function restoreDraft(data) {
    if (!data) return;
    state.disableAutosave = true;
    Object.entries(data).forEach(([name, value]) => {
      if (name.startsWith('__')) return;
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = Boolean(value);
      } else if (typeof value === 'string') {
        el.value = value;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (Array.isArray(data.__skills)) {
      state.skills = data.__skills.slice(0, MAX_SKILLS);
    }
    if (typeof data.__rateCurrency === 'string') {
      state.rateCurrency = data.__rateCurrency;
    }
    if (typeof data.__rateBasis === 'string') {
      state.rateBasis = data.__rateBasis;
    }
    state.otherRtw = data.__otherRtw || '';
    if (state.otherRtwInput) {
      state.otherRtwInput.value = state.otherRtw;
    }
    state.rtwUpdate?.();
    state.rateApply?.();
    syncSkills();
    state.disableAutosave = false;
    updateRTWHidden();
    updatePreview();
  }

  function maybeRestoreDraft() {
    if (!safeStorage) return;
    const raw = safeStorage.getItem(STORE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (els.clearDraftWrap) {
        els.clearDraftWrap.style.display = 'inline';
      }
      showRestoreToast(data);
    } catch (err) {
      /* ignore */
    }
  }

  function clearDraft() {
    if (!safeStorage) return;
    safeStorage.removeItem(STORE_KEY);
    safeStorage.removeItem(RATE_KEY);
    if (els.clearDraftWrap) {
      els.clearDraftWrap.style.display = 'none';
    }
  }

  function showRestoreToast(data) {
    if (state.toast) {
      state.toast.remove();
    }
    const toast = doc.createElement('div');
    toast.className = 'c-toast';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = '<span>Draft found — Restore?</span>';
    const restoreBtn = doc.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => {
      restoreDraft(data);
      toast.classList.remove('c-toast--show');
      setTimeout(() => toast.remove(), 200);
    });
    const dismissBtn = doc.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      toast.classList.remove('c-toast--show');
      setTimeout(() => toast.remove(), 200);
    });
    toast.appendChild(restoreBtn);
    toast.appendChild(dismissBtn);
    doc.body.appendChild(toast);
    state.toast = toast;
    requestAnimationFrame(() => toast.classList.add('c-toast--show'));
    setTimeout(() => {
      toast.classList.remove('c-toast--show');
      setTimeout(() => toast.remove(), 200);
    }, 8000);
  }

  function handleFormSubmission() {
    form.addEventListener('submit', () => {
      if (els.pageUrlHidden) {
        els.pageUrlHidden.value = window.location.href;
      }
      clearDraft();
    });
  }

  function initClearDraftLink() {
    if (!els.clearDraftLink) return;
    els.clearDraftLink.addEventListener('click', (event) => {
      event.preventDefault();
      clearDraft();
    });
  }

  function initJobsWidget() {
    if (!els.jobsWidget || !window.fetch) return;
    fetch('/data/jobs.json', { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
      })
      .then((payload) => {
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        const live = jobs.filter((job) => (job.status || '').toLowerCase() === 'live').slice(0, 3);
        if (!live.length) return;
        renderJobs(live);
      })
      .catch(() => {
        /* silent */
      });
  }

  function renderJobs(jobs) {
    if (!els.jobsWidget) return;
    els.jobsWidget.hidden = false;
    const wrap = doc.createElement('div');
    wrap.className = 'c-jobs__wrap';

    const header = doc.createElement('div');
    header.className = 'c-jobs__header';
    const h2 = doc.createElement('h2');
    h2.textContent = 'Browse live jobs';
    const link = doc.createElement('a');
    link.href = 'jobs.html';
    link.className = 'c-jobs__link';
    link.textContent = 'View all jobs';
    header.appendChild(h2);
    header.appendChild(link);

    const list = doc.createElement('div');
    list.className = 'c-jobs__list';

    jobs.forEach((job) => {
      const card = doc.createElement('article');
      card.className = 'c-jobs__card';
      card.tabIndex = 0;
      const title = doc.createElement('h3');
      title.textContent = job.title || 'Role';
      const location = doc.createElement('p');
      location.textContent = job.locationText || 'Location to be confirmed';
      const status = doc.createElement('span');
      status.className = 'c-jobs__status';
      status.textContent = (job.status || 'live').toUpperCase();
      card.appendChild(status);
      card.appendChild(title);
      card.appendChild(location);
      card.addEventListener('click', () => {
        window.location.href = 'jobs.html';
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = 'jobs.html';
        }
      });
      list.appendChild(card);
    });

    wrap.appendChild(header);
    wrap.appendChild(list);
    els.jobsWidget.appendChild(wrap);
  }

  buildPreviewShell();
  buildStrengthMeter();
  initSkillsFromHidden();
  handleSkillInput();
  ensureLocationDatalist();
  setupRoleTips();
  buildRateHelper();
  buildRtwHelper();
  handleFileChange();
  buildStrengthWatchers();
  initClearDraftLink();
  handleFormSubmission();
  initJobsWidget();

  updatePreview();
  maybeRestoreDraft();

  form.addEventListener('input', scheduleAutosave);
  form.addEventListener('change', scheduleAutosave);
})();
