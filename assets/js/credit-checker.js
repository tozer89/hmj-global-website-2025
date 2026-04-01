(function () {
  'use strict';

  const doc = document;
  const win = window;

  const els = {
    form: doc.getElementById('creditCheckForm'),
    disabled: doc.getElementById('creditCheckDisabled'),
    submit: doc.getElementById('creditCheckSubmit'),
    message: doc.getElementById('creditCheckMessage'),
    result: doc.getElementById('creditCheckResult'),
    resultRange: doc.getElementById('creditCheckResultRange'),
    resultLow: doc.getElementById('creditCheckResultLow'),
    resultMid: doc.getElementById('creditCheckResultMid'),
    resultHigh: doc.getElementById('creditCheckResultHigh'),
    resultNarrative: doc.getElementById('creditCheckResultNarrative'),
    resultThanks: doc.getElementById('creditCheckResultThanks'),
    resultDisclaimer: doc.getElementById('creditCheckResultDisclaimer'),
    reference: doc.getElementById('creditCheckReference'),
    heading: doc.getElementById('creditCheckHeading'),
    intro: doc.getElementById('creditCheckIntro'),
    disclaimer: doc.getElementById('creditCheckDisclaimer'),
    sourceContext: doc.getElementById('creditCheckSourceContext'),
  };

  let submitLabel = els.submit ? els.submit.textContent : 'See indicative limit';

  function setMessage(text, tone) {
    if (!els.message) return;
    els.message.textContent = text || '';
    if (tone) els.message.dataset.tone = tone;
    else delete els.message.dataset.tone;
  }

  function setDisabledState(disabled) {
    if (!els.submit) return;
    els.submit.disabled = !!disabled;
    els.submit.textContent = disabled ? 'Checking…' : submitLabel;
  }

  function currentPayload(form) {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.consent_confirmed = data.get('consent_confirmed') === 'true';
    return payload;
  }

  function applyPublicSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (typeof settings.pageHeading === 'string' && settings.pageHeading && els.heading) {
      els.heading.textContent = settings.pageHeading;
    }
    if (typeof settings.pageIntro === 'string' && settings.pageIntro && els.intro) {
      els.intro.textContent = settings.pageIntro;
    }
    if (typeof settings.buttonLabel === 'string' && settings.buttonLabel && els.submit) {
      submitLabel = settings.buttonLabel;
      els.submit.textContent = settings.buttonLabel;
    }
    if (typeof settings.pageDisclaimer === 'string' && settings.pageDisclaimer && els.disclaimer) {
      els.disclaimer.textContent = settings.pageDisclaimer;
    }
  }

  function setUnavailable(message) {
    if (els.disabled) {
      els.disabled.hidden = false;
      if (message) els.disabled.innerHTML = message;
    }
    if (els.form) {
      Array.from(els.form.elements || []).forEach(function (field) {
        field.disabled = true;
      });
    }
  }

  async function loadPublicSettings() {
    try {
      const response = await fetch('/.netlify/functions/public-settings', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const payload = await response.json().catch(function () { return null; });
      if (!response.ok || !payload || payload.ok === false) return;
      const settings = payload.settings && payload.settings.creditChecker;
      applyPublicSettings(settings);
      if (settings && settings.enabled === false) {
        setUnavailable('The indicative credit checker is temporarily unavailable. Please contact HMJ directly at <a href="mailto:info@hmj-global.com">info@hmj-global.com</a>.');
      }
    } catch (_) {
      // Leave the static form in place if the settings probe fails.
    }
  }

  function populateSourceContext() {
    try {
      const params = new URLSearchParams(win.location.search || '');
      const source = params.get('src');
      if (source && els.sourceContext) {
        els.sourceContext.value = source.slice(0, 120);
      }
    } catch (_) {
      // Ignore search-param issues.
    }
  }

  function renderResult(payload) {
    const result = payload && payload.result;
    if (!result || !els.result) return;
    els.result.hidden = false;
    els.resultRange.textContent = result.rangeLabel || '';
    els.resultLow.textContent = result.lowLabel || '';
    els.resultMid.textContent = result.midLabel || '';
    els.resultHigh.textContent = result.highLabel || '';
    els.resultNarrative.textContent = result.narrative || '';
    els.resultThanks.textContent = result.thankYouMessage || '';
    els.resultDisclaimer.textContent = result.disclaimer || '';

    if (payload.leadReference) {
      els.reference.hidden = false;
      els.reference.textContent = 'Reference: ' + payload.leadReference;
    } else {
      els.reference.hidden = true;
      els.reference.textContent = '';
    }

    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!els.form) return;

    setMessage('', '');
    setDisabledState(true);

    try {
      const response = await fetch('/.netlify/functions/credit-check-submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(currentPayload(els.form)),
      });
      const payload = await response.json().catch(function () { return {}; });

      if (!response.ok || !payload.ok) {
        setMessage(payload.error || 'We could not run the indicative check just now.', 'error');
        return;
      }

      setMessage('Indicative range ready.', 'success');
      renderResult(payload);
    } catch (_) {
      setMessage('We could not run the indicative check just now.', 'error');
    } finally {
      setDisabledState(false);
    }
  }

  if (els.form) {
    populateSourceContext();
    loadPublicSettings();
    els.form.addEventListener('submit', handleSubmit);
  }
})();
