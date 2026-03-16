'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildEmailTemplate,
  readCandidateEmailSettings,
} = require('./_candidate-email-settings.js');
const { buildCandidatePortalDeepLink, summariseCandidatesOnboardingMap } = require('./_candidate-onboarding.js');
const { paymentDetailsSummary } = require('./_candidate-payment-details.js');
const { sendTransactionalEmail, lowerEmail, trimString } = require('./_mail-delivery.js');

const ACTIVITY_LOOKBACK_HOURS = 24;

function buildCandidatesMap(rows = []) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
}

async function loadCandidates(supabase, body = {}) {
  let query = supabase
    .from('candidates')
    .select('id,full_name,first_name,last_name,email,status,auth_user_id,right_to_work,right_to_work_status,rtw_url,bank_name,bank_account,bank_iban,updated_at,created_at')
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
  if (error && !/relation .+ does not exist/i.test(error.message || '')) throw error;
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
  if (error && !/relation .+ does not exist/i.test(error.message || '')) throw error;
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
    .select('candidate_id,activity_type,created_at')
    .in('candidate_id', candidateIds.map(String))
    .eq('activity_type', 'rtw_reminder_sent')
    .gte('created_at', since);
  if (error && !/relation .+ does not exist/i.test(error.message || '')) throw error;
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

function buildReminderContent(settings, candidateName, actionUrl) {
  const heading = 'Complete your right-to-work documents';
  const intro = `HMJ Global needs your passport or right-to-work evidence to keep your onboarding moving. Use the secure HMJ link below to open your candidate account and upload the required file.`;
  const html = buildEmailTemplate(settings, {
    heading,
    intro,
    actionLabel: 'Upload right-to-work documents',
    actionUrl,
  }).replace(
    '</table>\n          </table>\n        </td>\n      </tr>\n    </table>\n  </body>\n</html>',
    `<tr><td style="padding:0 32px 28px;color:#42557f;font-size:15px;line-height:1.6">
      <p style="margin:0 0 12px">Hi ${candidateName},</p>
      <p style="margin:0 0 12px">HMJ uses this area for onboarding documents such as passports, visas, permits, and share-code evidence.</p>
      <p style="margin:0">If you have already uploaded the right file, you can ignore this reminder.</p>
    </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  );
  return {
    subject: 'Action required: upload your HMJ right-to-work documents',
    html,
  };
}

async function recordReminderActivity(supabase, candidateId, actorEmail) {
  await supabase.from('candidate_activity').insert({
    candidate_id: String(candidateId),
    activity_type: 'rtw_reminder_sent',
    description: 'Right-to-work reminder email sent from admin candidates.',
    actor_role: 'admin',
    actor_identifier: actorEmail || null,
    meta: {
      source: 'admin_candidates_bulk',
    },
    created_at: new Date().toISOString(),
  }).catch(() => null);
}

const baseHandler = async (event, context) => {
  const { supabase, user } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');

  const body = JSON.parse(event.body || '{}');
  const action = trimString(body.action, 80).toLowerCase() || 'preview';

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
    }))
    .filter(({ candidate, onboarding }) => {
      if (!candidate?.id || !lowerEmail(candidate.email)) return false;
      if (String(candidate.status || '').toLowerCase() === 'archived') return false;
      return !!onboarding && onboarding.hasRightToWork === false;
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
        })),
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

    const actionUrl = buildCandidatePortalDeepLink(event, {
      tab: 'documents',
      focus: 'right_to_work',
      onboarding: true,
    });
    const content = buildReminderContent(settings, displayCandidateName(candidate), actionUrl);

    await sendTransactionalEmail({
      toEmail: lowerEmail(candidate.email),
      fromEmail: settings.senderEmail || settings.supportEmail || 'info@hmj-global.com',
      fromName: settings.senderName || 'HMJ Global',
      replyTo: settings.supportEmail || settings.senderEmail || '',
      subject: content.subject,
      html: content.html,
      smtpSettings: settings,
    });
    await recordReminderActivity(supabase, candidate.id, user?.email || null);
    sent.push({
      id: candidate.id,
      email: lowerEmail(candidate.email),
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
      message: sent.length
        ? `Sent ${sent.length} right-to-work reminder email${sent.length === 1 ? '' : 's'}.`
        : 'No right-to-work reminders were sent.',
    }),
  };
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
