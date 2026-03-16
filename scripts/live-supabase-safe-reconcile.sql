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
  if to_regclass('public.task_reminders') is not null then
    execute 'alter table public.task_reminders enable row level security';
  end if;
  if to_regclass('public.task_audit_log') is not null then
    execute 'alter table public.task_audit_log enable row level security';
  end if;
end
$$;

grant select, insert, update, delete on public.task_items to authenticated;
grant select, insert, update on public.task_comments to authenticated;
grant select, insert, update, delete on public.task_watchers to authenticated;
grant select, insert, update, delete on public.task_reminders to authenticated;
grant select on public.task_audit_log to authenticated;

grant all on public.task_items to service_role;
grant all on public.task_comments to service_role;
grant all on public.task_watchers to service_role;
grant all on public.task_reminders to service_role;
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
