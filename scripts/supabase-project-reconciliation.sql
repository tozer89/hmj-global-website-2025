-- HMJ Global Supabase project reconciliation
-- Safe, additive, idempotent schema setup for the repo-backed modules.
-- This script intentionally avoids destructive changes to the existing core CRM tables
-- such as clients/candidates/assignments/timesheets because the repo does not contain
-- a single authoritative bootstrap schema for those objects.

create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin support tables
-- -----------------------------------------------------------------------------

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.admin_settings') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.admin_settings')
         and tgname = 'admin_settings_set_updated_at'
     )
  then
    create trigger admin_settings_set_updated_at
      before update on public.admin_settings
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  email text,
  role text not null default 'admin'
    check (role = any (array['admin', 'editor', 'viewer'])),
  is_active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.admin_users
  add column if not exists user_id text;
alter table if exists public.admin_users
  add column if not exists email text;
alter table if exists public.admin_users
  add column if not exists role text;
alter table if exists public.admin_users
  add column if not exists is_active boolean;
alter table if exists public.admin_users
  add column if not exists meta jsonb;
alter table if exists public.admin_users
  add column if not exists created_at timestamptz;
alter table if exists public.admin_users
  add column if not exists updated_at timestamptz;

update public.admin_users
set
  role = coalesce(nullif(role, ''), 'admin'),
  is_active = coalesce(is_active, true),
  meta = coalesce(meta, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  role is null
  or is_active is null
  or meta is null
  or created_at is null
  or updated_at is null;

create unique index if not exists admin_users_user_id_uidx
  on public.admin_users (user_id)
  where user_id is not null;

create unique index if not exists admin_users_email_uidx
  on public.admin_users ((lower(email)))
  where email is not null;

create index if not exists admin_users_active_idx
  on public.admin_users (is_active, role);

do $$
begin
  if to_regclass('public.admin_users') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.admin_users')
         and tgname = 'admin_users_set_updated_at'
     )
  then
    create trigger admin_users_set_updated_at
      before update on public.admin_users
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

comment on table public.admin_users is
  'Optional HMJ admin allow-list. The codebase primarily checks Netlify Identity roles, but this table can verify admins by user_id/email when needed.';

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  actor_email text,
  actor_id text,
  action text not null,
  target_type text,
  target_id text,
  meta jsonb not null default '{}'::jsonb
);

alter table if exists public.admin_audit_logs
  add column if not exists at timestamptz;
alter table if exists public.admin_audit_logs
  add column if not exists created_at timestamptz;
alter table if exists public.admin_audit_logs
  add column if not exists actor_email text;
alter table if exists public.admin_audit_logs
  add column if not exists actor_id text;
alter table if exists public.admin_audit_logs
  add column if not exists action text;
alter table if exists public.admin_audit_logs
  add column if not exists target_type text;
alter table if exists public.admin_audit_logs
  add column if not exists target_id text;
alter table if exists public.admin_audit_logs
  add column if not exists meta jsonb;

update public.admin_audit_logs
set
  at = coalesce(at, created_at, now()),
  created_at = coalesce(created_at, at, now()),
  meta = coalesce(meta, '{}'::jsonb)
where
  at is null
  or created_at is null
  or meta is null;

create index if not exists admin_audit_logs_at_idx
  on public.admin_audit_logs (at desc);

create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_type, target_id, at desc);

create index if not exists admin_audit_logs_action_idx
  on public.admin_audit_logs (action, at desc);

comment on table public.admin_audit_logs is
  'Audit history written by HMJ admin Netlify functions.';

create or replace function public.audit_log_view_insert_bridge()
returns trigger
language plpgsql
as $$
begin
  insert into public.admin_audit_logs (
    at,
    actor_email,
    actor_id,
    action,
    target_type,
    target_id,
    meta
  )
  values (
    coalesce(new.at, now()),
    new.actor_email,
    null,
    coalesce(new.action, 'unknown'),
    coalesce(new.entity, 'unknown'),
    new.entity_id,
    coalesce(new.payload, '{}'::jsonb)
      || case
        when new.actor_roles is null then '{}'::jsonb
        else jsonb_build_object('actor_roles', new.actor_roles)
      end
  );
  return null;
end;
$$;

create or replace function public.audit_log_table_sync_bridge()
returns trigger
language plpgsql
as $$
begin
  insert into public.admin_audit_logs (
    at,
    actor_email,
    actor_id,
    action,
    target_type,
    target_id,
    meta
  )
  values (
    coalesce(new.at, now()),
    new.actor_email,
    null,
    coalesce(new.action, 'unknown'),
    coalesce(new.entity, 'unknown'),
    new.entity_id,
    coalesce(new.payload, '{}'::jsonb)
      || case
        when new.actor_roles is null then '{}'::jsonb
        else jsonb_build_object('actor_roles', to_jsonb(new.actor_roles))
      end
  );
  return new;
exception
  when others then
    return new;
end;
$$;

do $$
declare
  audit_log_kind "char";
begin
  select c.relkind
  into audit_log_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'audit_log'
  limit 1;

  if audit_log_kind = 'r' then
    if not exists (
      select 1
      from pg_trigger
      where tgrelid = to_regclass('public.audit_log')
        and tgname = 'audit_log_sync_to_admin_audit_logs'
    ) then
      execute '
        create trigger audit_log_sync_to_admin_audit_logs
        after insert on public.audit_log
        for each row
        execute function public.audit_log_table_sync_bridge()
      ';
    end if;
  else
    execute '
      create or replace view public.audit_log as
      select
        id,
        coalesce(at, created_at) as at,
        actor_email,
        coalesce(meta->''actor_roles'', ''[]''::jsonb) as actor_roles,
        action,
        target_type as entity,
        target_id as entity_id,
        meta as payload
      from public.admin_audit_logs
    ';
    begin
      execute 'drop trigger if exists audit_log_insert_bridge on public.audit_log';
    exception
      when undefined_table then
        null;
    end;
    execute '
      create trigger audit_log_insert_bridge
      instead of insert on public.audit_log
      for each row
      execute function public.audit_log_view_insert_bridge()
    ';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Candidate documents
