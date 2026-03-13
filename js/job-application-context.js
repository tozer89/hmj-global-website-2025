(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.HMJJobApplicationContext = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function toOrigin(value) {
    const origin = cleanText(value);
    return origin || 'https://www.hmj-global.com';
  }

  function toSearchParams(input) {
    if (input instanceof URLSearchParams) {
      return new URLSearchParams(input.toString());
    }

    const raw = cleanText(input);
    if (!raw) return new URLSearchParams();

    if (raw.includes('?')) {
      return new URLSearchParams(raw.slice(raw.indexOf('?') + 1));
    }

    return new URLSearchParams(raw.replace(/^\?/, ''));
  }

  function isInternalContactUrl(url, origin) {
    if (!(url instanceof URL)) return false;

    const pathname = cleanText(url.pathname).toLowerCase();
    if (!/(?:^|\/)contact\.html$/.test(pathname)) {
      return false;
    }

    const originUrl = new URL(toOrigin(origin));
    const sameOrigin = url.origin === originUrl.origin;
    const hmjDomain = /(?:^|\.)hmj-global\.com$/i.test(url.hostname);
    return sameOrigin || hmjDomain;
  }

  function resolveInternalApplyBase(rawApplyUrl, origin) {
    const base = new URL('/contact.html', toOrigin(origin));
    const raw = cleanText(rawApplyUrl);
    if (!raw) return base;

    try {
      const parsed = new URL(raw, base.origin);
      if (isInternalContactUrl(parsed, base.origin)) {
        return parsed;
      }
    } catch (err) {
      return base;
    }

    return base;
  }

  function serialiseUrl(url, origin) {
    if (!(url instanceof URL)) return '';
    const base = new URL(toOrigin(origin));
    if (url.origin === base.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.href;
  }

  function pickTitle(job) {
    return cleanText(job?.title || job?.jobTitle || job?.role || job?.name);
  }

  function pickId(job, fallback) {
    return cleanText(fallback || job?.id || job?.jobId || job?.job_id);
  }

  function pickLocation(job) {
    return cleanText(job?.locationText || job?.jobLocation || job?.location || job?.location_text);
  }

  function pickType(job) {
    return cleanText(job?.type || job?.employmentType || job?.jobType || job?.employment_type);
  }

  function pickPay(job) {
    return cleanText(job?.payText || job?.jobPay || job?.pay || job?.pay_text);
  }

  function buildApplicationUrl(options) {
    const opts = options || {};
    const origin = toOrigin(opts.origin);
    const job = opts.job || {};
    const forceInternal = opts.forceInternal !== false;
    const rawApplyUrl = cleanText(opts.rawApplyUrl || opts.applyUrl || job.applyUrl || job.apply_url);

    if (!forceInternal && rawApplyUrl) {
      try {
        const parsed = new URL(rawApplyUrl, origin);
        if (!isInternalContactUrl(parsed, origin)) {
          return parsed.href;
        }
      } catch (err) {
        // Fall through to the internal contact page if the configured URL is invalid.
      }
    }

    const url = resolveInternalApplyBase(rawApplyUrl, origin);
    const title = pickTitle(job);
    const jobId = pickId(job, opts.jobId);
    const locationText = pickLocation(job);
    const employmentType = pickType(job);
    const payText = pickPay(job);
    const shareCode = cleanText(opts.shareCode || opts.slug || opts.jobShareCode || job.shareCode);
    const source = cleanText(opts.source || 'job-share');
    const specUrl = cleanText(opts.currentUrl || opts.specUrl);

    if (title) {
      url.searchParams.set('role', title);
      url.searchParams.set('job_title', title);
    }
    if (jobId) {
      url.searchParams.set('job_id', jobId);
    }
    if (locationText) {
      url.searchParams.set('job_location', locationText);
    }
    if (employmentType) {
      url.searchParams.set('job_type', employmentType);
    }
    if (payText) {
      url.searchParams.set('job_pay', payText);
    }
    if (shareCode) {
      url.searchParams.set('job_share_code', shareCode);
    }
    if (source) {
      url.searchParams.set('job_source', source);
    }
    if (specUrl) {
      url.searchParams.set('job_spec_url', specUrl);
    }

    return serialiseUrl(url, origin);
  }

  function extractApplicationContext(input) {
    const params = toSearchParams(input);
    const title = cleanText(params.get('job_title') || params.get('role'));
    const jobId = cleanText(params.get('job_id') || params.get('jobId'));
    const locationText = cleanText(params.get('job_location'));
    const employmentType = cleanText(params.get('job_type'));
    const payText = cleanText(params.get('job_pay'));
    const shareCode = cleanText(params.get('job_share_code') || params.get('share_code'));
    const source = cleanText(params.get('job_source') || params.get('source'));
    const specUrl = cleanText(params.get('job_spec_url'));

    return {
      role: cleanText(params.get('role')),
      title,
      jobId,
      reference: jobId,
      locationText,
      employmentType,
      payText,
      shareCode,
      source,
      specUrl,
      hasContext: Boolean(title || jobId || locationText || employmentType || payText || shareCode),
    };
  }

  function buildApplicationSubject(context) {
    const ctx = context || {};
    const title = cleanText(ctx.title || ctx.role);
    const jobId = cleanText(ctx.jobId || ctx.reference);
    if (!title) return 'General application';
    return jobId ? `Application: ${title} (${jobId})` : `Application: ${title}`;
  }

  function buildApplicationSummary(context) {
    const ctx = context || {};
    return [
      cleanText(ctx.title || ctx.role),
      cleanText(ctx.locationText),
      cleanText(ctx.employmentType),
      cleanText(ctx.payText),
    ].filter(Boolean).join(' • ');
  }

  return {
    buildApplicationUrl,
    extractApplicationContext,
    buildApplicationSubject,
    buildApplicationSummary,
    cleanText,
    isInternalContactUrl,
  };
});
