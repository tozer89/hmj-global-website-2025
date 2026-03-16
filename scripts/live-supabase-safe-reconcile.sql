-- HMJ live Supabase safe reconciliation patch
--
-- Purpose:
-- - fix candidate document RLS/storage drift without failing on legacy text/uuid joins
-- - reconcile Team Tasks legacy uuid user columns to the current text-based admin model
-- - avoid policy/type-conversion ordering failures on production
--
-- Intended usage:
-- - run as a single script in the Supabase SQL editor against the production project
-- - safe to re-run

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidate portal: legacy-compatible candidate document ownership + RLS
-- ---------------------------------------------------------------------------

create or replace function public.hmj_candidate_has_auth_user(candidate_uuid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.candidates c
    where c.id = candidate_uuid
      and c.auth_user_id = auth.uid()
  );
$$;

create or replace function public.hmj_candidate_has_auth_user(candidate_identifier text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.candidates c
    where c.id::text = nullif(trim(candidate_identifier), '')
      and c.auth_user_id = auth.uid()
  );
$$;

alter table if exists public.candidate_documents
  add column if not exists owner_auth_user_id uuid;
alter table if exists public.candidate_documents
  add column if not exists original_filename text;
alter table if exists public.candidate_documents
  add column if not exists file_extension text;
alter table if exists public.candidate_documents
  add column if not exists mime_type text;
alter table if exists public.candidate_documents
  add column if not exists file_size_bytes bigint;
alter table if exists public.candidate_documents
  add column if not exists storage_bucket text;
alter table if exists public.candidate_documents
  add column if not exists storage_path text;
alter table if exists public.candidate_documents
  add column if not exists storage_key text;
alter table if exists public.candidate_documents
  add column if not exists uploaded_at timestamptz;
alter table if exists public.candidate_documents
  add column if not exists meta jsonb not null default '{}'::jsonb;
alter table if exists public.candidate_documents
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.candidate_documents
  add column if not exists updated_at timestamptz not null default now();
alter table if exists public.candidate_documents
  add column if not exists deleted_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_documents'
      and column_name = 'candidate_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.candidate_documents alter column candidate_id type text using candidate_id::text';
  end if;
end
$$;

update public.candidate_documents
set
  candidate_id = btrim(coalesce(candidate_id, '')),
  original_filename = coalesce(nullif(trim(original_filename), ''), nullif(trim(filename), ''), 'candidate-document'),
  filename = coalesce(nullif(trim(filename), ''), nullif(trim(original_filename), ''), 'candidate-document'),
  storage_bucket = coalesce(nullif(trim(storage_bucket), ''), 'candidate-docs'),
  storage_path = coalesce(nullif(trim(storage_path), ''), nullif(trim(storage_key), ''), concat('legacy/', id::text)),
  storage_key = coalesce(nullif(trim(storage_key), ''), nullif(trim(storage_path), ''), concat('legacy/', id::text)),
  uploaded_at = coalesce(uploaded_at, created_at, now()),
  created_at = coalesce(created_at, uploaded_at, now()),
  updated_at = coalesce(updated_at, uploaded_at, created_at, now()),
  meta = coalesce(meta, '{}'::jsonb)
where true;

update public.candidate_documents d
set owner_auth_user_id = c.auth_user_id
from public.candidates c
where d.candidate_id::text = c.id::text
  and d.owner_auth_user_id is null
  and c.auth_user_id is not null
  and split_part(coalesce(d.storage_path, d.storage_key, ''), '/', 1) = 'portal';

alter table public.candidate_documents
  drop constraint if exists candidate_documents_document_type_check;
alter table public.candidate_documents
  add constraint candidate_documents_document_type_check
  check (document_type in (
    'cv',
    'cover_letter',
    'certificate',
    'qualification_certificate',
    'passport',
    'right_to_work',
    'visa_permit',
    'bank_document',
    'other'
  ));

alter table if exists public.candidate_documents enable row level security;
revoke all on public.candidate_documents from anon;
grant select, insert, delete on public.candidate_documents to authenticated;
grant all on public.candidate_documents to service_role;

drop policy if exists "candidate docs self select" on public.candidate_documents;
create policy "candidate docs self select"
  on public.candidate_documents
  for select
  to authenticated
  using (
    deleted_at is null
    and public.hmj_candidate_has_auth_user(candidate_id)
  );

drop policy if exists "candidate docs self insert" on public.candidate_documents;
create policy "candidate docs self insert"
  on public.candidate_documents
  for insert
  to authenticated
  with check (
    public.hmj_candidate_has_auth_user(candidate_id)
    and owner_auth_user_id = auth.uid()
    and storage_bucket = 'candidate-docs'
    and split_part(coalesce(storage_path, storage_key, ''), '/', 1) = 'portal'
    and split_part(coalesce(storage_path, storage_key, ''), '/', 2) = auth.uid()::text
  );