-- -----------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'candidate-docs',
  'candidate-docs',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  candidate_id text not null,
  label text,
  filename text not null,
  storage_key text not null unique,
  url text,
  meta jsonb not null default '{}'::jsonb
);

alter table if exists public.candidate_documents
  add column if not exists created_at timestamptz;
alter table if exists public.candidate_documents
  add column if not exists candidate_id text;
alter table if exists public.candidate_documents
  add column if not exists label text;
alter table if exists public.candidate_documents
  add column if not exists filename text;
alter table if exists public.candidate_documents
  add column if not exists storage_key text;
alter table if exists public.candidate_documents
  add column if not exists url text;
alter table if exists public.candidate_documents
  add column if not exists meta jsonb;

update public.candidate_documents
set
  created_at = coalesce(created_at, now()),
  meta = coalesce(meta, '{}'::jsonb)
where
  created_at is null
  or meta is null;

create unique index if not exists candidate_documents_storage_key_uidx
  on public.candidate_documents (storage_key);

create index if not exists candidate_documents_candidate_created_idx
  on public.candidate_documents (candidate_id, created_at desc);

comment on table public.candidate_documents is
  'Candidate document metadata used by the HMJ admin UI. Files should remain in a private Supabase bucket and be exposed to admins via signed URLs or server-controlled access only.';

-- -----------------------------------------------------------------------------
-- Noticeboard
-- -----------------------------------------------------------------------------

create table if not exists public.noticeboard_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  created_by_email text,
  updated_by_email text,
  title text not null,
  slug text not null unique,
  summary text,
  body text not null,
  image_url text,
  image_storage_key text,
  image_alt_text text,
  cta_label text,
  cta_url text,
  status text not null default 'draft'
    check (status = any (array['draft', 'scheduled', 'published', 'archived'])),
  publish_at timestamptz,
  expires_at timestamptz,
  featured boolean not null default false,
  sort_order integer not null default 100
);

alter table if exists public.noticeboard_posts
  add column if not exists created_at timestamptz;
alter table if exists public.noticeboard_posts
  add column if not exists updated_at timestamptz;
alter table if exists public.noticeboard_posts
  add column if not exists created_by text;
alter table if exists public.noticeboard_posts
  add column if not exists created_by_email text;
alter table if exists public.noticeboard_posts
  add column if not exists updated_by_email text;
alter table if exists public.noticeboard_posts
  add column if not exists title text;
alter table if exists public.noticeboard_posts
  add column if not exists slug text;
alter table if exists public.noticeboard_posts
  add column if not exists summary text;
alter table if exists public.noticeboard_posts
  add column if not exists body text;
alter table if exists public.noticeboard_posts
  add column if not exists image_url text;
alter table if exists public.noticeboard_posts
  add column if not exists image_storage_key text;
alter table if exists public.noticeboard_posts
  add column if not exists image_alt_text text;
alter table if exists public.noticeboard_posts
  add column if not exists cta_label text;
alter table if exists public.noticeboard_posts
  add column if not exists cta_url text;
alter table if exists public.noticeboard_posts
  add column if not exists status text;
alter table if exists public.noticeboard_posts
  add column if not exists publish_at timestamptz;
alter table if exists public.noticeboard_posts
  add column if not exists expires_at timestamptz;
alter table if exists public.noticeboard_posts
  add column if not exists featured boolean;
alter table if exists public.noticeboard_posts
  add column if not exists sort_order integer;

update public.noticeboard_posts
set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  status = coalesce(nullif(status, ''), 'draft'),
  featured = coalesce(featured, false),
  sort_order = coalesce(sort_order, 100)
where
  created_at is null
  or updated_at is null
  or status is null
  or featured is null
  or sort_order is null;

create index if not exists noticeboard_posts_status_publish_idx
  on public.noticeboard_posts (status, publish_at desc);

create index if not exists noticeboard_posts_featured_sort_idx
  on public.noticeboard_posts (featured desc, sort_order asc, publish_at desc);

create index if not exists noticeboard_posts_expires_idx
  on public.noticeboard_posts (expires_at);

do $$
begin
  if to_regclass('public.noticeboard_posts') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.noticeboard_posts')
         and tgname = 'noticeboard_posts_set_updated_at'
     )
  then
    create trigger noticeboard_posts_set_updated_at
      before update on public.noticeboard_posts
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'noticeboard-images',
  'noticeboard-images',
  true,
  6291456,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.noticeboard_posts is
  'HMJ public noticeboard posts. Browser clients should not query this table directly; Netlify Functions handle public filtering and admin writes.';

-- -----------------------------------------------------------------------------
-- Short links
-- -----------------------------------------------------------------------------

create table if not exists public.short_links (
  id bigint generated by default as identity primary key,
  slug text not null unique
    check (slug = lower(slug))
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  destination_url text not null
    check (destination_url ~* '^https?://'),
  title text,
  created_at timestamptz not null default timezone('utc', now()),
  created_by text,
  created_by_email text,
  is_active boolean not null default true,
  click_count integer not null default 0,
  last_used_at timestamptz
);

alter table if exists public.short_links
  add column if not exists created_at timestamptz;
alter table if exists public.short_links
  add column if not exists created_by text;
alter table if exists public.short_links
  add column if not exists created_by_email text;
alter table if exists public.short_links
  add column if not exists is_active boolean;
alter table if exists public.short_links
  add column if not exists click_count integer;
alter table if exists public.short_links
  add column if not exists last_used_at timestamptz;

update public.short_links
set
  created_at = coalesce(created_at, timezone('utc', now())),
  is_active = coalesce(is_active, true),
  click_count = coalesce(click_count, 0)
where
  created_at is null
  or is_active is null
  or click_count is null;

create index if not exists short_links_created_at_idx
  on public.short_links (created_at desc);

create index if not exists short_links_active_created_at_idx
  on public.short_links (is_active, created_at desc);

comment on table public.short_links is
  'HMJ branded short links created from the admin dashboard. Public redirects should go through Netlify Functions rather than direct browser access.';

-- -----------------------------------------------------------------------------
-- Job share storage
-- -----------------------------------------------------------------------------

