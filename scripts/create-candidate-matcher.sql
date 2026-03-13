create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'candidate-matcher-uploads',
  'candidate-matcher-uploads',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
where not exists (
  select 1 from storage.buckets where id = 'candidate-matcher-uploads'
);

create table if not exists public.candidate_match_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  candidate_name text,
  current_or_recent_title text,
  seniority_level text,
  primary_discipline text,
  recruiter_notes text,
  status text not null default 'completed' check (status = any (array['pending', 'processing', 'completed', 'failed'])),
  extracted_text_summary text,
  candidate_summary_json jsonb not null default '{}'::jsonb,
  raw_result_json jsonb not null default '{}'::jsonb,
  best_match_job_id text,
  best_match_job_slug text,
  best_match_job_title text,
  best_match_score numeric,
  overall_recommendation text,
  no_strong_match_reason text,
  error_message text
);

create table if not exists public.candidate_match_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  match_run_id uuid not null references public.candidate_match_runs(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text not null,
  storage_path text not null,
  extraction_status text not null default 'pending' check (extraction_status = any (array['pending', 'completed', 'failed'])),
  extracted_text text,
  extraction_error text
);

create index if not exists candidate_match_runs_created_at_idx
  on public.candidate_match_runs (created_at desc);

create index if not exists candidate_match_runs_best_match_job_id_idx
  on public.candidate_match_runs (best_match_job_id);

create index if not exists candidate_match_files_match_run_id_idx
  on public.candidate_match_files (match_run_id);

alter table public.candidate_match_runs enable row level security;
alter table public.candidate_match_files enable row level security;

comment on table public.candidate_match_runs is
  'Private candidate matcher run history for HMJ admin workflows. Netlify Functions use service-role access; browser clients should not query this table directly.';

comment on table public.candidate_match_files is
  'Private candidate matcher file metadata for HMJ admin workflows. Stored uploads remain in a private Supabase bucket and are accessed server-side only.';