drop policy if exists "candidate docs self delete" on public.candidate_documents;
create policy "candidate docs self delete"
  on public.candidate_documents
  for delete
  to authenticated
  using (
    public.hmj_candidate_has_auth_user(candidate_id)
    and owner_auth_user_id = auth.uid()
    and split_part(coalesce(storage_path, storage_key, ''), '/', 1) = 'portal'
    and split_part(coalesce(storage_path, storage_key, ''), '/', 2) = auth.uid()::text
  );

create table if not exists public.candidate_payment_details (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  auth_user_id uuid,
  account_currency text not null default 'GBP',
  payment_method text not null default 'gbp_local',
  account_holder_name text not null default '',
  bank_name text not null default '',
  bank_location_or_country text not null default '',
  account_type text,
  encrypted_sort_code text,
  encrypted_account_number text,
  encrypted_iban text,
  encrypted_swift_bic text,
  sort_code_masked text,
  account_number_masked text,
  iban_masked text,
  swift_bic_masked text,
  last_four text,
  is_complete boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.candidate_payment_details
  add column if not exists auth_user_id uuid;
alter table if exists public.candidate_payment_details
  add column if not exists account_currency text;
alter table if exists public.candidate_payment_details
  add column if not exists payment_method text;
alter table if exists public.candidate_payment_details
  add column if not exists account_holder_name text;
alter table if exists public.candidate_payment_details
  add column if not exists bank_name text;
alter table if exists public.candidate_payment_details
  add column if not exists bank_location_or_country text;
alter table if exists public.candidate_payment_details
  add column if not exists account_type text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_sort_code text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_account_number text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_iban text;
alter table if exists public.candidate_payment_details
  add column if not exists encrypted_swift_bic text;
alter table if exists public.candidate_payment_details
  add column if not exists sort_code_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists account_number_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists iban_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists swift_bic_masked text;
alter table if exists public.candidate_payment_details
  add column if not exists last_four text;
alter table if exists public.candidate_payment_details
  add column if not exists is_complete boolean not null default true;
alter table if exists public.candidate_payment_details
  add column if not exists verified_at timestamptz;
alter table if exists public.candidate_payment_details
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.candidate_payment_details
  add column if not exists updated_at timestamptz not null default now();

update public.candidate_payment_details
set
  account_currency = coalesce(nullif(trim(account_currency), ''), 'GBP'),
  payment_method = coalesce(nullif(trim(payment_method), ''), case when nullif(trim(encrypted_iban), '') is not null then 'iban_swift' else 'gbp_local' end),
  account_holder_name = coalesce(nullif(trim(account_holder_name), ''), ''),
  bank_name = coalesce(nullif(trim(bank_name), ''), ''),
  bank_location_or_country = coalesce(nullif(trim(bank_location_or_country), ''), ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now()),
  is_complete = coalesce(is_complete, true)
where true;

update public.candidate_payment_details p
set auth_user_id = c.auth_user_id
from public.candidates c
where p.candidate_id = c.id
  and p.auth_user_id is null
  and c.auth_user_id is not null;

alter table public.candidate_payment_details
  drop constraint if exists candidate_payment_details_method_check;
alter table public.candidate_payment_details
  add constraint candidate_payment_details_method_check
  check (payment_method in ('gbp_local', 'iban_swift'));

create unique index if not exists candidate_payment_details_candidate_uidx
  on public.candidate_payment_details (candidate_id);
create index if not exists candidate_payment_details_auth_user_idx
  on public.candidate_payment_details (auth_user_id);

drop trigger if exists candidate_payment_details_touch_updated_at on public.candidate_payment_details;
create trigger candidate_payment_details_touch_updated_at
  before update on public.candidate_payment_details
  for each row
  execute function public.set_updated_at();

alter table if exists public.candidate_payment_details enable row level security;
revoke all on public.candidate_payment_details from anon;
grant select, insert, update on public.candidate_payment_details to authenticated;
grant all on public.candidate_payment_details to service_role;

drop policy if exists "candidate payment self select" on public.candidate_payment_details;
create policy "candidate payment self select"
  on public.candidate_payment_details
  for select
  to authenticated
  using (
    public.hmj_candidate_has_auth_user(candidate_id)
    and auth_user_id = auth.uid()
  );

drop policy if exists "candidate payment self insert" on public.candidate_payment_details;
create policy "candidate payment self insert"
  on public.candidate_payment_details
  for insert
  to authenticated
  with check (
    public.hmj_candidate_has_auth_user(candidate_id)
    and auth_user_id = auth.uid()
  );

drop policy if exists "candidate payment self update" on public.candidate_payment_details;
create policy "candidate payment self update"
  on public.candidate_payment_details
  for update
  to authenticated
  using (
    public.hmj_candidate_has_auth_user(candidate_id)
    and auth_user_id = auth.uid()
  )
  with check (
    public.hmj_candidate_has_auth_user(candidate_id)
    and auth_user_id = auth.uid()
  );

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
  15728640,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "candidate portal storage select" on storage.objects';
    execute 'drop policy if exists "candidate portal storage insert" on storage.objects';
    execute 'drop policy if exists "candidate portal storage update" on storage.objects';
    execute 'drop policy if exists "candidate portal storage delete" on storage.objects';

    execute 'create policy "candidate portal storage select" on storage.objects for select to authenticated using (bucket_id = ''candidate-docs'' and split_part(name, ''/'', 1) = ''portal'' and split_part(name, ''/'', 2) = auth.uid()::text)';
    execute 'create policy "candidate portal storage insert" on storage.objects for insert to authenticated with check (bucket_id = ''candidate-docs'' and split_part(name, ''/'', 1) = ''portal'' and split_part(name, ''/'', 2) = auth.uid()::text)';
    execute 'create policy "candidate portal storage update" on storage.objects for update to authenticated using (bucket_id = ''candidate-docs'' and split_part(name, ''/'', 1) = ''portal'' and split_part(name, ''/'', 2) = auth.uid()::text) with check (bucket_id = ''candidate-docs'' and split_part(name, ''/'', 1) = ''portal'' and split_part(name, ''/'', 2) = auth.uid()::text)';
    execute 'create policy "candidate portal storage delete" on storage.objects for delete to authenticated using (bucket_id = ''candidate-docs'' and split_part(name, ''/'', 1) = ''portal'' and split_part(name, ''/'', 2) = auth.uid()::text)';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Candidate portal: align the live schema to the current website payloads
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidates'
      and column_name = 'created_at'
      and data_type = 'timestamp without time zone'
  ) then
    execute 'alter table public.candidates alter column created_at type timestamptz using created_at at time zone ''utc''';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidates'
      and column_name = 'updated_at'
      and data_type = 'timestamp without time zone'
  ) then
    execute 'alter table public.candidates alter column updated_at type timestamptz using updated_at at time zone ''utc''';
  end if;
