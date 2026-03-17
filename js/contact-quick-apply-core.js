(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.HMJContactQuickApply = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function trimText(value, maxLength) {
    const text = typeof value === 'string'
      ? value.trim()
      : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function lowerEmail(value) {
    const email = trimText(value, 320);
    return email ? email.toLowerCase() : '';
  }

  function splitName(value) {
    const full = trimText(value, 240);
    if (!full) return { firstName: '', lastName: '' };
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return {
      firstName: parts.shift() || '',
      lastName: parts.join(' '),
    };
  }

  function joinText(parts, separator) {
    return parts.map((item) => trimText(item)).filter(Boolean).join(separator || ', ');
  }

  function candidateDisplayName(candidate, user) {
    const fromCandidate = trimText(candidate?.full_name, 240);
    if (fromCandidate) return fromCandidate;
    const first = trimText(candidate?.first_name, 120);
    const last = trimText(candidate?.last_name, 120);
    const joined = [first, last].filter(Boolean).join(' ');
    if (joined) return joined;
    const fromUser = trimText(user?.user_metadata?.full_name || user?.email, 240);
    return fromUser || 'HMJ candidate';
  }

  function candidateLocation(candidate) {
    return trimText(
      candidate?.location
      || joinText([candidate?.town, candidate?.county, candidate?.country], ', '),
      240
    );
  }

  function normaliseDocumentType(value) {
    return trimText(value, 120).toLowerCase().replace(/\s+/g, '_');
  }

  function extractNumericSalary(value) {
    const text = trimText(value, 160).replace(/,/g, '');
    if (!text) return '';
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (!match) return '';
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return String(Math.round(amount));
  }

  function mapAvailabilityToNotice(value) {
    const text = trimText(value, 160).toLowerCase();
    if (!text) return '';
    if (/immediate|asap|straight away|now/.test(text)) return 'Immediate';
    if (/\b1\b.*week/.test(text) || /\bone week\b/.test(text)) return '1 week';
    if (/\b2\b.*week/.test(text) || /\btwo week/.test(text)) return '2 weeks';
    if (/\b4\b.*week/.test(text) || /\bfour week/.test(text) || /\bone month\b/.test(text)) return '4 weeks';
    if (/\b8\b.*week/.test(text) || /eight week|2 months|two months/.test(text)) return '8+ weeks';
    return '';
  }

  function mapRightToWork(value, candidate) {
    const text = trimText(
      value
      || candidate?.right_to_work_status
      || joinText(candidate?.right_to_work_regions || [], ', '),
      240
    ).toLowerCase();
    if (!text) return '';
    if (/require sponsorship|needs sponsorship|need sponsorship|visa required|no right to work/.test(text)) {
      return 'No – require sponsorship';
    }
    if (/unsure|discuss|unknown|review/.test(text)) {
      return 'Unsure / discuss';
    }
    if (
      /full right to work|no sponsorship|eligible to work|authorised to work|authorized to work/.test(text)
      || (Array.isArray(candidate?.right_to_work_regions) && candidate.right_to_work_regions.length > 0)
    ) {
      return 'Yes – no sponsorship needed';
    }
    return '';
  }

  function mapRelocation(value) {
    const text = trimText(value, 120).toLowerCase();
    if (!text) return '';
    if (/^y(es)?$|open to relocation|willing to relocate/.test(text)) return 'Yes';
    if (/^n(o)?$|not open|cannot relocate|won't relocate|will not relocate/.test(text)) return 'No';
    if (/maybe|possibly|depends|open to discuss/.test(text)) return 'Maybe';
    return '';
  }

  function summariseDocuments(documents) {
    const rows = Array.isArray(documents) ? documents : [];
    const clean = rows
      .map((row) => ({
        type: normaliseDocumentType(row?.document_type || row?.type || 'other'),
        label: trimText(row?.label || row?.original_filename || row?.filename, 240),
      }))
      .filter((row) => row.type || row.label);
    const hasCv = clean.some((row) => row.type === 'cv');
    const cvLabel = clean.find((row) => row.type === 'cv')?.label || '';
    const labels = clean.slice(0, 4).map((row) => row.label || row.type.replace(/_/g, ' ')).filter(Boolean);
    return {
      count: clean.length,
      hasCv,
      cvLabel,
      labels,
      summaryText: clean.length
        ? `${clean.length} stored document${clean.length === 1 ? '' : 's'}${hasCv ? ' including a CV' : ''}`
        : 'No stored documents on record',
    };
  }

  function findExistingApplication(applications, jobId) {
    const target = trimText(jobId, 120);
    if (!target) return null;
    return (Array.isArray(applications) ? applications : []).find(
      (item) => trimText(item?.job_id, 120) === target
    ) || null;
  }

  function buildQuickApplySnapshot(input) {
    const candidate = input?.candidate || {};
    const user = input?.user || {};
    const context = input?.context || {};
    const documents = summariseDocuments(input?.documents);
    const applications = Array.isArray(input?.applications) ? input.applications : [];
    const jobId = trimText(context.jobId || context.job_id, 120);
    const email = lowerEmail(candidate.email || user.email);
    const name = candidateDisplayName(candidate, user);
    const split = splitName(name);
    const firstName = trimText(candidate.first_name || split.firstName, 120);
    const lastName = trimText(candidate.last_name || split.lastName, 120);
    const location = candidateLocation(candidate);
    const availability = trimText(candidate.availability, 160);
    const salaryExpectation = trimText(candidate.salary_expectation, 160);
    const existingApplication = findExistingApplication(applications, jobId);

    return {
      candidateId: trimText(candidate.id, 120),
      authUserId: trimText(candidate.auth_user_id || user.id, 120),
      name,
      firstName,
      lastName,
      email,
      phone: trimText(candidate.phone, 80),
      location,
      availability,
      rightToWorkStatus: trimText(candidate.right_to_work_status, 240),
      relocationPreference: trimText(candidate.relocation_preference, 120),
      salaryExpectation,
      linkedinUrl: trimText(candidate.linkedin_url, 500),
      summary: trimText(candidate.summary, 4000),
      jobId,
      roleTitle: trimText(context.title || context.role, 240),
      jobLocation: trimText(context.locationText, 240),
      jobType: trimText(context.employmentType, 120),
      jobPay: trimText(context.payText, 160),
      reference: trimText(context.reference, 120),
      shareCode: trimText(context.shareCode, 120),
      hasStoredCv: documents.hasCv,
      documentCount: documents.count,
      documentLabels: documents.labels,
      documentSummary: documents.summaryText,
      existingApplication,
      formValues: {
        first_name: firstName,
        surname: lastName,
        current_location: location,
        email,
        phone: trimText(candidate.phone, 80),
        salary_expectation: extractNumericSalary(salaryExpectation),
        notice_period: mapAvailabilityToNotice(availability),
        right_to_work: mapRightToWork(candidate.right_to_work_status, candidate),
        relocation: mapRelocation(candidate.relocation_preference),
        linkedin: trimText(candidate.linkedin_url, 500),
      },
    };
  }

  function buildQuickApplyRecruiterMessage(snapshot) {
    const lines = [
      'Quick apply submitted from an authenticated HMJ candidate account.',
    ];
    if (snapshot?.roleTitle) lines.push(`Role: ${snapshot.roleTitle}`);
    if (snapshot?.reference) lines.push(`Reference: ${snapshot.reference}`);
    if (snapshot?.candidateId) lines.push(`Candidate ID: ${snapshot.candidateId}`);
    lines.push(`Candidate: ${trimText(snapshot?.name, 240) || 'Unknown candidate'}`);
    if (snapshot?.email) lines.push(`Email: ${snapshot.email}`);
    if (snapshot?.phone) lines.push(`Phone: ${snapshot.phone}`);
    if (snapshot?.location) lines.push(`Location: ${snapshot.location}`);
    if (snapshot?.availability) lines.push(`Availability / notice: ${snapshot.availability}`);
    if (snapshot?.rightToWorkStatus) lines.push(`Right to work: ${snapshot.rightToWorkStatus}`);
    if (snapshot?.relocationPreference) lines.push(`Relocation: ${snapshot.relocationPreference}`);
    if (snapshot?.salaryExpectation) lines.push(`Salary / rate expectation: ${snapshot.salaryExpectation}`);
    if (snapshot?.linkedinUrl) lines.push(`LinkedIn: ${snapshot.linkedinUrl}`);
    lines.push(`Documents on file: ${snapshot?.documentSummary || 'No stored documents on record'}`);
    if (Array.isArray(snapshot?.documentLabels) && snapshot.documentLabels.length) {
      lines.push(`Stored documents: ${snapshot.documentLabels.join(', ')}`);
    }
    lines.push('Please review the saved HMJ candidate profile and stored documents when processing this application.');
    return lines.join('\n');
  }

  return {
    buildQuickApplyRecruiterMessage,
    buildQuickApplySnapshot,
    extractNumericSalary,
    findExistingApplication,
    mapAvailabilityToNotice,
    mapRelocation,
    mapRightToWork,
    summariseDocuments,
    trimText,
  };
});