create table if not exists public.job_specs (
  slug text primary key,
  job_id text not null,
  title text,
  payload jsonb not null,
  notes text,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.job_specs
  add column if not exists job_id text;
alter table if exists public.job_specs
  add column if not exists title text;
alter table if exists public.job_specs
  add column if not exists payload jsonb;
alter table if exists public.job_specs
  add column if not exists notes text;
alter table if exists public.job_specs
  add column if not exists expires_at timestamptz;
alter table if exists public.job_specs
  add column if not exists created_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_specs'
      and column_name = 'job_payload'
  ) then
    execute '
      update public.job_specs
      set payload = coalesce(payload, job_payload)
      where payload is null
        and job_payload is not null
    ';
  end if;
end
$$;

update public.job_specs
set
  payload = coalesce(payload, '{}'::jsonb),
  created_at = coalesce(created_at, timezone('utc', now()))
where
  payload is null
  or created_at is null;

create index if not exists job_specs_job_id_idx
  on public.job_specs (job_id);

create index if not exists job_specs_expires_at_idx
  on public.job_specs (expires_at);

create table if not exists public.job_seo_suggestions (
  job_id text primary key references public.jobs(id) on delete cascade,
  optimized_title text,
  meta_title text,
  meta_description text,
  slug_hint text,
  sector_focus text,
  optimized_overview text,
  optimized_responsibilities jsonb not null default '[]'::jsonb,
  optimized_requirements jsonb not null default '[]'::jsonb,
  schema_missing_fields jsonb not null default '[]'::jsonb,
  source text not null default 'heuristic',
  model text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.job_seo_suggestions
  add column if not exists optimized_title text;
alter table if exists public.job_seo_suggestions
  add column if not exists meta_title text;
alter table if exists public.job_seo_suggestions
  add column if not exists meta_description text;
alter table if exists public.job_seo_suggestions
  add column if not exists slug_hint text;
alter table if exists public.job_seo_suggestions
  add column if not exists sector_focus text;
alter table if exists public.job_seo_suggestions
  add column if not exists optimized_overview text;
alter table if exists public.job_seo_suggestions
  add column if not exists optimized_responsibilities jsonb;
alter table if exists public.job_seo_suggestions
  add column if not exists optimized_requirements jsonb;
alter table if exists public.job_seo_suggestions
  add column if not exists schema_missing_fields jsonb;
alter table if exists public.job_seo_suggestions
  add column if not exists source text;
alter table if exists public.job_seo_suggestions
  add column if not exists model text;
alter table if exists public.job_seo_suggestions
  add column if not exists payload jsonb;
alter table if exists public.job_seo_suggestions
  add column if not exists last_error text;
alter table if exists public.job_seo_suggestions
  add column if not exists created_at timestamptz;
alter table if exists public.job_seo_suggestions
  add column if not exists updated_at timestamptz;

update public.job_seo_suggestions
set
  optimized_responsibilities = coalesce(optimized_responsibilities, '[]'::jsonb),
  optimized_requirements = coalesce(optimized_requirements, '[]'::jsonb),
  schema_missing_fields = coalesce(schema_missing_fields, '[]'::jsonb),
  source = coalesce(nullif(source, ''), 'heuristic'),
  payload = coalesce(payload, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

do $$
begin
  if to_regclass('public.job_seo_suggestions') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.job_seo_suggestions')
         and tgname = 'job_seo_suggestions_set_updated_at'
     )
  then
    create trigger job_seo_suggestions_set_updated_at
      before update on public.job_seo_suggestions
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

create index if not exists job_seo_suggestions_source_idx
  on public.job_seo_suggestions (source);

create index if not exists job_seo_suggestions_updated_idx
  on public.job_seo_suggestions (updated_at desc);

-- -----------------------------------------------------------------------------
-- Candidate matcher
-- -----------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
select
  'candidate-matcher-uploads',
  'candidate-matcher-uploads',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]::text[]
where not exists (
  select 1 from storage.buckets where id = 'candidate-matcher-uploads'
);

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]::text[]
where id = 'candidate-matcher-uploads';

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
  status text not null default 'completed'
    check (status = any (array['pending', 'processing', 'completed', 'failed'])),
  extracted_text_summary text,
  candidate_summary_json jsonb not null default '{}'::jsonb,
  raw_result_json jsonb not null default '{}'::jsonb,
  best_match_job_id text,
  best_match_job_slug text,
  best_match_job_title text,
  best_match_score numeric,
  overall_recommendation text,
  no_strong_match_reason text,
  error_message text,
  match_job_id text,
  match_job_status text check (
    match_job_status is null
    or match_job_status = any (array['queued', 'running', 'completed', 'failed'])
  ),
  match_job_queued_at timestamptz,
  match_job_started_at timestamptz,
  match_job_completed_at timestamptz,
  match_job_failed_at timestamptz,
  match_job_last_error text
);

alter table if exists public.candidate_match_runs
  add column if not exists updated_at timestamptz;
alter table if exists public.candidate_match_runs
  add column if not exists candidate_summary_json jsonb;
alter table if exists public.candidate_match_runs
  add column if not exists raw_result_json jsonb;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_id text;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_status text;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_queued_at timestamptz;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_started_at timestamptz;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_completed_at timestamptz;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_failed_at timestamptz;
alter table if exists public.candidate_match_runs
  add column if not exists match_job_last_error text;

update public.candidate_match_runs
set
  updated_at = coalesce(updated_at, now()),
  candidate_summary_json = coalesce(candidate_summary_json, '{}'::jsonb),
  raw_result_json = coalesce(raw_result_json, '{}'::jsonb)
where
  updated_at is null
  or candidate_summary_json is null
  or raw_result_json is null;

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
  extraction_status text not null default 'pending'
    check (extraction_status = any (array['pending', 'completed', 'failed'])),
  extracted_text text,
  extraction_error text
);

create index if not exists candidate_match_runs_created_at_idx
  on public.candidate_match_runs (created_at desc);

create index if not exists candidate_match_runs_best_match_job_id_idx
  on public.candidate_match_runs (best_match_job_id);

create index if not exists candidate_match_runs_status_idx
  on public.candidate_match_runs (status, created_at desc);

