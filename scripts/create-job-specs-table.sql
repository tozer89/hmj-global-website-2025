-- Snapshot storage for HMJ admin shareable job-spec links.
create table if not exists public.job_specs (
  slug text primary key,
  job_id text not null,
  title text,
  payload jsonb not null,
  notes text,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists job_specs_job_id_idx
  on public.job_specs (job_id);

create index if not exists job_specs_expires_at_idx
  on public.job_specs (expires_at);
