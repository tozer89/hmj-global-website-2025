// admin-uploads-presign.js
import crypto from 'crypto';
import { ok, bad, pre, bodyOf } from './_lib.js';

// Example for S3-compatible storage (replace with your provider or Supabase Storage)
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  try {
    const { entity, entity_id, kind, filename, type } = bodyOf(event);
    const key = `contracts/${entity}/${entity_id}/${Date.now()}-${filename}`;
    // Do your storage signing here. For now, pretend we have a public URL:
    const public_url = `https://files.example.com/${key}`;
    const url = public_url;  // If using PUT with signed URL, return that here.
    const headers = {};      // Any required headers
    return ok({ url, headers, public_url, key, kind });
  } catch (e) { return bad(e.message); }
}
