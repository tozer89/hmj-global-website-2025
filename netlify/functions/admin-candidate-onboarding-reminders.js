'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildEmailTemplate,
  readCandidateEmailSettings,
} = require('./_candidate-email-settings.js');
const {
  buildCandidatePortalDeepLink,
  missingRequestedDocuments,
  requestedDocumentLabel,
  summariseCandidatesOnboardingMap,
} = require('./_candidate-onboarding.js');
const { generateCandidateAccessLink } = require('./_candidate-account-admin.js');
const { isMissingRelationError } = require('./_candidate-portal.js');
const { paymentDetailsSummary } = require('./_candidate-payment-details.js');
const { sendTransactionalEmail, lowerEmail, trimString } = require('./_mail-delivery.js');

const ACTIVITY_LOOKBACK_HOURS = 24;

function buildCandidatesMap(rows = []) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
}

async function loadCandidates(supabase, body = {}) {
  let query = supabase
    .from('candidates')
    .select('id,ref,payroll_ref,full_name,first_name,last_name,email,status,auth_user_id,right_to_work_status,updated_at,created_at')
    .order('updated_at', { ascending: false })
    .limit(500);

  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map((value) => String(value)) : [];
  if (ids.length) query = query.in('id', ids);
  if (trimString(body.status, 40)) query = query.eq('status', trimString(body.status, 40));

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadDocumentsByCandidateId(supabase, candidateIds = []) {
  if (!candidateIds.length) return new Map();
  const { data, error } = await supabase
    .from('candidate_documents')
    .select('id,candidate_id,document_type,label,filename,original_filename,uploaded_at,created_at')
    .in('candidate_id', candidateIds.map(String));
  if (error && !isMissingRelationError(error)) throw error;
  const map = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const key = String(row.candidate_id);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  });
  return map;
}

async function loadPaymentsByCandidateId(supabase, candidateIds = []) {
  if (!candidateIds.length) return new Map();
  const { data, error } = await supabase
    .from('candidate_payment_details')
    .select('*')
    .in('candidate_id', candidateIds.map(String));
  if (error && !isMissingRelationError(error)) throw error;
  const map = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    map.set(String(row.candidate_id), paymentDetailsSummary(row));
  });
  return map;
}

async function loadRecentReminderMap(supabase, candidateIds = []) {
  if (!candidateIds.length) return new Map();
  const since = new Date(Date.now() - ACTIVITY_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('candidate_activity')
    .select('candidate_id,activity_type,created_at,meta')
    .in('candidate_id', candidateIds.map(String))
    .in('activity_type', ['rtw_reminder_sent', 'candidate_document_request_sent'])
    .gte('created_at', since);
  if (error && !isMissingRelationError(error)) throw error;
  const map = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const key = String(row.candidate_id);
    const current = map.get(key);
    if (!current || String(row.created_at || '') > String(current)) {
      map.set(key, row.created_at || since);
    }
  });
  return map;
}

function displayCandidateName(candidate = {}) {
  return trimString(
    candidate.full_name
    || [candidate.first_name, candidate.last_name].filter(Boolean).join(' '),
    240,
  ) || 'there';
}