end
$$;

alter table if exists public.candidates
  add column if not exists full_name text;
alter table if exists public.candidates
  add column if not exists skills text[] not null default '{}'::text[];
alter table if exists public.candidates
  add column if not exists availability text;
alter table if exists public.candidates
  add column if not exists address1 text;
alter table if exists public.candidates
  add column if not exists address2 text;
alter table if exists public.candidates
  add column if not exists town text;
alter table if exists public.candidates
  add column if not exists county text;
alter table if exists public.candidates
  add column if not exists postcode text;
alter table if exists public.candidates
  add column if not exists nationality text;
alter table if exists public.candidates
  add column if not exists right_to_work_status text;
alter table if exists public.candidates
  add column if not exists right_to_work_regions text[] not null default '{}'::text[];
alter table if exists public.candidates
  add column if not exists primary_specialism text;
alter table if exists public.candidates
  add column if not exists secondary_specialism text;
alter table if exists public.candidates
  add column if not exists current_job_title text;
alter table if exists public.candidates
  add column if not exists desired_roles text;
alter table if exists public.candidates
  add column if not exists qualifications text;
alter table if exists public.candidates
  add column if not exists sector_experience text;
alter table if exists public.candidates
  add column if not exists relocation_preference text;
alter table if exists public.candidates
  add column if not exists salary_expectation text;
alter table if exists public.candidates
  add column if not exists archived_at timestamptz;
alter table if exists public.candidates
  add column if not exists portal_account_closed_at timestamptz;
alter table if exists public.candidates
  add column if not exists last_portal_login_at timestamptz;

update public.candidates
set
  email = lower(nullif(trim(email), '')),
  first_name = nullif(trim(first_name), ''),
  last_name = nullif(trim(last_name), ''),
  full_name = coalesce(
    nullif(trim(full_name), ''),
    nullif(trim(concat_ws(' ', first_name, last_name)), '')
  ),
  phone = nullif(trim(phone), ''),
  address1 = nullif(trim(address1), ''),
  address2 = nullif(trim(address2), ''),
  town = nullif(trim(town), ''),
  county = nullif(trim(county), ''),
  postcode = nullif(trim(postcode), ''),
  location = nullif(trim(location), ''),
  country = nullif(trim(country), ''),
  nationality = nullif(trim(nationality), ''),
  right_to_work_status = nullif(trim(right_to_work_status), ''),
  right_to_work_regions = coalesce(right_to_work_regions, '{}'::text[]),
  primary_specialism = nullif(trim(primary_specialism), ''),
  secondary_specialism = nullif(trim(secondary_specialism), ''),
  current_job_title = nullif(trim(current_job_title), ''),
  desired_roles = nullif(trim(desired_roles), ''),
  qualifications = nullif(trim(qualifications), ''),
  sector_experience = nullif(trim(sector_experience), ''),
  relocation_preference = nullif(trim(relocation_preference), ''),
  salary_expectation = nullif(trim(salary_expectation), ''),
  headline_role = nullif(trim(headline_role), ''),
  sector_focus = nullif(trim(sector_focus), ''),
  summary = nullif(trim(summary), ''),
  linkedin_url = nullif(trim(linkedin_url), ''),
  availability = nullif(trim(availability), ''),
  status = coalesce(nullif(trim(status), ''), 'active'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now()),
  skills = coalesce(skills, '{}'::text[])
