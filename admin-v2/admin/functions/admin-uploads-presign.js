import { ok, err, parseBody, requireAdmin, supa, bucket } from './_lib.js';

export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { entity, entity_id, kind, filename } = parseBody(event);
    if(!filename) return err('filename required', 400);

    const key = `${entity}/${entity_id || 'new'}/${kind}/${Date.now()}-${filename}`;
    const sb = supa();

    const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(key);
    if (error) throw error;

    // data has: signedUrl, token
    const uploadUrl = data.signedUrl;
    const publicUrl = sb.storage.from(bucket).getPublicUrl(key).data.publicUrl;

    return ok({ url: uploadUrl, headers:{}, public_url: publicUrl, key });
  }catch(e){ return err(e.message||e, e.status||500); }
}
