'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { trimString } = require('./_team-tasks-helpers.js');

function header(event, name) {
  const headers = event?.headers || {};
  if (headers[name]) return headers[name];
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return '';
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const attachmentId = trimString(event?.queryStringParameters?.id, 120);
    if (!attachmentId) {
      return json(400, {
        ok: false,
        code: 'attachment_id_required',
        message: 'Attachment id is required.',
      });
    }

    const { data: attachment, error: loadError } = await supabase
      .from('task_attachments')
      .select('id,file_name,storage_bucket,storage_path')
      .eq('id', attachmentId)
      .single();
    if (loadError) throw loadError;

    const bucket = trimString(attachment?.storage_bucket, 120) || 'task-files';
    const storagePath = trimString(attachment?.storage_path, 500);
    if (!storagePath) {
      return json(404, {
        ok: false,
        code: 'attachment_storage_path_missing',
        message: 'Attachment storage path is missing.',
      });
    }

    const signed = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 15);
    if (signed?.error || !signed?.data?.signedUrl) {
      throw signed?.error || new Error('Unable to create an attachment link.');
    }

    const disposition = header(event, 'x-hmj-download-mode').toLowerCase() === 'download'
      || event?.queryStringParameters?.download === '1'
      ? 'attachment'
      : 'inline';
    const redirectUrl = new URL(signed.data.signedUrl);
    if (disposition === 'attachment') {
      redirectUrl.searchParams.set('download', trimString(attachment?.file_name, 240) || 'task-file');
    }

    return {
      statusCode: 302,
      headers: {
        location: redirectUrl.toString(),
        'cache-control': 'no-store',
      },
      body: '',
    };
  } catch (error) {
    return json(error?.code === 401 ? 401 : error?.code === 403 ? 403 : 500, {
      ok: false,
      code: error?.code || 'team_task_attachment_url_failed',
      message: error?.message || 'Unable to open task attachment.',
    });
  }
});