where true;

alter table if exists public.candidates
  alter column created_at set default now();
alter table if exists public.candidates
  alter column updated_at set default now();
alter table if exists public.candidates
  alter column skills set default '{}'::text[];
alter table if exists public.candidates
  alter column skills set not null;
alter table if exists public.candidates
  alter column right_to_work_regions set default '{}'::text[];
alter table if exists public.candidates
  alter column right_to_work_regions set not null;

create index if not exists idx_candidates_auth_user_id on public.candidates(auth_user_id);
create index if not exists idx_candidates_email on public.candidates(lower(email));
create index if not exists idx_candidates_status on public.candidates(status);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_applications'
      and column_name = 'applied_at'
      and data_type = 'timestamp without time zone'
  ) then
    execute 'alter table public.job_applications alter column applied_at type timestamptz using applied_at at time zone ''utc''';
  end if;
end
$$;

alter table if exists public.job_applications
  drop constraint if exists job_applications_job_id_fkey;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_applications'
      and column_name = 'job_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.job_applications alter column job_id type text using nullif(trim(job_id::text), '''')';
  end if;
end
$$;

alter table if exists public.job_applications
  add column if not exists job_title text;
alter table if exists public.job_applications
  add column if not exists job_location text;
alter table if exists public.job_applications
  add column if not exists job_type text;
alter table if exists public.job_applications
  add column if not exists job_pay text;
alter table if exists public.job_applications
  add column if not exists source text;
alter table if exists public.job_applications
  add column if not exists source_submission_id text;
alter table if exists public.job_applications
  add column if not exists created_at timestamptz;
alter table if exists public.job_applications
  add column if not exists updated_at timestamptz;

update public.job_applications
set
  job_id = nullif(trim(job_id), ''),
  status = case
    when lower(trim(status)) in ('submitted', 'reviewing', 'shortlisted', 'interviewing', 'on_hold', 'rejected', 'offered', 'hired') then lower(trim(status))
    when lower(trim(status)) in ('applied') then 'submitted'
    when lower(trim(status)) in ('under review') then 'reviewing'
    when lower(trim(status)) in ('on hold') then 'on_hold'
    else 'submitted'
  end,
  source = coalesce(nullif(trim(source), ''), 'candidate_portal'),
  created_at = coalesce(created_at, applied_at, now()),
  updated_at = coalesce(updated_at, created_at, applied_at, now())
where true;

alter table if exists public.job_applications
  alter column applied_at set default now();
alter table if exists public.job_applications
  alter column source set default 'candidate_portal';
alter table if exists public.job_applications
  alter column created_at set default now();
alter table if exists public.job_applications
  alter column updated_at set default now();

create index if not exists idx_job_applications_candidate_id on public.job_applications(candidate_id);
create index if not exists idx_job_applications_job_id on public.job_applications(job_id);
create index if not exists idx_job_applications_applied_at on public.job_applications(applied_at desc);
create index if not exists idx_job_applications_source_submission_idx
  on public.job_applications(source_submission_id)
  where source_submission_id is not null;

alter table if exists public.candidate_activity
  add column if not exists actor_role text not null default 'candidate';
alter table if exists public.candidate_activity
  add column if not exists actor_identifier text;
alter table if exists public.candidate_activity
  add column if not exists meta jsonb not null default '{}'::jsonb;

update public.candidate_activity
set
  activity_type = lower(replace(trim(activity_type), ' ', '_')),
  actor_role = coalesce(nullif(trim(actor_role), ''), 'candidate'),
  actor_identifier = nullif(trim(actor_identifier), ''),
  meta = coalesce(meta, '{}'::jsonb)
where true;

create index if not exists idx_candidate_activity_candidate_id on public.candidate_activity(candidate_id);
create index if not exists idx_candidate_activity_created_at on public.candidate_activity(created_at desc);

-- ---------------------------------------------------------------------------
-- Team Tasks: legacy uuid columns -> current text admin identifiers
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('open', 'in_progress', 'waiting', 'done', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_reminder_status') then
    create type public.task_reminder_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
  end if;
end
$$;

alter type public.task_reminder_status add value if not exists 'processing';

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_items'
  ) then
    execute 'drop policy if exists "task_items_select_admins" on public.task_items';
    execute 'drop policy if exists "task_items_insert_admins" on public.task_items';
    execute 'drop policy if exists "task_items_update_admins" on public.task_items';
    execute 'drop policy if exists "task_items_delete_creator_only" on public.task_items';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_comments'
  ) then
    execute 'drop policy if exists "task_comments_select_admins" on public.task_comments';
    execute 'drop policy if exists "task_comments_insert_admins" on public.task_comments';
    execute 'drop policy if exists "task_comments_update_author_only" on public.task_comments';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_watchers'
  ) then
    execute 'drop policy if exists "task_watchers_select_admins" on public.task_watchers';
    execute 'drop policy if exists "task_watchers_insert_admins" on public.task_watchers';
    execute 'drop policy if exists "task_watchers_update_admins" on public.task_watchers';
    execute 'drop policy if exists "task_watchers_delete_admins_or_self" on public.task_watchers';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_reminders'
  ) then
    execute 'drop policy if exists "task_reminders_select_admins" on public.task_reminders';
    execute 'drop policy if exists "task_reminders_insert_admins" on public.task_reminders';
    execute 'drop policy if exists "task_reminders_update_admins" on public.task_reminders';
    execute 'drop policy if exists "task_reminders_delete_admins" on public.task_reminders';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_audit_log'
  ) then
    execute 'drop policy if exists "task_audit_log_select_admins" on public.task_audit_log';
    execute 'drop policy if exists "task_audit_log_no_direct_insert" on public.task_audit_log';
    execute 'drop policy if exists "task_audit_log_no_direct_update" on public.task_audit_log';
    execute 'drop policy if exists "task_audit_log_no_direct_delete" on public.task_audit_log';
  end if;
end
$$;

alter table if exists public.task_items drop constraint if exists task_items_created_by_fkey;
alter table if exists public.task_items drop constraint if exists task_items_assigned_to_fkey;
alter table if exists public.task_items drop constraint if exists task_items_reminder_mode_check;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'created_by'
      and data_type <> 'text'
  ) then
    execute 'alter table public.task_items alter column created_by type text using created_by::text';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'assigned_to'
      and data_type <> 'text'
  ) then
    execute 'alter table public.task_items alter column assigned_to type text using assigned_to::text';
  end if;
end
$$;

alter table if exists public.task_comments drop constraint if exists task_comments_created_by_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_comments'
      and column_name = 'created_by'
      and data_type <> 'text'
  ) then
    execute 'alter table public.task_comments alter column created_by type text using created_by::text';
  end if;
end
$$;

alter table if exists public.task_watchers drop constraint if exists task_watchers_user_id_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_watchers'
      and column_name = 'user_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.task_watchers alter column user_id type text using user_id::text';
  end if;
end
$$;

alter table if exists public.task_reminders drop constraint if exists task_reminders_recipient_user_id_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_reminders'
      and column_name = 'recipient_user_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.task_reminders alter column recipient_user_id type text using recipient_user_id::text';
  end if;
end
$$;

alter table if exists public.task_audit_log drop constraint if exists task_audit_log_actor_user_id_fkey;
alter table if exists public.task_audit_log drop constraint if exists task_audit_log_task_id_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_audit_log'
      and column_name = 'actor_user_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.task_audit_log alter column actor_user_id type text using actor_user_id::text';
  end if;
end
$$;

create table if not exists public.task_comment_mentions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  mentioned_user_id text,
  mentioned_email text,
  mentioned_display_name text,
  created_by text not null,
  created_by_email text not null default '',
  notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint task_comment_mentions_target_check
    check (mentioned_user_id is not null or mentioned_email is not null)
);

alter table if exists public.task_comment_mentions
  add column if not exists task_id uuid;
alter table if exists public.task_comment_mentions
  add column if not exists comment_id uuid;
alter table if exists public.task_comment_mentions
  add column if not exists mentioned_user_id text;
alter table if exists public.task_comment_mentions
  add column if not exists mentioned_email text;
alter table if exists public.task_comment_mentions
  add column if not exists mentioned_display_name text;
alter table if exists public.task_comment_mentions
  add column if not exists created_by text;
alter table if exists public.task_comment_mentions
  add column if not exists created_by_email text default '';
alter table if exists public.task_comment_mentions
  add column if not exists notification_sent_at timestamptz;
alter table if exists public.task_comment_mentions
  add column if not exists created_at timestamptz default now();

update public.task_comment_mentions
set
  created_by = coalesce(nullif(created_by, ''), 'legacy-' || encode(gen_random_bytes(6), 'hex')),
  created_by_email = coalesce(created_by_email, ''),
  created_at = coalesce(created_at, now())
where
  created_by is null
  or created_by = ''
  or created_by_email is null
  or created_at is null;

create index if not exists idx_task_comment_mentions_task_id on public.task_comment_mentions(task_id);
create index if not exists idx_task_comment_mentions_comment_id on public.task_comment_mentions(comment_id);
create index if not exists idx_task_comment_mentions_email on public.task_comment_mentions(lower(mentioned_email));

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null,
  storage_bucket text not null default 'task-files',
  storage_path text not null,
  storage_key text,
  uploaded_by text not null,
  uploaded_by_email text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.task_attachments
  add column if not exists task_id uuid;
alter table if exists public.task_attachments
  add column if not exists file_name text;
alter table if exists public.task_attachments
  add column if not exists mime_type text default 'application/octet-stream';
alter table if exists public.task_attachments
  add column if not exists file_size_bytes bigint;
alter table if exists public.task_attachments
  add column if not exists storage_bucket text default 'task-files';
alter table if exists public.task_attachments
  add column if not exists storage_path text;
alter table if exists public.task_attachments
  add column if not exists storage_key text;
alter table if exists public.task_attachments
  add column if not exists uploaded_by text;
alter table if exists public.task_attachments
  add column if not exists uploaded_by_email text default '';
alter table if exists public.task_attachments
  add column if not exists meta jsonb default '{}'::jsonb;
alter table if exists public.task_attachments
  add column if not exists created_at timestamptz default now();

update public.task_attachments
set
  file_name = coalesce(nullif(trim(file_name), ''), 'task-file'),
  mime_type = coalesce(nullif(trim(mime_type), ''), 'application/octet-stream'),
  file_size_bytes = coalesce(file_size_bytes, 1),
  storage_bucket = coalesce(nullif(trim(storage_bucket), ''), 'task-files'),
  storage_path = coalesce(nullif(trim(storage_path), ''), concat('legacy/', id::text)),
  storage_key = coalesce(nullif(trim(storage_key), ''), nullif(trim(storage_path), ''), concat('legacy/', id::text)),
  uploaded_by = coalesce(nullif(uploaded_by, ''), 'legacy-' || encode(gen_random_bytes(6), 'hex')),
  uploaded_by_email = coalesce(uploaded_by_email, ''),
  meta = coalesce(meta, '{}'::jsonb),
  created_at = coalesce(created_at, now())
where true;

create unique index if not exists idx_task_attachments_storage_uidx
  on public.task_attachments(storage_bucket, storage_path);
create index if not exists idx_task_attachments_task_id on public.task_attachments(task_id);
create index if not exists idx_task_attachments_uploaded_email on public.task_attachments(lower(uploaded_by_email));

create table if not exists public.task_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'microsoft',
  user_id text not null,
  user_email text not null default '',
  user_display_name text not null default '',
  external_account_id text not null default '',
  external_account_email text not null default '',
  external_display_name text not null default '',
  access_token text not null default '',
  refresh_token text not null default '',
  access_token_expires_at timestamptz,
  scope text[] not null default '{}'::text[],
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.task_calendar_connections
  add column if not exists provider text default 'microsoft';
alter table if exists public.task_calendar_connections
  add column if not exists user_id text;
alter table if exists public.task_calendar_connections
  add column if not exists user_email text default '';
alter table if exists public.task_calendar_connections
  add column if not exists user_display_name text default '';
alter table if exists public.task_calendar_connections
  add column if not exists external_account_id text default '';
alter table if exists public.task_calendar_connections
  add column if not exists external_account_email text default '';
alter table if exists public.task_calendar_connections
  add column if not exists external_display_name text default '';
alter table if exists public.task_calendar_connections
  add column if not exists access_token text default '';
alter table if exists public.task_calendar_connections
  add column if not exists refresh_token text default '';
alter table if exists public.task_calendar_connections
  add column if not exists access_token_expires_at timestamptz;
alter table if exists public.task_calendar_connections
  add column if not exists scope text[] default '{}'::text[];
alter table if exists public.task_calendar_connections
  add column if not exists sync_enabled boolean default true;
alter table if exists public.task_calendar_connections
  add column if not exists last_synced_at timestamptz;
alter table if exists public.task_calendar_connections
  add column if not exists last_error text;
alter table if exists public.task_calendar_connections
  add column if not exists created_at timestamptz default now();
alter table if exists public.task_calendar_connections
  add column if not exists updated_at timestamptz default now();

update public.task_calendar_connections
set
  provider = coalesce(nullif(provider, ''), 'microsoft'),
  user_email = coalesce(user_email, ''),
  user_display_name = coalesce(user_display_name, ''),
  external_account_id = coalesce(external_account_id, ''),
  external_account_email = coalesce(external_account_email, ''),
  external_display_name = coalesce(external_display_name, ''),
  access_token = coalesce(access_token, ''),
  refresh_token = coalesce(refresh_token, ''),
  scope = coalesce(scope, '{}'::text[]),
  sync_enabled = coalesce(sync_enabled, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where true;

create unique index if not exists idx_task_calendar_connections_provider_user_uidx
  on public.task_calendar_connections(provider, user_id);
create index if not exists idx_task_calendar_connections_user_email
  on public.task_calendar_connections(lower(user_email));
create index if not exists idx_task_calendar_connections_external_email
  on public.task_calendar_connections(lower(external_account_email));
create index if not exists idx_task_calendar_connections_sync_enabled
  on public.task_calendar_connections(sync_enabled);

drop trigger if exists trg_task_calendar_connections_updated_at on public.task_calendar_connections;
create trigger trg_task_calendar_connections_updated_at
before update on public.task_calendar_connections
for each row
execute function public.set_updated_at();

-- Rebuild the task policies after the legacy column conversion.
do $$
begin
  if to_regclass('public.task_items') is not null then
    execute 'alter table public.task_items enable row level security';
  end if;
  if to_regclass('public.task_comments') is not null then
    execute 'alter table public.task_comments enable row level security';
  end if;
  if to_regclass('public.task_watchers') is not null then
    execute 'alter table public.task_watchers enable row level security';
  end if;
  if to_regclass('public.task_comment_mentions') is not null then
    execute 'alter table public.task_comment_mentions enable row level security';
  end if;
  if to_regclass('public.task_attachments') is not null then
    execute 'alter table public.task_attachments enable row level security';
  end if;
  if to_regclass('public.task_reminders') is not null then
    execute 'alter table public.task_reminders enable row level security';
  end if;
  if to_regclass('public.task_calendar_connections') is not null then
    execute 'alter table public.task_calendar_connections enable row level security';
  end if;
  if to_regclass('public.task_audit_log') is not null then
    execute 'alter table public.task_audit_log enable row level security';
  end if;
end
$$;

grant select, insert, update, delete on public.task_items to authenticated;
grant select, insert, update on public.task_comments to authenticated;
grant select, insert, update, delete on public.task_comment_mentions to authenticated;
grant select, insert, update, delete on public.task_watchers to authenticated;
grant select, insert, delete on public.task_attachments to authenticated;
grant select, insert, update, delete on public.task_reminders to authenticated;
grant select, insert, update, delete on public.task_calendar_connections to authenticated;
grant select on public.task_audit_log to authenticated;

grant all on public.task_items to service_role;
grant all on public.task_comments to service_role;
grant all on public.task_comment_mentions to service_role;
grant all on public.task_watchers to service_role;
grant all on public.task_attachments to service_role;
grant all on public.task_reminders to service_role;
grant all on public.task_calendar_connections to service_role;
grant all on public.task_audit_log to service_role;

drop policy if exists "task_items_select_admins" on public.task_items;
create policy "task_items_select_admins"
on public.task_items
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_items_insert_admins" on public.task_items;
create policy "task_items_insert_admins"
on public.task_items
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_items_update_admins" on public.task_items;
create policy "task_items_update_admins"
on public.task_items
for update
to authenticated
using (public.hmj_task_is_admin())
with check (public.hmj_task_is_admin());

drop policy if exists "task_items_delete_creator_only" on public.task_items;
create policy "task_items_delete_creator_only"
on public.task_items
for delete
to authenticated
using (public.hmj_task_is_creator(created_by, created_by_email));

drop policy if exists "task_comments_select_admins" on public.task_comments;
create policy "task_comments_select_admins"
on public.task_comments
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_comments_insert_admins" on public.task_comments;
create policy "task_comments_insert_admins"
on public.task_comments
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_comments_update_author_only" on public.task_comments;
create policy "task_comments_update_author_only"
on public.task_comments
for update
to authenticated
using (public.hmj_task_is_creator(created_by, created_by_email))
with check (public.hmj_task_is_creator(created_by, created_by_email));

drop policy if exists "task_watchers_select_admins" on public.task_watchers;
create policy "task_watchers_select_admins"
on public.task_watchers
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_watchers_insert_admins" on public.task_watchers;
create policy "task_watchers_insert_admins"
on public.task_watchers
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_watchers_update_admins" on public.task_watchers;
create policy "task_watchers_update_admins"
on public.task_watchers
for update
to authenticated
using (public.hmj_task_is_admin())
with check (public.hmj_task_is_admin());

drop policy if exists "task_watchers_delete_admins_or_self" on public.task_watchers;
create policy "task_watchers_delete_admins_or_self"
on public.task_watchers
for delete
to authenticated
using (
  public.hmj_task_is_admin()
  or public.hmj_task_is_creator(user_id, user_email)
);

drop policy if exists "task_comment_mentions_select_admins" on public.task_comment_mentions;
create policy "task_comment_mentions_select_admins"
on public.task_comment_mentions
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_comment_mentions_insert_admins" on public.task_comment_mentions;
create policy "task_comment_mentions_insert_admins"
on public.task_comment_mentions
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_comment_mentions_update_admins" on public.task_comment_mentions;
create policy "task_comment_mentions_update_admins"
on public.task_comment_mentions
for update
to authenticated
using (public.hmj_task_is_admin())
with check (public.hmj_task_is_admin());

drop policy if exists "task_comment_mentions_delete_admins" on public.task_comment_mentions;
create policy "task_comment_mentions_delete_admins"
on public.task_comment_mentions
for delete
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_attachments_select_admins" on public.task_attachments;
create policy "task_attachments_select_admins"
on public.task_attachments
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_attachments_insert_admins" on public.task_attachments;
create policy "task_attachments_insert_admins"
on public.task_attachments
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_attachments_delete_admins" on public.task_attachments;
create policy "task_attachments_delete_admins"
on public.task_attachments
for delete
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_reminders_select_admins" on public.task_reminders;
create policy "task_reminders_select_admins"
on public.task_reminders
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_reminders_insert_admins" on public.task_reminders;
create policy "task_reminders_insert_admins"
on public.task_reminders
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_reminders_update_admins" on public.task_reminders;
create policy "task_reminders_update_admins"
on public.task_reminders
for update
to authenticated
using (public.hmj_task_is_admin())
with check (public.hmj_task_is_admin());

drop policy if exists "task_reminders_delete_admins" on public.task_reminders;
create policy "task_reminders_delete_admins"
on public.task_reminders
for delete
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_audit_log_select_admins" on public.task_audit_log;
create policy "task_audit_log_select_admins"
on public.task_audit_log
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_audit_log_no_direct_insert" on public.task_audit_log;
create policy "task_audit_log_no_direct_insert"
on public.task_audit_log
for insert
to authenticated
with check (false);

drop policy if exists "task_audit_log_no_direct_update" on public.task_audit_log;
create policy "task_audit_log_no_direct_update"
on public.task_audit_log
for update
to authenticated
using (false)
with check (false);

drop policy if exists "task_audit_log_no_direct_delete" on public.task_audit_log;
create policy "task_audit_log_no_direct_delete"
on public.task_audit_log
for delete
to authenticated
using (false);

drop policy if exists "task_calendar_connections_select_admins" on public.task_calendar_connections;
create policy "task_calendar_connections_select_admins"
on public.task_calendar_connections
for select
to authenticated
using (public.hmj_task_is_admin());

drop policy if exists "task_calendar_connections_insert_admins" on public.task_calendar_connections;
create policy "task_calendar_connections_insert_admins"
on public.task_calendar_connections
for insert
to authenticated
with check (public.hmj_task_is_admin());

drop policy if exists "task_calendar_connections_update_admins" on public.task_calendar_connections;
create policy "task_calendar_connections_update_admins"
on public.task_calendar_connections
for update
to authenticated
using (public.hmj_task_is_admin())
with check (public.hmj_task_is_admin());

drop policy if exists "task_calendar_connections_delete_admins" on public.task_calendar_connections;
create policy "task_calendar_connections_delete_admins"
on public.task_calendar_connections
for delete
to authenticated
using (public.hmj_task_is_admin());

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'task-files',
  'task-files',
  false,
  15728640,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Task files admin select" on storage.objects';
    execute 'drop policy if exists "Task files admin insert" on storage.objects';
    execute 'drop policy if exists "Task files admin delete" on storage.objects';
    execute 'create policy "Task files admin select" on storage.objects for select to authenticated using (bucket_id = ''task-files'' and public.hmj_task_is_admin())';
    execute 'create policy "Task files admin insert" on storage.objects for insert to authenticated with check (bucket_id = ''task-files'' and public.hmj_task_is_admin())';
    execute 'create policy "Task files admin delete" on storage.objects for delete to authenticated using (bucket_id = ''task-files'' and public.hmj_task_is_admin())';
  end if;
end
$$;

insert into public.admin_settings (key, value)
values
(
  'team_tasks_settings',
  jsonb_build_object(
    'dueSoonDays', 3,
    'collapseDoneByDefault', true,
    'reminderRecipientMode', 'assignee_creator_watchers',
    'activityRecipientMode', 'assignee_creator_watchers',
    'activityEmailNotifications', true,
    'mentionEmailNotifications', true,
    'defaultPriority', 'medium'
  )
),
(
  'team_tasks_calendar_settings',
  jsonb_build_object(
    'enabled', false,
    'provider', 'microsoft',
    'tenantId', 'common',
    'clientId', '',
    'clientSecret', '',
    'scopes', jsonb_build_array('offline_access', 'openid', 'profile', 'User.Read', 'Calendars.Read'),
    'showExternalEvents', true,
    'showTeamConnections', true,
    'syncEnabled', true,
    'weekStartsOn', 'monday'
  )
)
on conflict (key) do update
set value = excluded.value || coalesce(public.admin_settings.value, '{}'::jsonb);