create index if not exists candidate_match_runs_match_job_status_idx
  on public.candidate_match_runs (match_job_status, match_job_queued_at desc);

create index if not exists candidate_match_files_match_run_id_idx
  on public.candidate_match_files (match_run_id);

do $$
begin
  if to_regclass('public.candidate_match_runs') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.candidate_match_runs')
         and tgname = 'candidate_match_runs_set_updated_at'
     )
  then
    create trigger candidate_match_runs_set_updated_at
      before update on public.candidate_match_runs
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

comment on table public.candidate_match_runs is
  'Private candidate matcher run history for HMJ admin workflows. Netlify Functions use service-role access; browser clients should not query this table directly.';

comment on table public.candidate_match_files is
  'Private candidate matcher file metadata for HMJ admin workflows. Stored uploads remain in a private Supabase bucket and are accessed server-side only.';

-- -----------------------------------------------------------------------------
-- Chatbot module
-- -----------------------------------------------------------------------------

create table if not exists public.chatbot_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_route text,
  latest_route text,
  latest_page_title text,
  page_category text,
  ip_address text,
  ip_hash text,
  user_agent text,
  initial_intent text,
  latest_intent text,
  message_count integer not null default 0,
  assistant_message_count integer not null default 0,
  handoff_count integer not null default 0,
  last_handoff_reason text,
  last_message_preview text,
  metadata jsonb not null default '{}'::jsonb
);

alter table if exists public.chatbot_conversations add column if not exists created_at timestamptz not null default now();
alter table if exists public.chatbot_conversations add column if not exists updated_at timestamptz not null default now();
alter table if exists public.chatbot_conversations add column if not exists first_route text;
alter table if exists public.chatbot_conversations add column if not exists latest_route text;
alter table if exists public.chatbot_conversations add column if not exists latest_page_title text;
alter table if exists public.chatbot_conversations add column if not exists page_category text;
alter table if exists public.chatbot_conversations add column if not exists ip_address text;
alter table if exists public.chatbot_conversations add column if not exists ip_hash text;
alter table if exists public.chatbot_conversations add column if not exists user_agent text;
alter table if exists public.chatbot_conversations add column if not exists initial_intent text;
alter table if exists public.chatbot_conversations add column if not exists latest_intent text;
alter table if exists public.chatbot_conversations add column if not exists message_count integer not null default 0;
alter table if exists public.chatbot_conversations add column if not exists assistant_message_count integer not null default 0;
alter table if exists public.chatbot_conversations add column if not exists handoff_count integer not null default 0;
alter table if exists public.chatbot_conversations add column if not exists last_handoff_reason text;
alter table if exists public.chatbot_conversations add column if not exists last_message_preview text;
alter table if exists public.chatbot_conversations add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.chatbot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chatbot_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role = any (array['user', 'assistant'])),
  content text not null,
  intent text,
  cta_ids jsonb not null default '[]'::jsonb,
  quick_reply_ids jsonb not null default '[]'::jsonb,
  handoff boolean not null default false,
  handoff_reason text,
  fallback boolean not null default false,
  model text,
  response_id text,
  route text,
  page_title text,
  page_category text,
  metadata jsonb not null default '{}'::jsonb
);

alter table if exists public.chatbot_messages add column if not exists created_at timestamptz not null default now();
alter table if exists public.chatbot_messages add column if not exists intent text;
alter table if exists public.chatbot_messages add column if not exists cta_ids jsonb not null default '[]'::jsonb;
alter table if exists public.chatbot_messages add column if not exists quick_reply_ids jsonb not null default '[]'::jsonb;
alter table if exists public.chatbot_messages add column if not exists handoff boolean not null default false;
alter table if exists public.chatbot_messages add column if not exists handoff_reason text;
alter table if exists public.chatbot_messages add column if not exists fallback boolean not null default false;
alter table if exists public.chatbot_messages add column if not exists model text;
alter table if exists public.chatbot_messages add column if not exists response_id text;
alter table if exists public.chatbot_messages add column if not exists route text;
alter table if exists public.chatbot_messages add column if not exists page_title text;
alter table if exists public.chatbot_messages add column if not exists page_category text;
alter table if exists public.chatbot_messages add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.chatbot_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text,
  conversation_id text,
  event_type text not null,
  route text,
  page_category text,
  intent text,
  visitor_type text,
  outcome text,
  cta_id text,
  fallback boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

alter table if exists public.chatbot_events add column if not exists created_at timestamptz not null default now();
alter table if exists public.chatbot_events add column if not exists session_id text;
alter table if exists public.chatbot_events add column if not exists conversation_id text;
alter table if exists public.chatbot_events add column if not exists route text;
alter table if exists public.chatbot_events add column if not exists page_category text;
alter table if exists public.chatbot_events add column if not exists intent text;
alter table if exists public.chatbot_events add column if not exists visitor_type text;
alter table if exists public.chatbot_events add column if not exists outcome text;
alter table if exists public.chatbot_events add column if not exists cta_id text;
alter table if exists public.chatbot_events add column if not exists fallback boolean not null default false;
alter table if exists public.chatbot_events add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists chatbot_conversations_updated_idx
  on public.chatbot_conversations (updated_at desc);

create index if not exists chatbot_conversations_route_idx
  on public.chatbot_conversations (latest_route);

create index if not exists chatbot_conversations_intent_idx
  on public.chatbot_conversations (latest_intent);

create index if not exists chatbot_conversations_ip_hash_idx
  on public.chatbot_conversations (ip_hash);

create index if not exists chatbot_messages_conversation_idx
  on public.chatbot_messages (conversation_id, created_at asc);

create index if not exists chatbot_messages_role_idx
  on public.chatbot_messages (role, created_at desc);

create index if not exists chatbot_events_created_idx
  on public.chatbot_events (created_at desc);

create index if not exists chatbot_events_type_idx
  on public.chatbot_events (event_type, created_at desc);

create index if not exists chatbot_events_session_idx
  on public.chatbot_events (session_id, created_at desc);

