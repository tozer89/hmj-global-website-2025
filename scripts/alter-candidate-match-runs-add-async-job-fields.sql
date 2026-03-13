alter table public.candidate_match_runs
  add column if not exists match_job_id text,
  add column if not exists match_job_status text check (
    match_job_status is null
    or match_job_status = any (array['queued', 'running', 'completed', 'failed'])
  ),
  add column if not exists match_job_queued_at timestamptz,
  add column if not exists match_job_started_at timestamptz,
  add column if not exists match_job_completed_at timestamptz,
  add column if not exists match_job_failed_at timestamptz,
  add column if not exists match_job_last_error text;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]::text[]
where id = 'candidate-matcher-uploads';