function documentListText(documentTypes = []) {
  const labels = documentTypes.map((type) => requestedDocumentLabel(type));
  if (!labels.length) return 'documents';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.slice(-1)}`;
}

function buildReminderContent(settings, candidateName, actionUrl, documentTypes = ['right_to_work'], options = {}) {
  const labelsText = documentListText(documentTypes);
  const safeCandidateName = candidateName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const safeLabelsText = labelsText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const isRightToWorkOnly = documentTypes.length === 1 && documentTypes[0] === 'right_to_work';
  const heading = isRightToWorkOnly ? 'Complete your right-to-work documents' : 'Complete your HMJ onboarding documents';
  const secureAccessCopy = options.linkType === 'invite'
    ? 'Use the secure HMJ access button below to finish opening your candidate account and go straight to the correct upload area.'
    : 'Use the secure HMJ access button below to go straight to the correct upload area in your candidate account.';
  const intro = isRightToWorkOnly
    ? `HMJ Global needs your passport or right-to-work evidence to keep your onboarding moving. ${secureAccessCopy}`
    : `HMJ Global needs your ${labelsText.toLowerCase()} to complete onboarding. ${secureAccessCopy}`;
  const html = buildEmailTemplate(settings, {
    heading,
    intro,
    actionLabel: isRightToWorkOnly ? 'Open secure right-to-work upload' : 'Open secure HMJ uploads',
    actionUrl,
    bodyHtml: `
      <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Hi ${safeCandidateName},</p>
      <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">HMJ uses this area for onboarding documents such as passports, certificates, references, visas, and share-code evidence.</p>
      <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">If you have not completed your online setup yet, the secure link above will guide you through access first and then open the correct HMJ upload area for this request.</p>
      ${isRightToWorkOnly ? '' : `<p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Requested documents: <strong>${safeLabelsText}</strong>.</p>`}
      <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Once you are inside your candidate account, upload the requested documents and HMJ will route them into the correct verification section automatically.</p>
      <p style="margin:0;color:#42557f;font-size:15px;line-height:1.7">If you have already uploaded the right file, you can ignore this reminder.</p>
    `,
    fallbackLinks: [
      { label: isRightToWorkOnly ? 'Open secure right-to-work upload' : 'Open secure HMJ uploads', url: actionUrl },
    ],
  });
  return {
    subject: isRightToWorkOnly
      ? 'Action required: upload your HMJ right-to-work documents'
      : 'Action required: upload your HMJ onboarding documents',
    html,
  };
}

function reminderDeliveryMessage(error) {
  const smtpCode = error?.details?.smtp?.code || error?.code || '';
  const smtpMessage = String(error?.details?.smtp?.message || error?.message || '');
  const resendCode = error?.details?.resend?.code || '';

  if (smtpCode === 'EAUTH' || /Authentication unsuccessful|Invalid login/i.test(smtpMessage)) {
    return 'Candidate emails could not be sent because the saved SMTP login was rejected by Microsoft 365. Update the mailbox password or app password in Admin Settings.';
  }
  if (error?.code === 'resend_email_failed' || resendCode === 'resend_email_failed') {
    return 'Candidate emails could not be sent because the RESEND_API_KEY configured in Netlify was rejected. Fix the key or save working SMTP details in Admin Settings.';
  }
  if (error?.code === 'email_provider_not_configured') {
    return 'Candidate emails are not configured. Add a working RESEND_API_KEY or save SMTP details in Admin Settings before sending reminders.';
  }
  return error?.message || 'Candidate onboarding email delivery failed.';
}

async function recordReminderActivity(supabase, candidateId, actorEmail, activityType, meta) {
  await supabase.from('candidate_activity').insert({
    candidate_id: String(candidateId),
    activity_type: activityType,
    description: activityType === 'rtw_reminder_sent'
      ? 'Right-to-work reminder email sent from admin candidates.'
      : 'Candidate document request email sent from admin candidates.',
    actor_role: 'admin',
    actor_identifier: actorEmail || null,
    meta: {
      source: 'admin_candidates_bulk',
      ...(meta || {}),
    },
    created_at: new Date().toISOString(),
  }).catch(() => null);
}

const baseHandler = async (event, context) => {
  const { supabase, user } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');

  const body = JSON.parse(event.body || '{}');
  const action = trimString(body.action, 80).toLowerCase() || 'preview';
  const requestType = trimString(body.requestType, 40).toLowerCase() || 'rtw';
  const requestedDocuments = Array.isArray(body.documentTypes)
    ? body.documentTypes.map((value) => trimString(value, 80).toLowerCase()).filter(Boolean)
    : [];

  const candidates = await loadCandidates(supabase, body);
  const candidateIds = candidates.map((row) => String(row.id));
  const [docsByCandidateId, paymentsByCandidateId] = await Promise.all([
    loadDocumentsByCandidateId(supabase, candidateIds),
    loadPaymentsByCandidateId(supabase, candidateIds),
  ]);
  const onboardingByCandidateId = summariseCandidatesOnboardingMap(candidates, {
    docsByCandidateId,
    paymentsByCandidateId,
  });

  const eligible = candidates
    .map((candidate) => ({
      candidate,
      onboarding: onboardingByCandidateId.get(String(candidate.id)) || null,
      missingDocuments: missingRequestedDocuments(
        candidate,
        docsByCandidateId.get(String(candidate.id)) || [],
        requestType === 'rtw' ? ['right_to_work'] : requestedDocuments,
        paymentsByCandidateId.get(String(candidate.id)) || null,
      ),
    }))
    .filter(({ candidate, onboarding, missingDocuments }) => {
      if (!candidate?.id || !lowerEmail(candidate.email)) return false;
      if (String(candidate.status || '').toLowerCase() === 'archived') return false;
      if (!onboarding) return false;
      if (requestType === 'rtw') return missingDocuments.includes('right_to_work');
      return missingDocuments.length > 0;
    });

  if (action === 'preview') {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        totalCandidates: candidates.length,
        totalEligible: eligible.length,
        candidates: eligible.map(({ candidate, onboarding }) => ({
          id: candidate.id,
          full_name: displayCandidateName(candidate),
          email: lowerEmail(candidate.email),
          onboarding,
          missingDocuments: requestType === 'rtw'
            ? ['right_to_work']
            : missingRequestedDocuments(
              candidate,
              docsByCandidateId.get(String(candidate.id)) || [],
              requestedDocuments,
              paymentsByCandidateId.get(String(candidate.id)) || null,
            ),
        })),
        requestType,
        documentTypes: requestType === 'rtw' ? ['right_to_work'] : requestedDocuments,
      }),
    };
  }

  if (action !== 'send') {
    throw coded(400, 'Unknown onboarding reminder action.');
  }

  const settingsResult = await readCandidateEmailSettings(event);
  const settings = settingsResult?.settings || {};
  const recentReminderMap = await loadRecentReminderMap(supabase, eligible.map(({ candidate }) => candidate.id));
  const sent = [];
  const skipped = [];
  const actionDocuments = requestType === 'rtw' ? ['right_to_work'] : requestedDocuments;
  const activityType = requestType === 'rtw' ? 'rtw_reminder_sent' : 'candidate_document_request_sent';
  const redirectUrl = buildCandidatePortalDeepLink(event, {
    tab: 'documents',
    focus: requestType === 'rtw' ? 'right_to_work' : 'documents',
    onboarding: true,
    documents: actionDocuments,
  });

  for (const entry of eligible) {
    const candidate = entry.candidate;
    const candidateId = String(candidate.id);
    if (recentReminderMap.has(candidateId) && body.force !== true) {
      skipped.push({
        id: candidate.id,
        email: lowerEmail(candidate.email),
        reason: 'recently_sent',
      });
      continue;
    }

    const accessLink = await generateCandidateAccessLink(supabase, candidate, redirectUrl, {
      email: candidate.email,
    });
    const actionUrl = accessLink?.action_link || redirectUrl;
    const content = buildReminderContent(settings, displayCandidateName(candidate), actionUrl, actionDocuments, {
      linkType: accessLink?.link_type || null,
    });

    try {
      await sendTransactionalEmail({
        toEmail: lowerEmail(candidate.email),
        fromEmail: settings.senderEmail || settings.supportEmail || 'info@hmj-global.com',
        fromName: settings.senderName || 'HMJ Global',
        replyTo: settings.supportEmail || settings.senderEmail || '',
        subject: content.subject,
        html: content.html,
        smtpSettings: settings,
      });
    } catch (error) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          code: error?.code || 'candidate_onboarding_email_failed',
          message: reminderDeliveryMessage(error),
          details: error?.details || null,
          requestType,
          documentTypes: actionDocuments,
          actionUrl,
          redirectUrl,
          totalEligible: eligible.length,
        }),
      };
    }
    await recordReminderActivity(supabase, candidate.id, user?.email || null, activityType, {
      document_types: actionDocuments,
      link_type: accessLink?.link_type || null,
      created_account: !!accessLink?.created_account,
    });
    sent.push({
      id: candidate.id,
      email: lowerEmail(candidate.email),
      link_type: accessLink?.link_type || null,
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      sentCount: sent.length,
      skippedCount: skipped.length,
      sent,
      skipped,
      requestType,
      documentTypes: actionDocuments,
      actionUrl: redirectUrl,
      message: sent.length
        ? (requestType === 'rtw'
          ? `Accepted ${sent.length} right-to-work reminder email${sent.length === 1 ? '' : 's'} for delivery.`
          : `Accepted ${sent.length} onboarding document request email${sent.length === 1 ? '' : 's'} for delivery.`)
        : skipped.length
          ? `No ${requestType === 'rtw' ? 'right-to-work reminders' : 'document requests'} were sent. ${skipped.length} candidate${skipped.length === 1 ? ' was' : 's were'} skipped${skipped.some((entry) => entry?.reason === 'recently_sent') ? ' because HMJ already emailed them in the last 24 hours' : ''}.`
        : (requestType === 'rtw'
          ? 'No right-to-work reminders were sent.'
          : 'No onboarding document requests were sent.'),
    }),
  };
};

exports.buildReminderContent = buildReminderContent;
exports.handler = withAdminCors(baseHandler, { requireToken: false });