do $$
begin
  if to_regclass('public.chatbot_conversations') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.chatbot_conversations')
         and tgname = 'chatbot_conversations_set_updated_at'
     )
  then
    create trigger chatbot_conversations_set_updated_at
      before update on public.chatbot_conversations
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

comment on table public.chatbot_conversations is
  'Session-level records for the HMJ website chatbot. Written server-side by Netlify Functions and surfaced in the admin module.';

update public.chatbot_conversations
set
  ip_hash = coalesce(
    nullif(ip_hash, ''),
    case
      when nullif(ip_address, '') is null then null
      else encode(digest(ip_address, 'sha256'), 'hex')
    end
  ),
  ip_address = null
where nullif(ip_address, '') is not null;

comment on column public.chatbot_conversations.ip_address is
  'Deprecated legacy column. New chatbot writes should keep this null and rely on ip_hash instead.';

comment on column public.chatbot_conversations.ip_hash is
  'SHA-256 hash of the visitor IP address for safer grouping and reporting without relying on raw IP storage.';

comment on table public.chatbot_messages is
  'Message-level transcript rows for the HMJ website chatbot.';

comment on table public.chatbot_events is
  'Lightweight event records for the HMJ website chatbot.';

-- -----------------------------------------------------------------------------
-- Website analytics
-- -----------------------------------------------------------------------------

create table if not exists public.analytics_events (
  event_id text primary key,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  visitor_id text not null,
  session_id text not null,
  page_visit_id text,
  event_type text not null check (event_type ~ '^[a-z0-9_]{2,80}$'),
  site_area text not null default 'public' check (site_area in ('public', 'admin')),
  page_path text,
  full_url text,
  page_title text,
  referrer text,
  referrer_domain text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  link_url text,
  link_text text,
  event_label text,
  event_value numeric,
  duration_seconds numeric,
  path_from text,
  path_to text,
  device_type text check (device_type in ('desktop', 'mobile', 'tablet')),
  browser_language text,
  viewport_width integer,
  viewport_height integer,
  timezone text,
  user_agent text,
  ip_hash text,
  country text,
  payload jsonb not null default '{}'::jsonb
);

alter table if exists public.analytics_events add column if not exists event_id text;
alter table if exists public.analytics_events add column if not exists occurred_at timestamptz;
alter table if exists public.analytics_events add column if not exists created_at timestamptz;
alter table if exists public.analytics_events add column if not exists visitor_id text;
alter table if exists public.analytics_events add column if not exists session_id text;
alter table if exists public.analytics_events add column if not exists page_visit_id text;
alter table if exists public.analytics_events add column if not exists event_type text;
alter table if exists public.analytics_events add column if not exists site_area text;
alter table if exists public.analytics_events add column if not exists page_path text;
alter table if exists public.analytics_events add column if not exists full_url text;
alter table if exists public.analytics_events add column if not exists page_title text;
alter table if exists public.analytics_events add column if not exists referrer text;
alter table if exists public.analytics_events add column if not exists referrer_domain text;
alter table if exists public.analytics_events add column if not exists utm_source text;
alter table if exists public.analytics_events add column if not exists utm_medium text;
alter table if exists public.analytics_events add column if not exists utm_campaign text;
alter table if exists public.analytics_events add column if not exists utm_term text;
alter table if exists public.analytics_events add column if not exists utm_content text;
alter table if exists public.analytics_events add column if not exists link_url text;
alter table if exists public.analytics_events add column if not exists link_text text;
alter table if exists public.analytics_events add column if not exists event_label text;
alter table if exists public.analytics_events add column if not exists event_value numeric;
alter table if exists public.analytics_events add column if not exists duration_seconds numeric;
alter table if exists public.analytics_events add column if not exists path_from text;
alter table if exists public.analytics_events add column if not exists path_to text;
alter table if exists public.analytics_events add column if not exists device_type text;
alter table if exists public.analytics_events add column if not exists browser_language text;
alter table if exists public.analytics_events add column if not exists viewport_width integer;
alter table if exists public.analytics_events add column if not exists viewport_height integer;
alter table if exists public.analytics_events add column if not exists timezone text;
alter table if exists public.analytics_events add column if not exists user_agent text;
alter table if exists public.analytics_events add column if not exists ip_hash text;
alter table if exists public.analytics_events add column if not exists country text;
alter table if exists public.analytics_events add column if not exists payload jsonb;
alter table if exists public.analytics_events add column if not exists id uuid default gen_random_uuid();
alter table if exists public.analytics_events add column if not exists event_at timestamptz;
alter table if exists public.analytics_events add column if not exists event_name text;
alter table if exists public.analytics_events add column if not exists path text;
alter table if exists public.analytics_events add column if not exists page_url text;
alter table if exists public.analytics_events add column if not exists click_target text;
alter table if exists public.analytics_events add column if not exists click_text text;
alter table if exists public.analytics_events add column if not exists click_href text;
alter table if exists public.analytics_events add column if not exists heartbeat_count integer;
alter table if exists public.analytics_events add column if not exists anon_ip_hash text;
alter table if exists public.analytics_events add column if not exists country_code text;
alter table if exists public.analytics_events add column if not exists meta jsonb;

alter table if exists public.analytics_events alter column payload set default '{}'::jsonb;
alter table if exists public.analytics_events alter column meta set default '{}'::jsonb;

create or replace function public.analytics_extract_path(value text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  cleaned := nullif(btrim(coalesce(value, '')), '');
  if cleaned is null then
    return null;
  end if;

  cleaned := regexp_replace(cleaned, '^https?://[^/]+', '');
  cleaned := split_part(cleaned, '#', 1);
  cleaned := split_part(cleaned, '?', 1);
  cleaned := nullif(btrim(cleaned), '');

  if cleaned is null then
    return '/';
  end if;

  if left(cleaned, 1) <> '/' then
    cleaned := '/' || cleaned;
  end if;

  return cleaned;
end
$$;

create or replace function public.analytics_extract_referrer_domain(value text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(value, '')), '') is null then null
    when btrim(value) ~* '^https?://' then nullif(regexp_replace(lower(btrim(value)), '^https?://(?:www\.)?([^/?#]+).*$'::text, '\1'), '')
    else nullif(regexp_replace(lower(btrim(value)), '^www\.'::text, ''), '')
  end
