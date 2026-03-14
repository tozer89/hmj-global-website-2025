(function () {
  'use strict';

  if (window.HMJAnalytics && window.HMJAnalytics.__initialized) {
    return;
  }

  const CONFIG = {
    endpoint: '/.netlify/functions/analytics-ingest',
    heartbeatMs: 30000,
    idleTimeoutMs: 10 * 60 * 1000,
    flushDebounceMs: 1200,
    maxQueueEvents: 120,
    maxBatchEvents: 20,
  };

  const KEYS = {
    visitor: 'hmj.analytics.visitor:v1',
    queue: 'hmj.analytics.queue:v1',
    session: 'hmj.analytics.session:v1',
    attribution: 'hmj.analytics.attribution:v1',
  };

  const state = {
    visitorId: '',
    session: null,
    attribution: null,
    pageVisitId: '',
    pagePath: '',
    pageStartedAt: 0,
    activeMs: 0,
    activeWindowStartedAt: 0,
    lastInteractionAt: Date.now(),
    lastHeartbeatSeconds: 0,
    pendingNavigationPath: '',
    flushTimer: 0,
    flushInFlight: false,
    pageFinalized: false,
    heartbeatTimer: 0,
    siteArea: 'public',
    deviceType: 'desktop',
    timezone: '',
  };

  function safeStorage(kind) {
    try {
      return window[kind];
    } catch {
      return null;
    }
  }

  function readJson(storage, key, fallback) {
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function trimString(value, maxLength) {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (Number.isInteger(maxLength) && maxLength > 0) return text.slice(0, maxLength);
    return text;
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `${prefix}-${window.crypto.randomUUID()}`;
      }
    } catch {}
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function currentPath() {
    const path = trimString(window.location?.pathname || '/', 240) || '/';
    return path.startsWith('/') ? path : `/${path}`;
  }

  function currentViewport() {
    return {
      width: window.innerWidth || document.documentElement?.clientWidth || 0,
      height: window.innerHeight || document.documentElement?.clientHeight || 0,
    };
  }

  function currentSiteArea(path) {
    return String(path || '').startsWith('/admin') ? 'admin' : 'public';
  }

  function detectDeviceType() {
    const width = currentViewport().width || 0;
    const ua = trimString(navigator.userAgent || '', 320).toLowerCase();
    if (/ipad|tablet/.test(ua) || (width > 767 && width <= 1024)) return 'tablet';
    if (/mobi|iphone|android.+mobile/.test(ua) || width <= 767) return 'mobile';
    return 'desktop';
  }

  function readQueue() {
    return readJson(safeStorage('localStorage'), KEYS.queue, []);
  }

  function writeQueue(queue) {
    writeJson(safeStorage('localStorage'), KEYS.queue, Array.isArray(queue) ? queue.slice(-CONFIG.maxQueueEvents) : []);
  }

  function getVisitorId() {
    const storage = safeStorage('localStorage');
    const existing = trimString(storage?.getItem(KEYS.visitor), 120);
    if (existing) return existing;
    const visitorId = createId('visitor');
    try {
      storage?.setItem(KEYS.visitor, visitorId);
    } catch {}
    return visitorId;
  }

  function initialiseSession() {
    const storage = safeStorage('sessionStorage');
    const existing = readJson(storage, KEYS.session, null);
    const now = Date.now();

    if (existing && trimString(existing.id, 120)) {
      const session = {
        id: trimString(existing.id, 120),
        startedAt: trimString(existing.startedAt, 40) || nowIso(),
        pageCount: Math.max(0, Number(existing.pageCount) || 0),
        lastActivityAt: trimString(existing.lastActivityAt, 40) || nowIso(),
      };
      session.pageCount += 1;
      session.lastActivityAt = nowIso();
      writeJson(storage, KEYS.session, session);
      return {
        ...session,
        isNew: false,
        isFirstPage: session.pageCount === 1,
      };
    }

    const session = {
      id: createId('session'),
      startedAt: nowIso(),
      pageCount: 1,
      lastActivityAt: nowIso(),
    };
    writeJson(storage, KEYS.session, session);
    return {
      ...session,
      isNew: true,
      isFirstPage: true,
      createdAtMs: now,
    };
  }

  function readAttribution() {
    return readJson(safeStorage('sessionStorage'), KEYS.attribution, null);
  }

  function writeAttribution(attribution) {
    writeJson(safeStorage('sessionStorage'), KEYS.attribution, attribution);
  }

  function buildAttribution() {
    const existing = readAttribution();
    const url = new URL(window.location.href);
    const derived = {
      referrer: trimString(document.referrer || '', 500),
      utm_source: trimString(url.searchParams.get('utm_source') || '', 120),
      utm_medium: trimString(url.searchParams.get('utm_medium') || '', 120),
      utm_campaign: trimString(url.searchParams.get('utm_campaign') || '', 160),
      utm_term: trimString(url.searchParams.get('utm_term') || '', 160),
      utm_content: trimString(url.searchParams.get('utm_content') || '', 160),
    };

    const next = {
      referrer: trimString(existing?.referrer || derived.referrer, 500),
      utm_source: trimString(existing?.utm_source || derived.utm_source, 120),
      utm_medium: trimString(existing?.utm_medium || derived.utm_medium, 120),
      utm_campaign: trimString(existing?.utm_campaign || derived.utm_campaign, 160),
      utm_term: trimString(existing?.utm_term || derived.utm_term, 160),
      utm_content: trimString(existing?.utm_content || derived.utm_content, 160),
    };

    writeAttribution(next);
    return next;
  }

  function safePayload(value, depth) {
    if (value === null || value === undefined) return null;
    if (depth > 3) return null;
    if (typeof value === 'string') return trimString(value, 320);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value.slice(0, 12).map((entry) => safePayload(entry, depth + 1)).filter((entry) => entry !== null && entry !== '');
    }
    if (typeof value === 'object') {
      const next = {};
      Object.entries(value).slice(0, 20).forEach(([key, entry]) => {
        const safeKey = trimString(key, 80);
        const safeValue = safePayload(entry, depth + 1);
        if (safeKey && safeValue !== null && safeValue !== '') {
          next[safeKey] = safeValue;
        }
      });
      return next;
    }
    return null;
  }

  function enqueue(events) {
    const queue = readQueue();
    const next = queue.concat(Array.isArray(events) ? events : []).slice(-CONFIG.maxQueueEvents);
    writeQueue(next);
  }

  function scheduleFlush(delay) {
    window.clearTimeout(state.flushTimer);
    state.flushTimer = window.setTimeout(() => {
      flush({ useBeacon: false });
    }, Number.isFinite(delay) ? delay : CONFIG.flushDebounceMs);
  }

  async function flush(options) {
    if (state.flushInFlight) return false;
    const queue = readQueue();
    if (!queue.length) return false;

    const batch = queue.slice(0, CONFIG.maxBatchEvents);
    const body = JSON.stringify({ events: batch });
    const useBeacon = !!options?.useBeacon;

    if (useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        const sent = navigator.sendBeacon(CONFIG.endpoint, blob);
        if (sent) {
          writeQueue(queue.slice(batch.length));
        }
        return sent;
      } catch {}
    }

    state.flushInFlight = true;
    try {
      const response = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: !!options?.keepalive,
      });

      if (response.ok || response.status === 202 || response.status === 400 || response.status === 413) {
        writeQueue(readQueue().slice(batch.length));
        if (readQueue().length && response.ok) {
          scheduleFlush(80);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      state.flushInFlight = false;
    }
  }

  function isVisible() {
    return document.visibilityState !== 'hidden';
  }

  function recordInteraction() {
    const now = Date.now();
    state.lastInteractionAt = now;
    if (isVisible() && !state.activeWindowStartedAt) {
      state.activeWindowStartedAt = now;
    }
  }

  function accumulateActiveTime() {
    const now = Date.now();
    if (!isVisible()) {
      state.activeWindowStartedAt = 0;
      return;
    }
    if (!state.activeWindowStartedAt) {
      state.activeWindowStartedAt = now;
      return;
    }
    const activeUntil = Math.min(now, state.lastInteractionAt + CONFIG.idleTimeoutMs);
    if (activeUntil > state.activeWindowStartedAt) {
      state.activeMs += activeUntil - state.activeWindowStartedAt;
    }
    state.activeWindowStartedAt = activeUntil >= now ? now : 0;
  }

  function currentActiveSeconds() {
    accumulateActiveTime();
    return Math.max(0, Math.round(state.activeMs / 1000));
  }

  function baseEvent(eventType, extra) {
    const payload = safePayload(extra?.payload || {}, 0) || {};
    const viewport = currentViewport();
    return {
      event_id: createId('evt'),
      occurred_at: nowIso(),
      visitor_id: state.visitorId,
      session_id: state.session.id,
      page_visit_id: extra?.pageVisitId === null ? null : (extra?.pageVisitId || state.pageVisitId),
      event_type: trimString(eventType, 80).toLowerCase(),
      site_area: state.siteArea,
      page_path: extra?.pagePath || state.pagePath,
      full_url: extra?.fullUrl || window.location.href,
      page_title: extra?.pageTitle || trimString(document.title, 240),
      referrer: state.attribution?.referrer || trimString(document.referrer, 500),
      utm_source: state.attribution?.utm_source || '',
      utm_medium: state.attribution?.utm_medium || '',
      utm_campaign: state.attribution?.utm_campaign || '',
      utm_term: state.attribution?.utm_term || '',
      utm_content: state.attribution?.utm_content || '',
      link_url: extra?.linkUrl || '',
      link_text: extra?.linkText || '',
      event_label: extra?.label || '',
      event_value: toNumber(extra?.eventValue),
      duration_seconds: toNumber(extra?.durationSeconds),
      path_from: extra?.pathFrom || '',
      path_to: extra?.pathTo || '',
      device_type: state.deviceType,
      browser_language: trimString(navigator.language || '', 32),
      viewport_width: viewport.width,
      viewport_height: viewport.height,
      timezone: state.timezone,
      user_agent: trimString(navigator.userAgent || '', 320),
      payload,
    };
  }

  function track(eventType, extra, options) {
    try {
      const event = baseEvent(eventType, extra || {});
      enqueue([event]);
      if (options?.flushImmediately) {
        void flush({ useBeacon: !!options.useBeacon, keepalive: !!options.keepalive });
      } else {
        scheduleFlush(CONFIG.flushDebounceMs);
      }
      return event;
    } catch {
      return null;
    }
  }

  function getJobContext(element) {
    const job = element?.closest?.('.job,[data-id][data-title]');
    if (!job) return {};
    return {
      job_id: trimString(job.getAttribute('data-id'), 120),
      job_title: trimString(job.getAttribute('data-title'), 180),
      job_location: trimString(job.getAttribute('data-location-label') || job.getAttribute('data-location'), 120),
      job_status: trimString(job.getAttribute('data-status'), 40),
      detail_url: trimString(job.getAttribute('data-detail-url'), 500),
    };
  }

  function parseElementPayload(element) {
    const raw = trimString(
      element?.getAttribute?.('data-analytics-payload')
        || element?.dataset?.analyticsPayload
        || '',
      1200
    );
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      const safe = safePayload(parsed, 0);
      return safe && typeof safe === 'object' && !Array.isArray(safe) ? safe : {};
    } catch {
      return {};
    }
  }

  function describeTrackedClick(target) {
    const element = target?.closest?.('[data-analytics-event],[data-analytics],a[href],button,[role="button"]');
    if (!element) return null;

    const explicitEvent = trimString(element.getAttribute('data-analytics-event') || element.getAttribute('data-analytics'), 80).toLowerCase();
    const explicitLabel = trimString(element.getAttribute('data-analytics-label') || element.getAttribute('aria-label') || element.textContent, 180);
    const link = element.closest('a[href]') || (element.matches && element.matches('a[href]') ? element : null);
    const href = trimString(link?.href || '', 500);
    let pathTo = '';
    if (href) {
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin === window.location.origin) pathTo = trimString(url.pathname, 240);
      } catch {}
    }

    const payload = Object.assign({}, getJobContext(element), parseElementPayload(element));

    if (explicitEvent) {
      return {
        eventType: explicitEvent,
        label: explicitLabel,
        linkUrl: href,
        linkText: explicitLabel,
        pathTo,
        payload,
      };
    }

    if (href.startsWith('mailto:')) {
      return { eventType: 'email_link_clicked', label: explicitLabel || href, linkUrl: href, linkText: explicitLabel, pathTo: '', payload };
    }
    if (href.startsWith('tel:')) {
      return { eventType: 'phone_link_clicked', label: explicitLabel || href, linkUrl: href, linkText: explicitLabel, pathTo: '', payload };
    }
    if (/wa\.me|whatsapp/i.test(href)) {
      return { eventType: 'whatsapp_link_clicked', label: explicitLabel || href, linkUrl: href, linkText: explicitLabel, pathTo: '', payload };
    }
    if (link?.hasAttribute('download') || /\.(pdf|docx?|xlsx?|csv)(?:$|\?)/i.test(href)) {
      return { eventType: 'download_clicked', label: explicitLabel || href, linkUrl: href, linkText: explicitLabel, pathTo, payload };
    }
    if (href && /\/contact\.html(?:$|\?)/i.test(href)) {
      return { eventType: 'contact_form_cta_clicked', label: explicitLabel || 'Contact CTA', linkUrl: href, linkText: explicitLabel, pathTo, payload };
    }
    if (href && /\/jobs(?:\.html|\/)/i.test(href) && /job|role|vacanc|search|browse/i.test(explicitLabel)) {
      return { eventType: 'jobs_browse_clicked', label: explicitLabel || 'Jobs CTA', linkUrl: href, linkText: explicitLabel, pathTo, payload };
    }
    if (href && /apply/i.test(explicitLabel)) {
      return { eventType: 'apply_cta_clicked', label: explicitLabel, linkUrl: href, linkText: explicitLabel, pathTo, payload };
    }
    return null;
  }

  function sameOriginPathFromElement(target) {
    const link = target?.closest?.('a[href]');
    if (!link) return '';
    const href = trimString(link.getAttribute('href'), 500);
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return '';
    try {
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) return '';
      return trimString(url.pathname, 240);
    } catch {
      return '';
    }
  }

  function bindClicks() {
    document.addEventListener('click', (event) => {
      const internalPath = sameOriginPathFromElement(event.target);
      if (internalPath) {
        state.pendingNavigationPath = internalPath;
      }

      const descriptor = describeTrackedClick(event.target);
      if (!descriptor) return;
      track(descriptor.eventType, {
        label: descriptor.label,
        linkUrl: descriptor.linkUrl,
        linkText: descriptor.linkText,
        pathTo: descriptor.pathTo,
        payload: descriptor.payload,
      });
    }, true);
  }

  function formDescriptor(form) {
    const id = trimString(form.getAttribute('id') || form.getAttribute('name'), 120).toLowerCase();
    if (!id) return null;
    if (id.includes('apply') || (state.pagePath === '/contact.html' && /contact|apply/.test(id))) {
      return { eventType: 'contact_form_submitted', label: 'Application submitted' };
    }
    if (id.includes('client') || form.hasAttribute('data-client-form')) {
      return { eventType: 'client_enquiry_submitted', label: 'Client enquiry submitted' };
    }
    if (id.includes('candidate')) {
      return { eventType: 'candidate_profile_submitted', label: 'Candidate profile submitted' };
    }
    return null;
  }

  function bindForms() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const descriptor = formDescriptor(form);
      if (!descriptor) return;
      track(descriptor.eventType, {
        label: descriptor.label,
        payload: {
          form_id: trimString(form.id || form.name, 120),
        },
      }, {
        flushImmediately: true,
        keepalive: true,
      });
    }, true);
  }

  function bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        accumulateActiveTime();
        track('page_hidden', {
          durationSeconds: currentActiveSeconds(),
        });
        void flush({ useBeacon: true, keepalive: true });
        return;
      }
      recordInteraction();
      track('page_visible', {
        durationSeconds: currentActiveSeconds(),
      });
    });
  }

  function bindActivitySignals() {
    const throttled = (() => {
      let last = 0;
      return () => {
        const now = Date.now();
        if (now - last < 10000) return;
        last = now;
        recordInteraction();
      };
    })();

    ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach((type) => {
      document.addEventListener(type, throttled, { passive: true, capture: true });
    });
    window.addEventListener('focus', recordInteraction, true);
    window.addEventListener('pageshow', recordInteraction, true);
  }

  function startHeartbeat() {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = window.setInterval(() => {
      if (!isVisible()) return;
      const totalSeconds = currentActiveSeconds();
      const delta = totalSeconds - state.lastHeartbeatSeconds;
      if (delta < 15) return;
      state.lastHeartbeatSeconds = totalSeconds;
      track('session_heartbeat', {
        durationSeconds: delta,
        label: 'Active heartbeat',
      });
    }, CONFIG.heartbeatMs);
  }

  function initialisePageVisit() {
    state.pageVisitId = createId('visit');
    state.pagePath = currentPath();
    state.siteArea = currentSiteArea(state.pagePath);
    state.pageStartedAt = Date.now();
    state.activeMs = 0;
    state.activeWindowStartedAt = isVisible() ? Date.now() : 0;
    state.lastHeartbeatSeconds = 0;
    state.pageFinalized = false;
    state.pendingNavigationPath = '';

    const openingEvents = [];
    if (state.session.isNew) {
      openingEvents.push(baseEvent('session_started', {
        label: 'Session started',
        pageVisitId: null,
      }));
    }
    if (state.session.isFirstPage) {
      openingEvents.push(baseEvent('landing_page', {
        label: state.pagePath,
      }));
    }
    openingEvents.push(baseEvent('page_view', {
      label: trimString(document.title, 180) || state.pagePath,
    }));

    if (state.pagePath === '/jobs/spec.html') {
      openingEvents.push(baseEvent('spec_page_opened', {
        label: trimString(document.title, 180) || 'Job spec opened',
      }));
    }

    enqueue(openingEvents);
    scheduleFlush(500);
  }

  function finalisePage(reason) {
    if (state.pageFinalized) return;
    state.pageFinalized = true;

    const durationSeconds = currentActiveSeconds();
    const leavingEvents = [
      baseEvent('page_leave', {
        label: reason,
        durationSeconds,
        pathTo: state.pendingNavigationPath,
      }),
      baseEvent('time_on_page_seconds', {
        label: 'Active time on page',
        durationSeconds,
      }),
    ];

    if (!state.pendingNavigationPath) {
      leavingEvents.push(baseEvent('exit_page', {
        label: state.pagePath,
      }));
      leavingEvents.push(baseEvent('session_ended', {
        label: 'Session ended',
        durationSeconds: Math.max(0, Math.round((Date.now() - Date.parse(state.session.startedAt || nowIso())) / 1000)),
        pageVisitId: null,
      }));
    }

    enqueue(leavingEvents);
    void flush({ useBeacon: true, keepalive: true });
  }

  function bindPageLifecycle() {
    window.addEventListener('pagehide', () => finalisePage('pagehide'));
    window.addEventListener('beforeunload', () => finalisePage('beforeunload'));
  }

  function init() {
    state.visitorId = getVisitorId();
    state.session = initialiseSession();
    state.attribution = buildAttribution();
    state.deviceType = detectDeviceType();
    try {
      state.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      state.timezone = '';
    }

    bindClicks();
    bindForms();
    bindVisibility();
    bindActivitySignals();
    bindPageLifecycle();
    initialisePageVisit();
    startHeartbeat();
  }

  recordInteraction();
  init();

  window.HMJAnalytics = {
    __initialized: true,
    track(eventType, extra, options) {
      return track(eventType, extra, options);
    },
    flush(options) {
      return flush(options || {});
    },
    getContext() {
      return {
        visitorId: state.visitorId,
        sessionId: state.session?.id || '',
        pageVisitId: state.pageVisitId,
        pagePath: state.pagePath,
        siteArea: state.siteArea,
      };
    },
  };
})();
