'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { trimString } = require('./_team-tasks-helpers.js');

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
    const payload = JSON.parse(event.body || '{}');
    const attachmentId = trimString(payload.id, 120);
    if (!attachmentId) {
      return json(400, {
        ok: false,
        code: 'attachment_id_required',
        message: 'Attachment id is required.',
      });
    }

    const { data: attachment, error: loadError } = await supabase
      .from('task_attachments')
      .select('id,storage_bucket,storage_path')
      .eq('id', attachmentId)
      .single();
    if (loadError) throw loadError;

    const bucket = trimString(attachment?.storage_bucket, 120) || 'task-files';
    const storagePath = trimString(attachment?.storage_path, 500);
    if (storagePath) {
      const { error: storageError } = await supabase.storage.from(bucket).remove([storagePath]);
      if (storageError) {
        console.warn('[task-attachment-delete] storage cleanup failed (%s)', storageError.message || storageError);
      }
    }

    const { error: deleteError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId);
    if (deleteError) throw deleteError;

    return json(200, {
      ok: true,
      id: attachmentId,
    });
  } catch (error) {
    return json(error?.code === 401 ? 401 : error?.code === 403 ? 403 : 500, {
      ok: false,
      code: error?.code || 'team_task_attachment_delete_failed',
      message: error?.message || 'Unable to delete task attachment.',
    });
  }
});