$$;

create or replace function public.analytics_numeric_or_null(value text)
returns numeric
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(value, '')), '') is null then null
    when btrim(value) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(value)::numeric
    else null
  end
$$;

create or replace function public.analytics_integer_or_null(value text)
returns integer
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(value, '')), '') is null then null
    when btrim(value) ~ '^-?[0-9]+$' then btrim(value)::integer
    else null
  end
$$;

create or replace function public.analytics_events_sync_compat()
returns trigger
language plpgsql
as $$
declare
  merged jsonb;
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;

  new.payload := coalesce(new.payload, '{}'::jsonb);
  new.meta := coalesce(new.meta, '{}'::jsonb);
  merged := jsonb_strip_nulls(new.meta || new.payload);

  new.created_at := coalesce(new.created_at, new.event_at, new.occurred_at, now());
  new.event_at := coalesce(new.event_at, new.occurred_at, new.created_at);
  new.occurred_at := coalesce(new.occurred_at, new.event_at, new.created_at);

  new.event_type := coalesce(nullif(new.event_type, ''), nullif(new.event_name, ''));
  new.event_name := coalesce(nullif(new.event_name, ''), new.event_type);
  new.site_area := coalesce(nullif(new.site_area, ''), case when coalesce(new.page_path, new.path, '') like '/admin%' then 'admin' else 'public' end);

  new.full_url := coalesce(nullif(new.full_url, ''), nullif(new.page_url, ''));
  new.page_url := coalesce(nullif(new.page_url, ''), nullif(new.full_url, ''));
  new.page_path := coalesce(
    nullif(new.page_path, ''),
    public.analytics_extract_path(new.path),
    public.analytics_extract_path(new.full_url),
    public.analytics_extract_path(new.page_url),
    public.analytics_extract_path(merged->>'path')
  );
  new.path := coalesce(
    nullif(new.path, ''),
    new.page_path,
    public.analytics_extract_path(new.full_url),
    public.analytics_extract_path(new.page_url)
  );

  new.page_title := coalesce(nullif(new.page_title, ''), nullif(merged->>'page_title', ''), nullif(merged->>'title', ''));
  new.referrer := coalesce(nullif(new.referrer, ''), nullif(merged->>'referrer', ''));
  new.referrer_domain := coalesce(nullif(new.referrer_domain, ''), public.analytics_extract_referrer_domain(new.referrer), public.analytics_extract_referrer_domain(merged->>'referrer_domain'));

  new.utm_source := coalesce(nullif(new.utm_source, ''), nullif(merged->>'utm_source', ''));
  new.utm_medium := coalesce(nullif(new.utm_medium, ''), nullif(merged->>'utm_medium', ''));
  new.utm_campaign := coalesce(nullif(new.utm_campaign, ''), nullif(merged->>'utm_campaign', ''));
  new.utm_term := coalesce(nullif(new.utm_term, ''), nullif(merged->>'utm_term', ''));
  new.utm_content := coalesce(nullif(new.utm_content, ''), nullif(merged->>'utm_content', ''));

  new.link_url := coalesce(nullif(new.link_url, ''), nullif(new.click_href, ''), nullif(merged->>'link_url', ''), nullif(merged->>'click_href', ''));
  new.click_href := coalesce(nullif(new.click_href, ''), nullif(new.link_url, ''));
  new.link_text := coalesce(nullif(new.link_text, ''), nullif(new.click_text, ''), nullif(merged->>'link_text', ''), nullif(merged->>'click_text', ''));
  new.click_text := coalesce(nullif(new.click_text, ''), nullif(new.link_text, ''));
  new.event_label := coalesce(nullif(new.event_label, ''), nullif(merged->>'event_label', ''), nullif(merged->>'label', ''));

  new.event_value := coalesce(new.event_value, public.analytics_numeric_or_null(merged->>'event_value'), public.analytics_numeric_or_null(merged->>'value'));
  new.duration_seconds := coalesce(new.duration_seconds, public.analytics_numeric_or_null(merged->>'duration_seconds'), public.analytics_numeric_or_null(merged->>'durationSeconds'));

  new.page_visit_id := coalesce(nullif(new.page_visit_id, ''), nullif(merged->>'page_visit_id', ''), nullif(merged->>'pageVisitId', ''));
  new.path_from := coalesce(
    nullif(new.path_from, ''),
    public.analytics_extract_path(merged->>'path_from'),
    public.analytics_extract_path(merged->>'previous_path'),
    public.analytics_extract_path(merged->>'previousPath')
  );
  new.path_to := coalesce(
    nullif(new.path_to, ''),
    public.analytics_extract_path(merged->>'path_to'),
    public.analytics_extract_path(merged->>'next_path'),
    public.analytics_extract_path(merged->>'nextPath'),
    public.analytics_extract_path(new.click_target)
  );
  new.click_target := coalesce(nullif(new.click_target, ''), nullif(merged->>'click_target', ''), new.path_to);

  if new.heartbeat_count is null and new.event_type = 'session_heartbeat' then
    new.heartbeat_count := 1;
  end if;

  new.device_type := coalesce(nullif(new.device_type, ''), nullif(merged->>'device_type', ''));
  new.browser_language := coalesce(nullif(new.browser_language, ''), nullif(merged->>'browser_language', ''));
  new.viewport_width := coalesce(new.viewport_width, public.analytics_integer_or_null(merged->>'viewport_width'));
  new.viewport_height := coalesce(new.viewport_height, public.analytics_integer_or_null(merged->>'viewport_height'));
  new.timezone := coalesce(nullif(new.timezone, ''), nullif(merged->>'timezone', ''));
  new.user_agent := coalesce(nullif(new.user_agent, ''), nullif(merged->>'user_agent', ''));

  new.ip_hash := coalesce(nullif(new.ip_hash, ''), nullif(new.anon_ip_hash, ''));
  new.anon_ip_hash := coalesce(nullif(new.anon_ip_hash, ''), nullif(new.ip_hash, ''));
  new.country := coalesce(nullif(new.country, ''), nullif(new.country_code, ''));
  new.country_code := coalesce(nullif(new.country_code, ''), nullif(new.country, ''));

  if nullif(new.event_id, '') is null then
    new.event_id := substr(
      encode(
        digest(
          concat_ws(
            '|',
            coalesce(new.session_id, ''),
            coalesce(new.visitor_id, ''),
            coalesce(new.page_visit_id, ''),
            coalesce(new.event_type, ''),
            coalesce(new.occurred_at::text, ''),
            coalesce(new.page_path, ''),
            coalesce(new.event_label, '')
          ),
          'sha256'
        ),
        'hex'
      ),
      1,
      120
    );
  end if;

  merged := jsonb_strip_nulls(
    merged || jsonb_build_object(
      'event_id', new.event_id,
      'page_visit_id', new.page_visit_id,
      'referrer_domain', new.referrer_domain,
      'path_from', new.path_from,
      'path_to', new.path_to,
      'event_value', new.event_value,
      'link_url', new.link_url,
      'link_text', new.link_text
    )
  );
  new.payload := merged;
  new.meta := merged;

  return new;
