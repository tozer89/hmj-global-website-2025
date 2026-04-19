(function () {
  'use strict';

  const ACCEPTED_EXTENSIONS = new Set(['pdf', 'doc', 'docx']);
  const STORAGE_KEY = 'hmj.admin.cvFormatting.defaults.v3';
  const HISTORY_LIMIT = 10;
  const RECOMMENDED_OPTIONS = Object.freeze({
    templatePreset: 'recruiter_standard',
    anonymiseMode: 'balanced',
    tailoringMode: 'balanced',
    coverPageMode: 'full',
    outputNameMode: 'role_reference',
    targetRoleOverride: '',
    recruiterInstructions: '',
    includeRoleAlignment: true,
    includeFormattingNotes: true,
    includeWarnings: true,
    includeAdditionalInformation: true,
    preferAiAssist: true,
    saveRunHistory: true,
  });
  const LABELS = Object.freeze({
    templatePreset: {
      recruiter_standard: 'Recruiter standard',
      data_centre_priority: 'Data centre priority',
      executive_summary: 'Executive summary',
    },
    anonymiseMode: {
      light: 'Light anonymisation',
      balanced: 'Balanced anonymisation',
      strict: 'Strict anonymisation',
    },
    tailoringMode: {
      balanced: 'Balanced tailoring',
      job_first: 'Job-first tailoring',
      cv_only: 'CV-only mode',
    },
    coverPageMode: {
      full: 'Full cover page',
      condensed: 'Condensed cover page',
      skip: 'No cover page',
    },
    outputNameMode: {
      role_reference: 'Role + reference filename',
      reference_only: 'Reference-only filename',
      source_reference: 'Source + reference filename',
    },
  });

  function escapeHtml(value) {
    if (window.Admin && typeof window.Admin.escapeHtml === 'function') {
      return window.Admin.escapeHtml(value);
    }
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function extOf(name) {
    const value = String(name || '').toLowerCase();
    const index = value.lastIndexOf('.');
    return index === -1 ? '' : value.slice(index + 1);
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function formatDateTime(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const output = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const text = String(value || '').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      output.push(text);
    });
    return output;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.replace(/^data:[^,]+,/, ''));
      };
      reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
      reader.readAsDataURL(file);
    });
  }

  function classifySelectedFile(file) {
    const extension = extOf(file && file.name);
    return {
      extension,
      accepted: ACCEPTED_EXTENSIONS.has(extension),
      label: extension ? extension.toUpperCase() : 'FILE',
    };
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(String(value || ''));
    } catch (_) {
      return null;
    }
  }

  function readStoredDefaults() {
    try {
      const parsed = safeJsonParse(window.localStorage.getItem(STORAGE_KEY));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeStoredDefaults(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function chipLabel(group, value) {
    const bucket = LABELS[group] || {};
    return bucket[value] || String(value || '');
  }

  function normaliseOptions(raw) {
    const merged = Object.assign({}, RECOMMENDED_OPTIONS, raw || {});
    return {
      templatePreset: String(merged.templatePreset || RECOMMENDED_OPTIONS.templatePreset),
      anonymiseMode: String(merged.anonymiseMode || RECOMMENDED_OPTIONS.anonymiseMode),
      tailoringMode: String(merged.tailoringMode || RECOMMENDED_OPTIONS.tailoringMode),
      coverPageMode: String(merged.coverPageMode || RECOMMENDED_OPTIONS.coverPageMode),
      outputNameMode: String(merged.outputNameMode || RECOMMENDED_OPTIONS.outputNameMode),
      targetRoleOverride: String(merged.targetRoleOverride || '').slice(0, 140),
      recruiterInstructions: String(merged.recruiterInstructions || '').slice(0, 400),
      includeRoleAlignment: merged.includeRoleAlignment !== false,
      includeFormattingNotes: merged.includeFormattingNotes !== false,
      includeWarnings: merged.includeWarnings !== false,
      includeAdditionalInformation: merged.includeAdditionalInformation !== false,
      preferAiAssist: merged.preferAiAssist !== false,
      saveRunHistory: merged.saveRunHistory !== false,
    };
  }

  function buildReadyMessage(state, options) {
    if (!state.candidateFile) {
      return 'Upload a candidate CV to begin.';
    }
    if (state.jobSpecFile && options.tailoringMode !== 'cv_only') {
      return 'Candidate CV and job spec loaded. Generate when ready.';
    }
    if (state.jobSpecFile && options.tailoringMode === 'cv_only') {
      return 'Candidate CV and job spec loaded. CV-only mode will ignore the uploaded brief unless you change the tailoring setting.';
    }
    if (options.tailoringMode === 'job_first') {
      return 'Candidate CV loaded. Add a job spec if you want job-first tailoring to take effect.';
    }
    return 'Candidate CV loaded. Add a job spec if you want role-specific tailoring.';
  }

  function formatDeliveryMode(options) {
    const safeOptions = normaliseOptions(options);
    return `${chipLabel('coverPageMode', safeOptions.coverPageMode)} · ${chipLabel('outputNameMode', safeOptions.outputNameMode)}`;
  }

  function historyTone(history) {
    if (!history || typeof history !== 'object') return 'warn';
    if (history.saved) return 'ok';
    if (Array.isArray(history.warnings) && history.warnings.length) return 'warn';
    if (history.requested === false) return 'warn';
    return history.enabled ? 'ok' : 'warn';
  }

  function formatHistoryHeadline(state) {
    if (state.historyLoading) return { label: 'Loading history...', tone: 'warn' };
    if (state.historyEnabled === false) return { label: 'History unavailable', tone: 'warn' };
    if (state.historyRuns.length) return { label: `${state.historyRuns.length} recent runs`, tone: 'ok' };
    return { label: 'No stored runs yet', tone: 'warn' };
  }

  function startCase(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b([a-z])/g, function (match) {
        return match.toUpperCase();
      });
  }

  function summariseSource(run) {
    const source = String(run && run.source || '').toLowerCase();
    if (source === 'openai') return 'AI-assisted';
    if (source === 'fallback') return 'Deterministic fallback';
    if (source === 'pending') return 'Preparing';
    return source ? startCase(source) : 'Unknown source';
  }

  function summariseStatus(run) {
    const status = String(run && run.status || '').toLowerCase();
    if (status === 'completed') return { label: 'Completed', tone: 'ok' };
    if (status === 'failed') return { label: 'Failed', tone: 'bad' };
    return { label: 'Processing', tone: 'warn' };
  }

  function renderDownloadAction(label, file) {
    if (!file || !file.download_url) {
      return `<span class="cvf-chip">${escapeHtml(label)} unavailable</span>`;
    }
    return `<a class="cvf-btn cvf-btn-soft" href="${escapeHtml(file.download_url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }

    window.Admin.bootAdmin(async ({ api, sel, toast, identity }) => {
      const state = {
        busy: false,
        candidateFile: null,
        jobSpecFile: null,
        result: null,
        downloadUrl: '',
        userEmail: '',
        historyRuns: [],
        historyEnabled: null,
        historyWarnings: [],
        historyLoading: false,
      };

      const els = {
        candidateDropZone: sel('#candidateDropZone'),
        jobSpecDropZone: sel('#jobSpecDropZone'),
        candidateInput: sel('#candidateInput'),
        jobSpecInput: sel('#jobSpecInput'),
        templatePresetSelect: sel('#templatePresetSelect'),
        anonymiseModeSelect: sel('#anonymiseModeSelect'),
        tailoringModeSelect: sel('#tailoringModeSelect'),
        coverPageModeSelect: sel('#coverPageModeSelect'),
        outputNameModeSelect: sel('#outputNameModeSelect'),
        targetRoleOverrideInput: sel('#targetRoleOverrideInput'),
        recruiterInstructionsInput: sel('#recruiterInstructionsInput'),
        includeRoleAlignmentToggle: sel('#includeRoleAlignmentToggle'),
        includeFormattingNotesToggle: sel('#includeFormattingNotesToggle'),
        includeWarningsToggle: sel('#includeWarningsToggle'),
        includeAdditionalInformationToggle: sel('#includeAdditionalInformationToggle'),
        aiToggle: sel('#aiToggle'),
        saveRunHistoryToggle: sel('#saveRunHistoryToggle'),
        saveDefaultsBtn: sel('#saveDefaultsBtn'),
        restoreDefaultsBtn: sel('#restoreDefaultsBtn'),
        recommendedBtn: sel('#recommendedBtn'),
        generateBtn: sel('#generateBtn'),
        clearBtn: sel('#clearBtn'),
        statusCard: sel('#statusCard'),
        statusTitle: sel('#statusTitle'),
        statusBody: sel('#statusBody'),
        candidateFileHost: sel('#candidateFileHost'),
        jobSpecFileHost: sel('#jobSpecFileHost'),
        configSummaryChips: sel('#configSummaryChips'),
        downloadBtn: sel('#downloadBtn'),
        downloadSummary: sel('#downloadSummary'),
        targetRoleValue: sel('#targetRoleValue'),
        candidateReferenceValue: sel('#candidateReferenceValue'),
        deliveryModeValue: sel('#deliveryModeValue'),
        resultChips: sel('#resultChips'),
        redactionsList: sel('#redactionsList'),
        warningsList: sel('#warningsList'),
        historyStatusChip: sel('#historyStatusChip'),
        historyRefreshBtn: sel('#historyRefreshBtn'),
        historyWarningsHost: sel('#historyWarningsHost'),
        historyListHost: sel('#historyListHost'),
      };

      const settingControls = [
        els.candidateInput,
        els.jobSpecInput,
        els.templatePresetSelect,
        els.anonymiseModeSelect,
        els.tailoringModeSelect,
        els.coverPageModeSelect,
        els.outputNameModeSelect,
        els.targetRoleOverrideInput,
        els.recruiterInstructionsInput,
        els.includeRoleAlignmentToggle,
        els.includeFormattingNotesToggle,
        els.includeWarningsToggle,
        els.includeAdditionalInformationToggle,
        els.aiToggle,
        els.saveRunHistoryToggle,
        els.saveDefaultsBtn,
        els.restoreDefaultsBtn,
        els.recommendedBtn,
      ].filter(Boolean);

      function revokeDownload() {
        if (state.downloadUrl) {
          URL.revokeObjectURL(state.downloadUrl);
          state.downloadUrl = '';
        }
      }

      function setStatus(title, body, tone) {
        if (els.statusTitle) els.statusTitle.textContent = title || '';
        if (els.statusBody) els.statusBody.textContent = body || '';
        if (els.statusCard) els.statusCard.dataset.tone = tone || 'warn';
      }

      function setBusy(isBusy) {
        state.busy = !!isBusy;
        if (els.generateBtn) els.generateBtn.disabled = !state.candidateFile || !!isBusy;
        if (els.clearBtn) els.clearBtn.disabled = !!isBusy;
        settingControls.forEach((control) => {
          control.disabled = !!isBusy;
        });
        if (els.historyRefreshBtn) {
          els.historyRefreshBtn.disabled = !!isBusy || state.historyLoading;
        }
        if (els.generateBtn) {
          els.generateBtn.textContent = isBusy ? 'Generating...' : 'Generate client-ready CV';
        }
      }

      function collectOptions() {
        return normaliseOptions({
          templatePreset: els.templatePresetSelect && els.templatePresetSelect.value,
          anonymiseMode: els.anonymiseModeSelect && els.anonymiseModeSelect.value,
          tailoringMode: els.tailoringModeSelect && els.tailoringModeSelect.value,
          coverPageMode: els.coverPageModeSelect && els.coverPageModeSelect.value,
          outputNameMode: els.outputNameModeSelect && els.outputNameModeSelect.value,
          targetRoleOverride: els.targetRoleOverrideInput && els.targetRoleOverrideInput.value,
          recruiterInstructions: els.recruiterInstructionsInput && els.recruiterInstructionsInput.value,
          includeRoleAlignment: !!(els.includeRoleAlignmentToggle && els.includeRoleAlignmentToggle.checked),
          includeFormattingNotes: !!(els.includeFormattingNotesToggle && els.includeFormattingNotesToggle.checked),
          includeWarnings: !!(els.includeWarningsToggle && els.includeWarningsToggle.checked),
          includeAdditionalInformation: !!(els.includeAdditionalInformationToggle && els.includeAdditionalInformationToggle.checked),
          preferAiAssist: !!(els.aiToggle && els.aiToggle.checked),
          saveRunHistory: !!(els.saveRunHistoryToggle && els.saveRunHistoryToggle.checked),
        });
      }

      function applyOptions(rawOptions) {
        const options = normaliseOptions(rawOptions);
        if (els.templatePresetSelect) els.templatePresetSelect.value = options.templatePreset;
        if (els.anonymiseModeSelect) els.anonymiseModeSelect.value = options.anonymiseMode;
        if (els.tailoringModeSelect) els.tailoringModeSelect.value = options.tailoringMode;
        if (els.coverPageModeSelect) els.coverPageModeSelect.value = options.coverPageMode;
        if (els.outputNameModeSelect) els.outputNameModeSelect.value = options.outputNameMode;
        if (els.targetRoleOverrideInput) els.targetRoleOverrideInput.value = options.targetRoleOverride;
        if (els.recruiterInstructionsInput) els.recruiterInstructionsInput.value = options.recruiterInstructions;
        if (els.includeRoleAlignmentToggle) els.includeRoleAlignmentToggle.checked = !!options.includeRoleAlignment;
        if (els.includeFormattingNotesToggle) els.includeFormattingNotesToggle.checked = !!options.includeFormattingNotes;
        if (els.includeWarningsToggle) els.includeWarningsToggle.checked = !!options.includeWarnings;
        if (els.includeAdditionalInformationToggle) els.includeAdditionalInformationToggle.checked = !!options.includeAdditionalInformation;
        if (els.aiToggle) els.aiToggle.checked = !!options.preferAiAssist;
        if (els.saveRunHistoryToggle) els.saveRunHistoryToggle.checked = !!options.saveRunHistory;
        renderConfigurationSummary();
      }

      function renderConfigurationSummary(optionsOverride) {
        const options = normaliseOptions(optionsOverride || collectOptions());
        const chips = [
          chipLabel('templatePreset', options.templatePreset),
          chipLabel('anonymiseMode', options.anonymiseMode),
          chipLabel('tailoringMode', options.tailoringMode),
          chipLabel('coverPageMode', options.coverPageMode),
          chipLabel('outputNameMode', options.outputNameMode),
          options.preferAiAssist ? 'AI assist enabled' : 'Fallback only',
          options.includeRoleAlignment ? 'Role alignment on' : 'Role alignment off',
          options.includeWarnings ? 'Warnings on' : 'Warnings off',
          options.saveRunHistory ? 'Run history on' : 'Run history off',
          options.targetRoleOverride ? `Role override: ${options.targetRoleOverride}` : '',
          options.recruiterInstructions ? 'Recruiter notes included' : '',
        ].filter(Boolean);
        if (els.configSummaryChips) {
          els.configSummaryChips.innerHTML = chips.map((label) => `<span class="cvf-chip">${escapeHtml(label)}</span>`).join('');
        }
      }

      function resetResultSummary() {
        revokeDownload();
        state.result = null;
        if (els.downloadBtn) {
          els.downloadBtn.hidden = true;
          els.downloadBtn.removeAttribute('href');
          els.downloadBtn.removeAttribute('download');
        }
        if (els.downloadSummary) {
          els.downloadSummary.textContent = 'Generate a CV and the finished `.docx` will be downloaded automatically. You can also re-download it from here.';
        }
        if (els.targetRoleValue) els.targetRoleValue.textContent = 'Not generated yet';
        if (els.candidateReferenceValue) els.candidateReferenceValue.textContent = 'Not generated yet';
        if (els.deliveryModeValue) els.deliveryModeValue.textContent = 'Not generated yet';
        if (els.resultChips) {
          els.resultChips.innerHTML = '<span class="cvf-chip">No run yet</span>';
        }
        if (els.redactionsList) {
          els.redactionsList.innerHTML = '<li>Redaction details will appear after generation.</li>';
        }
        if (els.warningsList) {
          els.warningsList.innerHTML = '<li>No warnings yet.</li>';
        }
      }

      function renderFileHost(host, file, label, key) {
        if (!host) return;
        if (!file) {
          host.className = 'cvf-empty';
          host.innerHTML = `No ${escapeHtml(label)} selected yet.`;
          return;
        }
        const classification = classifySelectedFile(file);
        host.className = 'cvf-file-card';
        host.innerHTML = `
          <strong>${escapeHtml(file.name)}</strong>
          <div class="cvf-file-meta">${escapeHtml(classification.label)} · ${escapeHtml(formatSize(file.size))}</div>
          <div class="cvf-file-actions">
            <span class="cvf-chip">${escapeHtml(label)}</span>
            <button class="cvf-btn cvf-btn-soft" type="button" data-remove-file="${escapeHtml(key)}">Remove</button>
          </div>
        `;
      }

      function renderIntake() {
        renderFileHost(els.candidateFileHost, state.candidateFile, 'candidate CV', 'candidate');
        renderFileHost(els.jobSpecFileHost, state.jobSpecFile, 'job spec', 'jobSpec');
      }

      function renderResult() {
        const result = state.result;
        if (!result) return;

        const profile = result.profile || {};
        const analysis = result.analysis || {};
        const optionsUsed = normaliseOptions(analysis.optionsUsed || collectOptions());
        const history = result.history || {};
        const aiAttempts = Array.isArray(analysis.aiAttempts) ? analysis.aiAttempts : [];
        const historyWarnings = Array.isArray(analysis.historyWarnings) ? analysis.historyWarnings : [];
        const warnings = uniqueStrings((Array.isArray(analysis.warnings) ? analysis.warnings : []).concat(historyWarnings));
        const redactions = Array.isArray(analysis.redactionsApplied) ? analysis.redactionsApplied : [];
        const backupModelUsed = aiAttempts.length > 1 && result.model && aiAttempts[0] && aiAttempts[0].model !== result.model;

        if (els.targetRoleValue) {
          els.targetRoleValue.textContent = profile.targetRole || analysis.targetRole || 'Untitled';
        }
        if (els.candidateReferenceValue) {
          els.candidateReferenceValue.textContent = profile.candidateReference || analysis.candidateReference || 'HMJ-CANDIDATE';
        }
        if (els.deliveryModeValue) {
          els.deliveryModeValue.textContent = formatDeliveryMode(optionsUsed);
        }
        if (els.resultChips) {
          const chips = [
            `<span class="cvf-chip" data-tone="ok">${escapeHtml(result.source === 'openai' ? 'AI-assisted output' : 'Fallback output')}</span>`,
            `<span class="cvf-chip">${escapeHtml(analysis.tailoredToJobSpec ? 'Job spec applied' : 'CV-led output')}</span>`,
            `<span class="cvf-chip">${escapeHtml(chipLabel('templatePreset', optionsUsed.templatePreset))}</span>`,
            `<span class="cvf-chip">${escapeHtml(chipLabel('anonymiseMode', optionsUsed.anonymiseMode))}</span>`,
            result.model ? `<span class="cvf-chip">${escapeHtml(result.model)}</span>` : '',
            analysis.candidateFile && analysis.candidateFile.parser ? `<span class="cvf-chip">${escapeHtml(analysis.candidateFile.parser)}</span>` : '',
            aiAttempts.length > 1 ? `<span class="cvf-chip">${escapeHtml(`${aiAttempts.length} AI attempts`)}</span>` : '',
            backupModelUsed ? '<span class="cvf-chip" data-tone="warn">Backup AI model used</span>' : '',
            history.saved ? '<span class="cvf-chip" data-tone="ok">History saved</span>' : '',
            history.requested === false ? '<span class="cvf-chip">History off</span>' : '',
            history.requested !== false && !history.saved && Array.isArray(history.warnings) && history.warnings.length
              ? '<span class="cvf-chip" data-tone="warn">History needs attention</span>'
              : '',
          ].filter(Boolean);
          els.resultChips.innerHTML = chips.join('');
        }
        if (els.redactionsList) {
          els.redactionsList.innerHTML = redactions.length
            ? redactions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
            : '<li>No explicit redactions were reported.</li>';
        }
        if (els.warningsList) {
          els.warningsList.innerHTML = warnings.length
            ? warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
            : '<li>No warnings reported for this run.</li>';
        }
        if (els.downloadSummary) {
          const fileName = result.file && result.file.name ? result.file.name : 'client-ready-cv.docx';
          if (history.saved) {
            els.downloadSummary.textContent = `${fileName} is ready and this run has been archived in Recent formatting runs.`;
          } else if (history.requested === false) {
            els.downloadSummary.textContent = `${fileName} is ready. Run history was disabled for this generation.`;
          } else if (Array.isArray(history.warnings) && history.warnings.length) {
            els.downloadSummary.textContent = `${fileName} is ready, but the run history needs attention. Review the warnings below.`;
          } else {
            els.downloadSummary.textContent = `${fileName} is ready. The browser will usually place it in Downloads.`;
          }
        }
      }

      function setDownloadFile(file) {
        revokeDownload();
        if (!file || !file.data) return;

        const binary = atob(String(file.data));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        const blob = new Blob([bytes], {
          type: file.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        state.downloadUrl = URL.createObjectURL(blob);

        if (els.downloadBtn) {
          els.downloadBtn.href = state.downloadUrl;
          els.downloadBtn.download = file.name || 'client-ready-cv.docx';
          els.downloadBtn.hidden = false;
        }
      }

      function autoDownload() {
        if (els.downloadBtn && !els.downloadBtn.hidden) {
          els.downloadBtn.click();
        }
      }

      function clearFiles() {
        state.candidateFile = null;
        state.jobSpecFile = null;
        if (els.candidateInput) els.candidateInput.value = '';
        if (els.jobSpecInput) els.jobSpecInput.value = '';
        resetResultSummary();
        renderIntake();
        setStatus('Waiting for source files', buildReadyMessage(state, collectOptions()), 'warn');
        setBusy(false);
      }

      function markConfigurationDirty() {
        renderConfigurationSummary();
        if (!state.busy) {
          setStatus(
            state.candidateFile ? 'Configuration updated' : 'Waiting for source files',
            buildReadyMessage(state, collectOptions()),
            state.candidateFile ? 'ok' : 'warn'
          );
        }
      }

      function handleFileSelection(file, key) {
        if (!file) return;
        const classification = classifySelectedFile(file);
        if (!classification.accepted) {
          toast('Use PDF, DOC, or DOCX files for CV Formatting.', 'error', 4200);
          return;
        }

        if (key === 'candidate') {
          state.candidateFile = file;
        } else {
          state.jobSpecFile = file;
        }

        resetResultSummary();
        renderIntake();
        setStatus('Ready to generate', buildReadyMessage(state, collectOptions()), 'ok');
        setBusy(false);
      }

      function bindDropZone(zone, input, key) {
        if (!zone || !input) return;
        ['dragenter', 'dragover'].forEach((eventName) => {
          zone.addEventListener(eventName, (event) => {
            event.preventDefault();
            zone.classList.add('is-dragover');
          });
        });
        ['dragleave', 'drop'].forEach((eventName) => {
          zone.addEventListener(eventName, (event) => {
            event.preventDefault();
            zone.classList.remove('is-dragover');
          });
        });
        zone.addEventListener('drop', (event) => {
          const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
          handleFileSelection(file, key);
        });
        input.addEventListener('change', () => {
          handleFileSelection(input.files && input.files[0], key);
        });
      }

      function renderHistoryWarnings() {
        if (!els.historyWarningsHost) return;
        const warnings = uniqueStrings(state.historyWarnings);
        if (!warnings.length) {
          els.historyWarningsHost.hidden = true;
          els.historyWarningsHost.textContent = '';
          return;
        }
        els.historyWarningsHost.hidden = false;
        els.historyWarningsHost.innerHTML = `<strong>History notices</strong>${warnings.map((item) => `<div>${escapeHtml(item)}</div>`).join('')}`;
      }

      function renderHistory() {
        const historyState = formatHistoryHeadline(state);
        if (els.historyStatusChip) {
          els.historyStatusChip.textContent = historyState.label;
          els.historyStatusChip.dataset.tone = historyState.tone;
        }
        if (els.historyRefreshBtn) {
          els.historyRefreshBtn.disabled = state.historyLoading || state.busy;
          els.historyRefreshBtn.textContent = state.historyLoading ? 'Refreshing...' : 'Refresh';
        }

        renderHistoryWarnings();

        if (!els.historyListHost) return;
        if (state.historyLoading && !state.historyRuns.length) {
          els.historyListHost.innerHTML = '<div class="cvf-empty">Loading recent formatting runs...</div>';
          return;
        }
        if (!state.historyRuns.length) {
          els.historyListHost.innerHTML = '<div class="cvf-empty">No stored formatting runs yet.</div>';
          return;
        }

        els.historyListHost.innerHTML = state.historyRuns.map((run) => {
          const status = summariseStatus(run);
          const downloads = run.downloads || {};
          const warningCount = Number(run.warning_count) || 0;
          const fileRows = [
            run.candidate_file_name ? `<div class="cvf-history-file"><strong>Candidate CV</strong><span>${escapeHtml(run.candidate_file_name)}</span></div>` : '',
            run.job_spec_file_name ? `<div class="cvf-history-file"><strong>Job spec</strong><span>${escapeHtml(run.job_spec_file_name)}</span></div>` : '',
            run.output_file_name ? `<div class="cvf-history-file"><strong>Formatted output</strong><span>${escapeHtml(run.output_file_name)}</span></div>` : '',
          ].filter(Boolean).join('');
          const chips = [
            `<span class="cvf-chip">${escapeHtml(summariseSource(run))}</span>`,
            run.model ? `<span class="cvf-chip">${escapeHtml(run.model)}</span>` : '',
            run.candidate_reference ? `<span class="cvf-chip">${escapeHtml(run.candidate_reference)}</span>` : '',
            warningCount ? `<span class="cvf-chip" data-tone="warn">${escapeHtml(`${warningCount} warning${warningCount === 1 ? '' : 's'}`)}</span>` : '',
          ].filter(Boolean).join('');

          return `
            <article class="cvf-history-card">
              <div class="cvf-history-head">
                <div>
                  <strong>${escapeHtml(run.target_role || run.candidate_reference || 'Recent formatting run')}</strong>
                  <p class="cvf-history-subtitle">${escapeHtml(formatDateTime(run.created_at))}${run.actor_email ? ` · ${escapeHtml(run.actor_email)}` : ''}</p>
                </div>
                <span class="cvf-chip" data-tone="${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
              </div>
              <div class="cvf-chip-row cvf-chip-row--dense">${chips || '<span class="cvf-chip">Run metadata available</span>'}</div>
              <div class="cvf-history-grid">
                <div class="cvf-history-stat">
                  <span>Reference</span>
                  <strong>${escapeHtml(run.candidate_reference || 'Not captured')}</strong>
                </div>
                <div class="cvf-history-stat">
                  <span>Output</span>
                  <strong>${escapeHtml(run.output_file_name || 'Not generated')}</strong>
                </div>
                <div class="cvf-history-stat">
                  <span>Tailored role</span>
                  <strong>${escapeHtml(run.target_role || 'Not captured')}</strong>
                </div>
              </div>
              ${fileRows ? `<div class="cvf-history-files">${fileRows}</div>` : ''}
              ${run.error_message ? `<div class="cvf-history-error">${escapeHtml(run.error_message)}</div>` : ''}
              <div class="cvf-history-actions">
                ${renderDownloadAction('Candidate CV', downloads.candidate_cv)}
                ${renderDownloadAction('Job spec', downloads.job_spec)}
                ${renderDownloadAction('Formatted output', downloads.formatted_output)}
              </div>
            </article>
          `;
        }).join('');
      }

      async function loadHistory(options) {
        const settings = options || {};
        state.historyLoading = true;
        renderHistory();
        try {
          const response = await api('/admin-cv-formatting-history-list', 'POST', { limit: HISTORY_LIMIT });
          state.historyRuns = Array.isArray(response.runs) ? response.runs : [];
          state.historyEnabled = response.history_enabled !== false;
          state.historyWarnings = Array.isArray(response.warnings) ? response.warnings : [];
        } catch (error) {
          state.historyEnabled = false;
          state.historyWarnings = [
            error && error.message
              ? `Recent runs could not be loaded: ${error.message}`
              : 'Recent runs could not be loaded right now.',
          ];
          if (!settings.silent) {
            toast('Could not refresh CV formatting history.', 'error', 3400);
          }
        } finally {
          state.historyLoading = false;
          renderHistory();
        }
      }

      async function buildPayload(file) {
        return {
          name: file.name,
          size: Number(file.size) || 0,
          contentType: file.type || '',
          data: await fileToBase64(file),
        };
      }

      async function runFormatter() {
        if (!state.candidateFile || state.busy) return;

        const options = collectOptions();
        setBusy(true);
        setStatus(
          'Formatting client-ready CV',
          options.preferAiAssist
            ? 'Extracting the uploaded document, attempting AI structuring, and falling back safely if needed...'
            : 'Extracting the uploaded document and building the Word output...',
          'warn'
        );

        try {
          const payload = {
            candidateFile: await buildPayload(state.candidateFile),
            jobSpecFile: state.jobSpecFile ? await buildPayload(state.jobSpecFile) : null,
            options,
          };

          const response = await api('/admin-cv-formatting', 'POST', payload);
          state.result = response;
          setDownloadFile(response.file);
          renderConfigurationSummary(response.analysis && response.analysis.optionsUsed);
          renderResult();

          const history = response.history || {};
          const tailoredMessage = response.analysis && response.analysis.tailoredToJobSpec
            ? 'The Word document has been tailored to the uploaded job spec and downloaded.'
            : 'The Word document has been generated and downloaded.';
          const historyMessage = history.saved
            ? 'The submitted files and output have been added to Recent formatting runs.'
            : history.requested === false
              ? 'Run history was disabled for this generation.'
              : Array.isArray(history.warnings) && history.warnings.length
                ? 'The document is ready, but run history was only partially available.'
                : '';

          setStatus(
            'Client-ready CV generated',
            `${tailoredMessage}${historyMessage ? ` ${historyMessage}` : ''}`.trim(),
            history.saved || !historyMessage ? 'ok' : 'warn'
          );
          autoDownload();
          await loadHistory({ silent: true });
          toast('Client-ready CV generated.', 'ok', 3600);
        } catch (error) {
          const history = error && error.details && error.details.history;
          if (history && Array.isArray(history.warnings)) {
            state.historyWarnings = history.warnings;
            renderHistory();
          }
          await loadHistory({ silent: true });
          setStatus(
            'Formatting failed',
            error && error.message ? error.message : 'The formatter could not complete this request.',
            'bad'
          );
          toast('CV Formatting could not complete this run.', 'error', 3600);
        } finally {
          setBusy(false);
        }
      }

      function removeSelectedFile(key) {
        if (key === 'candidate') {
          state.candidateFile = null;
          if (els.candidateInput) els.candidateInput.value = '';
        }
        if (key === 'jobSpec') {
          state.jobSpecFile = null;
          if (els.jobSpecInput) els.jobSpecInput.value = '';
        }
        resetResultSummary();
        renderIntake();
        setStatus(
          state.candidateFile ? 'Ready to generate' : 'Waiting for source files',
          buildReadyMessage(state, collectOptions()),
          state.candidateFile ? 'ok' : 'warn'
        );
        setBusy(false);
      }

      if (els.candidateFileHost) {
        els.candidateFileHost.addEventListener('click', (event) => {
          const button = event.target.closest('[data-remove-file]');
          if (!button || state.busy) return;
          removeSelectedFile(String(button.getAttribute('data-remove-file') || ''));
        });
      }

      if (els.jobSpecFileHost) {
        els.jobSpecFileHost.addEventListener('click', (event) => {
          const button = event.target.closest('[data-remove-file]');
          if (!button || state.busy) return;
          removeSelectedFile(String(button.getAttribute('data-remove-file') || ''));
        });
      }

      bindDropZone(els.candidateDropZone, els.candidateInput, 'candidate');
      bindDropZone(els.jobSpecDropZone, els.jobSpecInput, 'jobSpec');

      [
        els.templatePresetSelect,
        els.anonymiseModeSelect,
        els.tailoringModeSelect,
        els.coverPageModeSelect,
        els.outputNameModeSelect,
        els.includeRoleAlignmentToggle,
        els.includeFormattingNotesToggle,
        els.includeWarningsToggle,
        els.includeAdditionalInformationToggle,
        els.aiToggle,
        els.saveRunHistoryToggle,
      ].forEach((control) => {
        if (control) control.addEventListener('change', markConfigurationDirty);
      });

      [els.targetRoleOverrideInput, els.recruiterInstructionsInput].forEach((control) => {
        if (control) control.addEventListener('input', markConfigurationDirty);
      });

      if (els.saveDefaultsBtn) {
        els.saveDefaultsBtn.addEventListener('click', () => {
          const ok = writeStoredDefaults(collectOptions());
          toast(ok ? 'CV Formatting defaults saved.' : 'Could not save defaults in this browser.', ok ? 'ok' : 'error', 3200);
        });
      }

      if (els.restoreDefaultsBtn) {
        els.restoreDefaultsBtn.addEventListener('click', () => {
          const stored = readStoredDefaults();
          if (!stored) {
            applyOptions(RECOMMENDED_OPTIONS);
            toast('No saved defaults found. Recommended settings loaded instead.', 'warn', 3400);
            markConfigurationDirty();
            return;
          }
          applyOptions(stored);
          toast('Saved defaults loaded.', 'ok', 3000);
          markConfigurationDirty();
        });
      }

      if (els.recommendedBtn) {
        els.recommendedBtn.addEventListener('click', () => {
          applyOptions(RECOMMENDED_OPTIONS);
          toast('Recommended recruiter settings loaded.', 'ok', 3000);
          markConfigurationDirty();
        });
      }

      if (els.generateBtn) {
        els.generateBtn.addEventListener('click', runFormatter);
      }
      if (els.clearBtn) {
        els.clearBtn.addEventListener('click', clearFiles);
      }
      if (els.historyRefreshBtn) {
        els.historyRefreshBtn.addEventListener('click', function () {
          loadHistory();
        });
      }

      try {
        const who = await identity('admin', { verbose: false });
        if (who && who.email) {
          state.userEmail = who.email;
        }
      } catch (_) {
        state.userEmail = '';
      }

      applyOptions(readStoredDefaults() || RECOMMENDED_OPTIONS);
      renderIntake();
      resetResultSummary();
      renderHistory();
      setStatus(
        'Waiting for source files',
        state.userEmail
          ? `Signed in as ${state.userEmail}. ${buildReadyMessage(state, collectOptions())}`
          : buildReadyMessage(state, collectOptions()),
        'warn'
      );
      setBusy(false);

      loadHistory({ silent: true });
      window.addEventListener('beforeunload', revokeDownload);
    });
  }

  boot();
})();