end
$$;

drop trigger if exists analytics_events_sync_compat_trigger on public.analytics_events;

create trigger analytics_events_sync_compat_trigger
before insert or update on public.analytics_events
for each row
execute function public.analytics_events_sync_compat();

update public.analytics_events
set created_at = created_at
where
  event_id is null
  or occurred_at is null
  or event_at is null
  or page_path is null
  or path is null
  or (full_url is null and page_url is not null)
  or (page_url is null and full_url is not null)
  or payload is null
  or meta is null
  or (referrer_domain is null and referrer is not null)
  or (link_url is null and click_href is not null)
  or (click_href is null and link_url is not null)
  or (link_text is null and click_text is not null)
  or (click_text is null and link_text is not null)
  or (ip_hash is null and anon_ip_hash is not null)
  or (anon_ip_hash is null and ip_hash is not null)
  or (country is null and country_code is not null)
  or (country_code is null and country is not null);

with seeded as (
  select
    ctid,
    coalesce(occurred_at, event_at, created_at) as ordering_at,
    nullif(event_id, '') as existing_event_id,
    substr(
      encode(
        digest(
          concat_ws(
            '|',
            coalesce(session_id, ''),
            coalesce(visitor_id, ''),
            coalesce(page_visit_id, ''),
            coalesce(event_type, ''),
            coalesce(coalesce(occurred_at, event_at, created_at)::text, ''),
            coalesce(page_path, path, ''),
            coalesce(event_label, '')
          ),
          'sha256'
        ),
        'hex'
      ),
      1,
      120
    ) as generated_base
  from public.analytics_events
),
ranked as (
  select
    ctid,
    existing_event_id,
    generated_base,
    row_number() over (
      partition by coalesce(existing_event_id, generated_base)
      order by ordering_at nulls last, ctid
    ) as event_rank
  from seeded
),
resolved as (
  select
    ctid,
    case
      when existing_event_id is not null and event_rank = 1 then existing_event_id
      when existing_event_id is not null then substr(encode(digest(existing_event_id || '|' || event_rank::text, 'sha256'), 'hex'), 1, 120)
      else substr(encode(digest(generated_base || '|' || event_rank::text, 'sha256'), 'hex'), 1, 120)
    end as resolved_event_id
  from ranked
  where existing_event_id is null or event_rank > 1
)
update public.analytics_events
set event_id = resolved.resolved_event_id
from resolved
where public.analytics_events.ctid = resolved.ctid;

update public.analytics_events
set
  created_at = coalesce(created_at, now()),
  payload = coalesce(payload, meta, '{}'::jsonb),
  meta = coalesce(meta, payload, '{}'::jsonb)
where
  created_at is null
  or payload is null
  or meta is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'analytics_events'
      and column_name = 'event_id'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'analytics_events'
        and indexname = 'analytics_events_event_id_uidx'
        and indexdef ilike '% where %'
    ) then
      execute 'drop index if exists public.analytics_events_event_id_uidx';
    end if;

    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'analytics_events'
        and c.contype in ('p', 'u')
        and pg_get_constraintdef(c.oid) ilike '%(event_id)%'
    ) and not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'analytics_events'
        and indexdef ilike 'create unique index%'
        and indexdef ilike '%(event_id)%'
        and indexdef not ilike '% where %'
    ) then
      execute 'create unique index analytics_events_event_id_uidx on public.analytics_events (event_id)';
    end if;
  end if;
end
$$;

comment on table public.analytics_events is
  'HMJ website analytics raw events. Privacy boundary: no form contents, CVs, passwords, or confidential payloads are stored here.';

comment on column public.analytics_events.event_id is
  'Stable analytics event identifier used for deduplication and safe upserts across tracker retries.';

comment on column public.analytics_events.ip_hash is
  'Salted one-way hash of the request IP when available. Raw IP addresses are intentionally not stored.';

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);

create index if not exists analytics_events_session_idx
  on public.analytics_events (session_id, occurred_at desc);

create index if not exists analytics_events_visitor_idx
  on public.analytics_events (visitor_id, occurred_at desc);

create index if not exists analytics_events_page_visit_idx
  on public.analytics_events (page_visit_id, occurred_at desc);

create index if not exists analytics_events_page_idx
  on public.analytics_events (page_path, occurred_at desc);

create index if not exists analytics_events_page_view_idx
  on public.analytics_events (page_path, occurred_at desc)
  where event_type = 'page_view';

create index if not exists analytics_events_event_type_idx
  on public.analytics_events (event_type, occurred_at desc);

create index if not exists analytics_events_site_area_idx
  on public.analytics_events (site_area, occurred_at desc);

create index if not exists analytics_events_referrer_idx
  on public.analytics_events (referrer_domain, occurred_at desc);

create index if not exists analytics_events_device_idx
  on public.analytics_events (device_type, occurred_at desc);

create index if not exists analytics_events_utm_source_idx
  on public.analytics_events (utm_source, occurred_at desc);

create index if not exists analytics_events_full_url_idx
  on public.analytics_events (page_path, full_url, occurred_at desc)
  where full_url is not null;

create index if not exists analytics_events_payload_idx
  on public.analytics_events using gin (payload);

create or replace view public.analytics_session_rollups as
select
  session_id,
  min(visitor_id) as visitor_id,
  min(site_area) as site_area,
  min(occurred_at) as first_event_at,
  max(occurred_at) as last_event_at,
  count(*) filter (where event_type = 'page_view') as page_views,
  (array_agg(page_path order by occurred_at) filter (where event_type = 'page_view'))[1] as landing_page,
  (array_agg(page_path order by occurred_at desc) filter (where event_type = 'page_view'))[1] as exit_page,
  max(occurred_at) - min(occurred_at) as session_duration
from public.analytics_events
group by session_id;

create or replace view public.analytics_page_daily as
select
  date_trunc('day', occurred_at)::date as day,
  site_area,
  page_path,
  max(page_title) filter (where page_title is not null and page_title <> '') as page_title,
  count(*) filter (where event_type = 'page_view') as page_views,
  count(distinct visitor_id) filter (where event_type = 'page_view') as unique_visitors,
  avg(duration_seconds) filter (where event_type = 'time_on_page_seconds') as avg_time_on_page_seconds,
  count(*) filter (where event_type = 'cta_click' or event_type like '%_clicked') as cta_clicks
from public.analytics_events
where page_path is not null
group by 1, 2, 3;

-- Optional helper view for future listing/server-side reporting.
create or replace view public.analytics_listing_daily as
select
  date_trunc('day', occurred_at)::date as day,
  site_area,
  coalesce(
    nullif(payload->>'job_id', ''),
    nullif(payload->>'share_slug', ''),
    nullif(payload->>'slug', ''),
    nullif(regexp_replace(full_url, '.*[?&]id=([^&]+).*', '\1'), full_url),
    nullif(regexp_replace(full_url, '.*[?&]slug=([^&]+).*', '\1'), full_url),
    nullif(page_path, '')
  ) as listing_key,
  coalesce(
    nullif(payload->>'job_title', ''),
    nullif(regexp_replace(page_title, '\s*\|\s*HMJ(?:\s+Global)?(?:\s+Admin)?$', '', 'i'), ''),
    nullif(event_label, ''),
    nullif(page_title, ''),
    page_path
  ) as listing_title,
  count(*) filter (where event_type = 'page_view' or event_type = 'jobs_card_clicked') as listing_views,
  count(*) filter (where event_type = 'job_apply_clicked') as apply_clicks,
  count(*) filter (where event_type = 'cta_click' or event_type like '%_clicked') as cta_clicks,
  avg(duration_seconds) filter (where event_type = 'time_on_page_seconds') as avg_time_on_page_seconds
from public.analytics_events
where page_path in ('/jobs.html', '/jobs/spec.html')
   or event_type in ('jobs_card_clicked', 'job_apply_clicked', 'spec_page_opened')
group by 1, 2, 3, 4;

-- -----------------------------------------------------------------------------
-- Jobs table additive fields used by the website/admin modules
-- -----------------------------------------------------------------------------

alter table if exists public.jobs
  add column if not exists client_name text;
alter table if exists public.jobs
  add column if not exists customer text;
alter table if exists public.jobs
  add column if not exists benefits text[];
alter table if exists public.jobs
  add column if not exists pay_type text;
alter table if exists public.jobs
  add column if not exists day_rate_min numeric;
alter table if exists public.jobs
  add column if not exists day_rate_max numeric;
alter table if exists public.jobs
  add column if not exists salary_min numeric;
alter table if exists public.jobs
  add column if not exists salary_max numeric;
alter table if exists public.jobs
  add column if not exists hourly_min numeric;
alter table if exists public.jobs
  add column if not exists hourly_max numeric;
alter table if exists public.jobs
  add column if not exists currency text;
alter table if exists public.jobs
  add column if not exists public_page_config jsonb;

-- -----------------------------------------------------------------------------
-- Default settings seeds
-- -----------------------------------------------------------------------------

insert into public.admin_settings (key, value)
values
  ('noticeboard_enabled', 'true'::jsonb),
  ('fiscal_week1_ending', to_jsonb('2025-11-02'::text)),
  ('fiscal_week_day', to_jsonb('sunday'::text)),
  ('timesheet_deadline_note', to_jsonb('Submit approved timesheets by Monday 10:00 (UK time) to guarantee payroll.'::text)),
  ('timesheet_deadline_timezone', to_jsonb('Europe/London'::text)),
  (
    'chatbot_settings',
    '{
      "enabled": true,
      "visibility": {
        "routeMode": "all_public",
        "includePatterns": [],
        "excludePatterns": ["/admin", "/timesheets"]
      }
    }'::jsonb
  )
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Security posture for repo-managed support objects
-- -----------------------------------------------------------------------------

alter table public.admin_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.candidate_documents enable row level security;
alter table public.noticeboard_posts enable row level security;
alter table public.short_links enable row level security;
alter table public.job_specs enable row level security;
alter table public.candidate_match_runs enable row level security;
alter table public.candidate_match_files enable row level security;
alter table public.chatbot_conversations enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.chatbot_events enable row level security;
alter table public.analytics_events enable row level security;

revoke all on public.admin_settings from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;
revoke all on public.admin_audit_logs from anon, authenticated;
revoke all on public.candidate_documents from anon, authenticated;
revoke all on public.noticeboard_posts from anon, authenticated;
revoke all on public.short_links from anon, authenticated;
revoke all on public.job_specs from anon, authenticated;
revoke all on public.candidate_match_runs from anon, authenticated;
revoke all on public.candidate_match_files from anon, authenticated;
revoke all on public.chatbot_conversations from anon, authenticated;
revoke all on public.chatbot_messages from anon, authenticated;
revoke all on public.chatbot_events from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_session_rollups from anon, authenticated;
revoke all on public.analytics_page_daily from anon, authenticated;
revoke all on public.analytics_listing_daily from anon, authenticated;

drop policy if exists "analytics_no_direct_client_access" on public.analytics_events;

-- No direct anon/authenticated policies are added here on purpose.
-- The repo writes/reads these objects through Netlify Functions using server-side credentials.
