-- HMJ Global full Supabase reconciliation
-- Repo-driven, additive, and safe to re-run.
--
-- Important scope note:
-- - This script fully reconciles the repo-owned support modules.
-- - It adds strongly evidenced additive fields to existing core tables such as
--   public.candidates and public.jobs.
-- - It intentionally does NOT try to blind-bootstrap the older CRM/timesheet
--   base tables (clients, contractors, assignments, projects, sites,
--   timesheets, timesheet_entries, v_timesheets_admin, upsert_timesheet_entry)
--   because the repo does not contain a single authoritative canonical schema
--   for those legacy objects.

-- -----------------------------------------------------------------------------
-- Extensions and shared helpers
-- -----------------------------------------------------------------------------

create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.hmj_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.team_member_slugify(input text)
returns text
language sql
immutable
as $$
  select left(
    trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g')),
    80
  );
$$;

comment on function public.team_member_slugify(text) is
  'Normalises Team module slugs to lowercase kebab-case and caps them at 80 characters.';

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
  updated_at = coalesce(updated_at, created_at, now())
where
  role is null
  or is_active is null
  or meta is null
  or created_at is null
  or updated_at is null;

create index if not exists admin_users_active_idx
  on public.admin_users (is_active, role);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'admin_users'
      and indexname = 'admin_users_user_id_uidx'
  ) then
    if not exists (
      select 1
      from public.admin_users
      where nullif(user_id, '') is not null
      group by user_id
      having count(*) > 1
    ) then
      create unique index admin_users_user_id_uidx
        on public.admin_users (user_id)
        where user_id is not null;
    else
      raise notice 'MANUAL ACTION REQUIRED: duplicate admin_users.user_id rows prevent admin_users_user_id_uidx creation.';
    end if;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'admin_users'
      and indexname = 'admin_users_email_uidx'
  ) then
    if not exists (
      select 1
      from public.admin_users
      where nullif(email, '') is not null
      group by lower(email)
      having count(*) > 1
    ) then
      create unique index admin_users_email_uidx
        on public.admin_users ((lower(email)))
        where email is not null;
    else
      raise notice 'MANUAL ACTION REQUIRED: duplicate admin_users.email rows prevent admin_users_email_uidx creation.';
    end if;
  end if;
end
$$;

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
  'Optional HMJ admin allow-list used alongside Netlify Identity admin gating.';

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
-- Storage buckets
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is not null then
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
      array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
    )
    on conflict (id) do update
    set
      name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    values (
      'team-images',
      'team-images',
      true,
      6291456,
      array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
    )
    on conflict (id) do update
    set
      name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    values (
      'candidate-matcher-uploads',
      'candidate-matcher-uploads',
      false,
      10485760,
      array[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg'
      ]::text[]
    )
    on conflict (id) do update
    set
      name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Candidate documents shared table
-- -----------------------------------------------------------------------------

create table if not exists public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  owner_auth_user_id uuid,
  document_type text not null default 'other',
  label text,
  original_filename text not null,
  filename text,
  file_extension text,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text not null default 'candidate-docs',
  storage_path text not null,
  storage_key text,
  url text,
  uploaded_at timestamptz not null default now(),
  is_primary boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table if exists public.candidate_documents
  add column if not exists candidate_id text;
alter table if exists public.candidate_documents
  add column if not exists owner_auth_user_id uuid;
alter table if exists public.candidate_documents
  add column if not exists document_type text;
alter table if exists public.candidate_documents
  add column if not exists label text;
alter table if exists public.candidate_documents
  add column if not exists original_filename text;
alter table if exists public.candidate_documents
  add column if not exists filename text;
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
  add column if not exists url text;
alter table if exists public.candidate_documents
  add column if not exists uploaded_at timestamptz;
alter table if exists public.candidate_documents
  add column if not exists is_primary boolean;
alter table if exists public.candidate_documents
  add column if not exists meta jsonb;
alter table if exists public.candidate_documents
  add column if not exists created_at timestamptz;
alter table if exists public.candidate_documents
  add column if not exists updated_at timestamptz;
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
  document_type = case
    when lower(btrim(coalesce(document_type, ''))) in ('cv', 'cover_letter', 'certificate', 'right_to_work', 'other')
      then lower(btrim(document_type))
    when lower(btrim(coalesce(document_type, ''))) in ('right to work') then 'right_to_work'
    when lower(btrim(coalesce(document_type, ''))) in ('certification') then 'certificate'
    when lower(btrim(coalesce(document_type, ''))) in ('document', '') then 'other'
    else 'other'
  end,
  label = nullif(btrim(label), ''),
  filename = coalesce(nullif(btrim(filename), ''), nullif(btrim(original_filename), '')),
  original_filename = coalesce(nullif(btrim(original_filename), ''), nullif(btrim(filename), ''), 'candidate-document'),
  file_extension = coalesce(
    nullif(btrim(file_extension), ''),
    nullif(lower(regexp_replace(coalesce(original_filename, filename, ''), '^.*(\.[^.]+)$', '\1')), '')
  ),
  storage_bucket = coalesce(nullif(btrim(storage_bucket), ''), 'candidate-docs'),
  storage_path = coalesce(nullif(btrim(storage_path), ''), nullif(btrim(storage_key), ''), concat('legacy/', id::text)),
  storage_key = coalesce(nullif(btrim(storage_key), ''), nullif(btrim(storage_path), ''), concat('legacy/', id::text)),
  uploaded_at = coalesce(uploaded_at, created_at, now()),
  created_at = coalesce(created_at, uploaded_at, now()),
  updated_at = coalesce(updated_at, uploaded_at, created_at, now()),
  is_primary = coalesce(is_primary, false),
  meta = coalesce(meta, '{}'::jsonb)
where true;

alter table if exists public.candidate_documents
  alter column document_type set default 'other';
alter table if exists public.candidate_documents
  alter column storage_bucket set default 'candidate-docs';
alter table if exists public.candidate_documents
  alter column uploaded_at set default now();
alter table if exists public.candidate_documents
  alter column created_at set default now();
alter table if exists public.candidate_documents
  alter column updated_at set default now();
alter table if exists public.candidate_documents
  alter column is_primary set default false;
alter table if exists public.candidate_documents
  alter column meta set default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.candidate_documents'::regclass
      and conname = 'candidate_documents_document_type_check'
  ) then
    alter table public.candidate_documents
      add constraint candidate_documents_document_type_check
      check (document_type in ('cv', 'cover_letter', 'certificate', 'right_to_work', 'other'));
  end if;
end
$$;

create index if not exists candidate_documents_candidate_created_idx
  on public.candidate_documents (candidate_id, created_at desc);

create index if not exists candidate_documents_owner_idx
  on public.candidate_documents (owner_auth_user_id, uploaded_at desc);

create index if not exists candidate_documents_uploaded_idx
  on public.candidate_documents (uploaded_at desc);

create index if not exists candidate_documents_type_idx
  on public.candidate_documents (document_type, uploaded_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'candidate_documents'
      and indexname = 'candidate_documents_storage_key_uidx'
  ) then
    if not exists (
      select 1
      from public.candidate_documents
      where nullif(storage_key, '') is not null
      group by storage_key
      having count(*) > 1
    ) then
      create unique index candidate_documents_storage_key_uidx
        on public.candidate_documents (storage_key)
        where storage_key is not null;
    else
      raise notice 'MANUAL ACTION REQUIRED: duplicate candidate_documents.storage_key rows prevent candidate_documents_storage_key_uidx creation.';
    end if;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'candidate_documents'
      and indexname = 'candidate_documents_storage_uidx'
  ) then
    if not exists (
      select 1
      from public.candidate_documents
      where deleted_at is null
        and nullif(storage_bucket, '') is not null
        and nullif(storage_path, '') is not null
      group by storage_bucket, storage_path
      having count(*) > 1
    ) then
      create unique index candidate_documents_storage_uidx
        on public.candidate_documents (storage_bucket, storage_path)
        where deleted_at is null
          and storage_bucket is not null
          and storage_path is not null;
    else
      raise notice 'MANUAL ACTION REQUIRED: duplicate candidate_documents storage paths prevent candidate_documents_storage_uidx creation.';
    end if;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.candidate_documents') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.candidate_documents')
         and tgname = 'candidate_documents_touch_updated_at'
     )
  then
    create trigger candidate_documents_touch_updated_at
      before update on public.candidate_documents
      for each row
      execute function public.hmj_touch_updated_at();
  end if;
end
$$;

comment on table public.candidate_documents is
  'Shared candidate document metadata for both admin-managed uploads and candidate self-service uploads.';

-- -----------------------------------------------------------------------------
-- Noticeboard module
-- -----------------------------------------------------------------------------

create table if not exists public.noticeboard_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  created_by_email text,
  updated_by_email text,
  title text not null default '',
  slug text not null,
  summary text not null default '',
  body text not null default '',
  image_url text,
  image_storage_key text,
  image_alt_text text,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'archived')),
  publish_at timestamptz,
  expires_at timestamptz,
  featured boolean not null default false,
  sort_order integer not null default 100,
  cta_label text,
  cta_url text
);

alter table if exists public.noticeboard_posts
  add column if not exists created_by text;
alter table if exists public.noticeboard_posts
  add column if not exists created_by_email text;
alter table if exists public.noticeboard_posts
  add column if not exists updated_by_email text;
alter table if exists public.noticeboard_posts
  add column if not exists summary text;
alter table if exists public.noticeboard_posts
  add column if not exists image_url text;
alter table if exists public.noticeboard_posts
  add column if not exists image_storage_key text;
alter table if exists public.noticeboard_posts
  add column if not exists image_alt_text text;
alter table if exists public.noticeboard_posts
  add column if not exists publish_at timestamptz;
alter table if exists public.noticeboard_posts
  add column if not exists expires_at timestamptz;
alter table if exists public.noticeboard_posts
  add column if not exists featured boolean;
alter table if exists public.noticeboard_posts
  add column if not exists sort_order integer;
alter table if exists public.noticeboard_posts
  add column if not exists cta_label text;
alter table if exists public.noticeboard_posts
  add column if not exists cta_url text;

update public.noticeboard_posts
set
  summary = coalesce(nullif(summary, ''), left(regexp_replace(coalesce(body, ''), '\s+', ' ', 'g'), 190)),
  featured = coalesce(featured, false),
  sort_order = coalesce(sort_order, 100),
  updated_at = coalesce(updated_at, created_at, now())
where
  summary is null
  or featured is null
  or sort_order is null
  or updated_at is null;

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

comment on table public.noticeboard_posts is
  'HMJ public noticeboard posts. Browser clients should not query this table directly; Netlify Functions handle public filtering and admin writes.';

-- -----------------------------------------------------------------------------
-- Team module
-- -----------------------------------------------------------------------------

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  created_by_email text,
  updated_by_email text,
  full_name text not null default '',
  slug text not null,
  role_title text not null default '',
  short_caption text not null default '',
  full_bio text not null default '',
  image_url text,
  image_storage_key text,
  image_alt_text text,
  linkedin_url text,
  email text,
  display_order integer not null default 100,
  is_published boolean not null default false,
  published_at timestamptz,
  archived_at timestamptz
);

alter table if exists public.team_members add column if not exists created_by text;
alter table if exists public.team_members add column if not exists created_by_email text;
alter table if exists public.team_members add column if not exists updated_by_email text;
alter table if exists public.team_members add column if not exists full_name text;
alter table if exists public.team_members add column if not exists slug text;
alter table if exists public.team_members add column if not exists role_title text;
alter table if exists public.team_members add column if not exists short_caption text;
alter table if exists public.team_members add column if not exists full_bio text;
alter table if exists public.team_members add column if not exists image_url text;
alter table if exists public.team_members add column if not exists image_storage_key text;
alter table if exists public.team_members add column if not exists image_alt_text text;
alter table if exists public.team_members add column if not exists linkedin_url text;
alter table if exists public.team_members add column if not exists email text;
alter table if exists public.team_members add column if not exists display_order integer;
alter table if exists public.team_members add column if not exists is_published boolean;
alter table if exists public.team_members add column if not exists published_at timestamptz;
alter table if exists public.team_members add column if not exists archived_at timestamptz;

update public.team_members
set
  full_name = coalesce(full_name, ''),
  role_title = coalesce(role_title, ''),
  short_caption = coalesce(short_caption, ''),
  full_bio = coalesce(full_bio, ''),
  display_order = greatest(coalesce(display_order, 100), 0),
  is_published = case
    when archived_at is not null then false
    else coalesce(is_published, false)
  end,
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where true;

with normalised as (
  select
    id,
    created_at,
    case
      when public.team_member_slugify(nullif(slug, '')) <> '' then public.team_member_slugify(nullif(slug, ''))
      when public.team_member_slugify(full_name) <> '' then public.team_member_slugify(full_name)
      else public.team_member_slugify('team-' || replace(id::text, '-', ''))
    end as base_slug
  from public.team_members
),
ranked as (
  select
    id,
    base_slug,
    row_number() over (
      partition by base_slug
      order by created_at asc nulls first, id asc
    ) as slug_rank
  from normalised
),
resolved as (
  select
    id,
    case
      when slug_rank = 1 then base_slug
      else left(base_slug, greatest(1, 80 - length('-' || slug_rank::text))) || '-' || slug_rank::text
    end as resolved_slug
  from ranked
)
update public.team_members team_member
set slug = resolved.resolved_slug
from resolved
where team_member.id = resolved.id
  and coalesce(team_member.slug, '') <> resolved.resolved_slug;

create index if not exists team_members_admin_board_idx
  on public.team_members (archived_at asc nulls first, display_order asc, created_at asc, full_name asc);

create index if not exists team_members_public_order_idx
  on public.team_members (display_order asc, created_at asc, full_name asc)
  where is_published is true and archived_at is null;

create index if not exists team_members_updated_idx
  on public.team_members (updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'team_members'
      and indexname = 'team_members_slug_uidx'
  ) then
    if not exists (
      select 1
      from public.team_members
      where nullif(slug, '') is not null
      group by slug
      having count(*) > 1
    ) then
      create unique index team_members_slug_uidx
        on public.team_members (slug);
    else
      raise notice 'MANUAL ACTION REQUIRED: duplicate team_members.slug rows prevent team_members_slug_uidx creation.';
    end if;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_members'::regclass
      and conname = 'team_members_display_order_nonnegative'
  ) then
    alter table public.team_members
      add constraint team_members_display_order_nonnegative
      check (display_order >= 0);
  end if;
end
$$;

do $$
begin
  if to_regclass('public.team_members') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.team_members')
         and tgname = 'team_members_set_updated_at'
     )
  then
    create trigger team_members_set_updated_at
      before update on public.team_members
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

comment on table public.team_members is
  'HMJ About page team members. Browser clients should not query this table directly; Netlify Functions handle public filtering and admin writes.';

-- -----------------------------------------------------------------------------
-- Short links and job snapshots
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
  is_active = coalesce(is_active, true),
  click_count = coalesce(click_count, 0)
where
  is_active is null
  or click_count is null;

create index if not exists short_links_created_at_idx
  on public.short_links (created_at desc);

create index if not exists short_links_active_created_at_idx
  on public.short_links (is_active, created_at desc);

comment on table public.short_links is
  'HMJ branded short links created from the admin dashboard.';

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
  add column if not exists title text;
alter table if exists public.job_specs
  add column if not exists payload jsonb;
alter table if exists public.job_specs
  add column if not exists notes text;
alter table if exists public.job_specs
  add column if not exists expires_at timestamptz;
alter table if exists public.job_specs
  add column if not exists created_at timestamptz;

update public.job_specs
set
  payload = coalesce(payload, '{}'::jsonb),
  created_at = coalesce(created_at, now())
where
  payload is null
  or created_at is null;

create index if not exists job_specs_job_id_idx
  on public.job_specs (job_id);

create index if not exists job_specs_expires_at_idx
  on public.job_specs (expires_at);

comment on table public.job_specs is
  'Snapshot storage for HMJ admin shareable job-spec links.';

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

update public.jobs
set
  benefits = coalesce(benefits, '{}'::text[]),
  public_page_config = coalesce(
    public_page_config,
    jsonb_build_object(
      'showOverview', true,
      'showPay', true,
      'showCustomer', true,
      'showBenefits', true,
      'showResponsibilities', true,
      'showRequirements', true,
      'showTags', true,
      'showRoleHighlights', true,
      'showApplyPanel', true,
      'showSecondaryCta', true,
      'showPageMeta', true,
      'showReference', true
    )
  )
where
  benefits is null
  or public_page_config is null;

-- -----------------------------------------------------------------------------
-- Candidate portal support
-- -----------------------------------------------------------------------------

alter table if exists public.candidates
  add column if not exists first_name text;
alter table if exists public.candidates
  add column if not exists last_name text;
alter table if exists public.candidates
  add column if not exists email text;
alter table if exists public.candidates
  add column if not exists phone text;
alter table if exists public.candidates
  add column if not exists location text;
alter table if exists public.candidates
  add column if not exists country text;
alter table if exists public.candidates
  add column if not exists status text;
alter table if exists public.candidates
  add column if not exists created_at timestamptz;
alter table if exists public.candidates
  add column if not exists updated_at timestamptz;
alter table if exists public.candidates
  add column if not exists auth_user_id uuid;
alter table if exists public.candidates
  add column if not exists full_name text;
alter table if exists public.candidates
  add column if not exists sector_focus text;
alter table if exists public.candidates
  add column if not exists skills text[];
alter table if exists public.candidates
  add column if not exists availability text;
alter table if exists public.candidates
  add column if not exists headline_role text;
alter table if exists public.candidates
  add column if not exists linkedin_url text;
alter table if exists public.candidates
  add column if not exists summary text;
alter table if exists public.candidates
  add column if not exists archived_at timestamptz;
alter table if exists public.candidates
  add column if not exists portal_account_closed_at timestamptz;
alter table if exists public.candidates
  add column if not exists last_portal_login_at timestamptz;

update public.candidates
set
  email = lower(nullif(btrim(email), '')),
  first_name = nullif(btrim(first_name), ''),
  last_name = nullif(btrim(last_name), ''),
  full_name = coalesce(
    nullif(btrim(full_name), ''),
    nullif(btrim(concat_ws(' ', first_name, last_name)), ''),
    full_name
  ),
  phone = nullif(btrim(phone), ''),
  location = nullif(btrim(location), ''),
  country = nullif(btrim(country), ''),
  headline_role = nullif(btrim(headline_role), ''),
  sector_focus = nullif(btrim(sector_focus), ''),
  summary = nullif(btrim(summary), ''),
  linkedin_url = nullif(btrim(linkedin_url), ''),
  availability = nullif(btrim(availability), ''),
  status = coalesce(nullif(btrim(status), ''), 'active'),
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

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'candidates'
      and indexname = 'candidates_auth_user_id_uidx'
  ) then
    if not exists (
      select 1
      from public.candidates
      where auth_user_id is not null
      group by auth_user_id
      having count(*) > 1
    ) then
      create unique index candidates_auth_user_id_uidx
        on public.candidates (auth_user_id)
        where auth_user_id is not null;
    else
      raise notice 'MANUAL ACTION REQUIRED: duplicate candidates.auth_user_id rows prevent candidates_auth_user_id_uidx creation.';
    end if;
  end if;
end
$$;

create index if not exists candidates_email_idx
  on public.candidates (lower(email));

create index if not exists candidates_status_updated_idx
  on public.candidates (status, updated_at desc);

create table if not exists public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  skill text not null,
  created_at timestamptz not null default now()
);

alter table if exists public.candidate_skills
  add column if not exists candidate_id text;
alter table if exists public.candidate_skills
  add column if not exists skill text;
alter table if exists public.candidate_skills
  add column if not exists created_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_skills'
      and column_name = 'candidate_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.candidate_skills alter column candidate_id type text using candidate_id::text';
  end if;
end
$$;

update public.candidate_skills
set
  candidate_id = btrim(coalesce(candidate_id, '')),
  skill = btrim(coalesce(skill, '')),
  created_at = coalesce(created_at, now())
where true;

delete from public.candidate_skills t
using public.candidate_skills d
where t.id < d.id
  and coalesce(t.candidate_id, '') = coalesce(d.candidate_id, '')
  and lower(coalesce(t.skill, '')) = lower(coalesce(d.skill, ''))
  and coalesce(t.candidate_id, '') <> ''
  and lower(coalesce(t.skill, '')) <> '';

create index if not exists candidate_skills_candidate_idx
  on public.candidate_skills (candidate_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'candidate_skills'
      and indexname = 'candidate_skills_candidate_skill_uidx'
  ) then
    create unique index candidate_skills_candidate_skill_uidx
      on public.candidate_skills (candidate_id, lower(skill))
      where candidate_id <> ''
        and skill <> '';
  end if;
end
$$;

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  job_id text not null,
  status text not null default 'submitted',
  applied_at timestamptz not null default now(),
  notes text,
  job_title text,
  job_location text,
  job_type text,
  job_pay text,
  source text not null default 'candidate_portal',
  source_submission_id text,
  share_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.job_applications
  add column if not exists candidate_id text;
alter table if exists public.job_applications
  add column if not exists job_id text;
alter table if exists public.job_applications
  add column if not exists status text;
alter table if exists public.job_applications
  add column if not exists applied_at timestamptz;
alter table if exists public.job_applications
  add column if not exists notes text;
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
  add column if not exists share_code text;
alter table if exists public.job_applications
  add column if not exists created_at timestamptz;
alter table if exists public.job_applications
  add column if not exists updated_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_applications'
      and column_name = 'candidate_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.job_applications alter column candidate_id type text using candidate_id::text';
  end if;

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

update public.job_applications
set
  candidate_id = btrim(coalesce(candidate_id, '')),
  job_id = btrim(coalesce(job_id::text, '')),
  status = case
    when lower(btrim(coalesce(status, ''))) in ('submitted', 'reviewing', 'shortlisted', 'interviewing', 'on_hold', 'rejected', 'offered', 'hired') then lower(btrim(status))
    when lower(btrim(coalesce(status, ''))) = 'applied' then 'submitted'
    when lower(btrim(coalesce(status, ''))) = 'under review' then 'reviewing'
    when lower(btrim(coalesce(status, ''))) = 'on hold' then 'on_hold'
    else 'submitted'
  end,
  source = coalesce(nullif(btrim(source), ''), 'candidate_portal'),
  created_at = coalesce(created_at, applied_at, now()),
  updated_at = coalesce(updated_at, created_at, applied_at, now())
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_applications'::regclass
      and conname = 'job_applications_status_check'
  ) then
    alter table public.job_applications
      add constraint job_applications_status_check
      check (status in ('submitted', 'reviewing', 'shortlisted', 'interviewing', 'on_hold', 'rejected', 'offered', 'hired'));
  end if;
end
$$;

with ranked as (
  select
    id,
    row_number() over (
      partition by candidate_id, job_id
      order by updated_at desc nulls last, applied_at desc nulls last, id desc
    ) as dup_rank
  from public.job_applications
  where candidate_id <> ''
    and job_id <> ''
)
delete from public.job_applications
where id in (
  select id
  from ranked
  where dup_rank > 1
);

create index if not exists job_applications_candidate_idx
  on public.job_applications (candidate_id, applied_at desc);

create index if not exists job_applications_job_idx
  on public.job_applications (job_id, applied_at desc);

create index if not exists job_applications_status_idx
  on public.job_applications (status, applied_at desc);

create index if not exists job_applications_source_submission_idx
  on public.job_applications (source_submission_id)
  where source_submission_id is not null;

create index if not exists job_applications_share_code_idx
  on public.job_applications (share_code)
  where share_code is not null;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'job_applications'
      and indexname = 'job_applications_candidate_job_uidx'
  ) then
    create unique index job_applications_candidate_job_uidx
      on public.job_applications (candidate_id, job_id)
      where candidate_id <> ''
        and job_id <> '';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.job_applications') is not null
     and not exists (
       select 1
       from pg_trigger
       where tgrelid = to_regclass('public.job_applications')
         and tgname = 'job_applications_touch_updated_at'
     )
  then
    create trigger job_applications_touch_updated_at
      before update on public.job_applications
      for each row
      execute function public.hmj_touch_updated_at();
  end if;
end
$$;

create table if not exists public.candidate_activity (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  activity_type text not null,
  description text,
  actor_role text not null default 'candidate',
  actor_identifier text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.candidate_activity
  add column if not exists candidate_id text;
alter table if exists public.candidate_activity
  add column if not exists activity_type text;
alter table if exists public.candidate_activity
  add column if not exists description text;
alter table if exists public.candidate_activity
  add column if not exists actor_role text;
alter table if exists public.candidate_activity
  add column if not exists actor_identifier text;
alter table if exists public.candidate_activity
  add column if not exists meta jsonb;
alter table if exists public.candidate_activity
  add column if not exists created_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_activity'
      and column_name = 'candidate_id'
      and data_type <> 'text'
  ) then
    execute 'alter table public.candidate_activity alter column candidate_id type text using candidate_id::text';
  end if;
end
$$;

update public.candidate_activity
set
  candidate_id = btrim(coalesce(candidate_id, '')),
  activity_type = lower(replace(btrim(coalesce(activity_type, 'unknown')), ' ', '_')),
  actor_role = coalesce(nullif(btrim(actor_role), ''), 'candidate'),
  actor_identifier = nullif(btrim(actor_identifier), ''),
  meta = coalesce(meta, '{}'::jsonb),
  created_at = coalesce(created_at, now())
where true;

create index if not exists candidate_activity_candidate_idx
  on public.candidate_activity (candidate_id, created_at desc);

create index if not exists candidate_activity_type_idx
  on public.candidate_activity (activity_type, created_at desc);

create or replace function public.hmj_candidate_has_auth_user(candidate_key text)
returns boolean
language plpgsql
stable
as $$
declare
  candidate_match boolean := false;
begin
  if nullif(btrim(candidate_key), '') is null or auth.uid() is null then
    return false;
  end if;

  if to_regclass('public.candidates') is null then
    return false;
  end if;

  execute $sql$
    select exists (
      select 1
      from public.candidates c
      where c.id::text = $1
        and c.auth_user_id = auth.uid()
    )
  $sql$
  into candidate_match
  using candidate_key;

  return coalesce(candidate_match, false);
end;
$$;

comment on function public.hmj_candidate_has_auth_user(text) is
  'Returns true when the authenticated Supabase candidate user owns the supplied legacy-compatible candidate key.';

-- Candidate portal RLS
do $$
begin
  if to_regclass('public.candidates') is not null then
    execute 'alter table public.candidates enable row level security';
    execute 'revoke all on public.candidates from anon';
    execute 'grant select, insert, update on public.candidates to authenticated';
    execute 'grant all on public.candidates to service_role';
    execute 'drop policy if exists "candidate self select" on public.candidates';
    execute 'drop policy if exists "candidate self insert" on public.candidates';
    execute 'drop policy if exists "candidate self update" on public.candidates';
    execute 'create policy "candidate self select" on public.candidates for select to authenticated using (auth.uid() = auth_user_id)';
    execute 'create policy "candidate self insert" on public.candidates for insert to authenticated with check (auth.uid() = auth_user_id)';
    execute 'create policy "candidate self update" on public.candidates for update to authenticated using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id)';
  end if;
end
$$;

alter table public.candidate_skills enable row level security;
alter table public.job_applications enable row level security;
alter table public.candidate_activity enable row level security;
alter table public.candidate_documents enable row level security;

revoke all on public.candidate_skills from anon;
revoke all on public.job_applications from anon;
revoke all on public.candidate_activity from anon;
revoke all on public.candidate_documents from anon;

grant select, insert, delete on public.candidate_skills to authenticated;
grant select on public.job_applications to authenticated;
grant select, insert on public.candidate_activity to authenticated;
grant select, insert, delete on public.candidate_documents to authenticated;

grant all on public.candidate_skills to service_role;
grant all on public.job_applications to service_role;
grant all on public.candidate_activity to service_role;
grant all on public.candidate_documents to service_role;

drop policy if exists "candidate skills self select" on public.candidate_skills;
create policy "candidate skills self select"
  on public.candidate_skills
  for select
  to authenticated
  using (public.hmj_candidate_has_auth_user(candidate_id));

drop policy if exists "candidate skills self insert" on public.candidate_skills;
create policy "candidate skills self insert"
  on public.candidate_skills
  for insert
  to authenticated
  with check (public.hmj_candidate_has_auth_user(candidate_id));

drop policy if exists "candidate skills self delete" on public.candidate_skills;
create policy "candidate skills self delete"
  on public.candidate_skills
  for delete
  to authenticated
  using (public.hmj_candidate_has_auth_user(candidate_id));

drop policy if exists "candidate apps self select" on public.job_applications;
create policy "candidate apps self select"
  on public.job_applications
  for select
  to authenticated
  using (public.hmj_candidate_has_auth_user(candidate_id));

drop policy if exists "candidate activity self select" on public.candidate_activity;
create policy "candidate activity self select"
  on public.candidate_activity
  for select
  to authenticated
  using (public.hmj_candidate_has_auth_user(candidate_id));

drop policy if exists "candidate activity self insert" on public.candidate_activity;
create policy "candidate activity self insert"
  on public.candidate_activity
  for insert
  to authenticated
  with check (
    public.hmj_candidate_has_auth_user(candidate_id)
    and coalesce(actor_role, 'candidate') = 'candidate'
    and (actor_identifier is null or actor_identifier = auth.uid()::text)
  );

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

-- Public-read storage policies for the public image buckets.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Team images are publicly readable" on storage.objects';
    execute 'create policy "Team images are publicly readable" on storage.objects for select using (bucket_id = ''team-images'')';
    execute 'drop policy if exists "Noticeboard images are publicly readable" on storage.objects';
    execute 'create policy "Noticeboard images are publicly readable" on storage.objects for select using (bucket_id = ''noticeboard-images'')';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Candidate matcher
-- -----------------------------------------------------------------------------

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
  'Private candidate matcher run history for HMJ admin workflows.';

comment on table public.candidate_match_files is
  'Private candidate matcher upload metadata for HMJ admin workflows.';

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

update public.chatbot_conversations
set
  metadata = coalesce(metadata, '{}'::jsonb),
  ip_hash = coalesce(
    nullif(ip_hash, ''),
    case
      when nullif(ip_address, '') is null then null
      else encode(digest(ip_address, 'sha256'), 'hex')
    end
  ),
  ip_address = null
where nullif(ip_address, '') is not null
   or metadata is null;

comment on table public.chatbot_conversations is
  'Top-level session rows for the HMJ website chatbot.';

comment on column public.chatbot_conversations.ip_address is
  'Deprecated legacy column. New chatbot writes should keep this null and rely on ip_hash instead.';

comment on column public.chatbot_conversations.ip_hash is
  'SHA-256 hash of the visitor IP address for grouping without raw IP storage.';

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
end;
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
end;
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
-- Team Tasks module
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'task_status'
  ) then
    create type public.task_status as enum ('open', 'in_progress', 'waiting', 'done', 'archived');
  end if;

  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'task_priority'
  ) then
    create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
  end if;

  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'task_reminder_status'
  ) then
    create type public.task_reminder_status as enum ('pending', 'sent', 'cancelled', 'failed');
  end if;
end
$$;

create table if not exists public.task_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status public.task_status not null default 'open',
  priority public.task_priority not null default 'medium',
  created_by text,
  created_by_email text,
  updated_by text,
  updated_by_email text,
  assigned_to text,
  assigned_to_email text,
  due_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  reminder_enabled boolean not null default false,
  reminder_mode text,
  reminder_custom_at timestamptz,
  linked_module text,
  linked_url text,
  tags text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.task_items add column if not exists description text;
alter table if exists public.task_items add column if not exists status public.task_status;
alter table if exists public.task_items add column if not exists priority public.task_priority;
alter table if exists public.task_items add column if not exists created_by text;
alter table if exists public.task_items add column if not exists created_by_email text;
alter table if exists public.task_items add column if not exists updated_by text;
alter table if exists public.task_items add column if not exists updated_by_email text;
alter table if exists public.task_items add column if not exists assigned_to text;
alter table if exists public.task_items add column if not exists assigned_to_email text;
alter table if exists public.task_items add column if not exists due_at timestamptz;
alter table if exists public.task_items add column if not exists completed_at timestamptz;
alter table if exists public.task_items add column if not exists archived_at timestamptz;
alter table if exists public.task_items add column if not exists reminder_enabled boolean;
alter table if exists public.task_items add column if not exists reminder_mode text;
alter table if exists public.task_items add column if not exists reminder_custom_at timestamptz;
alter table if exists public.task_items add column if not exists linked_module text;
alter table if exists public.task_items add column if not exists linked_url text;
alter table if exists public.task_items add column if not exists tags text[];
alter table if exists public.task_items add column if not exists sort_order integer;
alter table if exists public.task_items add column if not exists created_at timestamptz;
alter table if exists public.task_items add column if not exists updated_at timestamptz;

update public.task_items
set
  description = coalesce(description, ''),
  status = coalesce(status, 'open'::public.task_status),
  priority = coalesce(priority, 'medium'::public.task_priority),
  reminder_enabled = coalesce(reminder_enabled, false),
  tags = coalesce(tags, '{}'::text[]),
  sort_order = coalesce(sort_order, 0),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.task_items'::regclass
      and conname = 'task_items_reminder_mode_check'
  ) then
    alter table public.task_items
      add constraint task_items_reminder_mode_check
      check (
        reminder_mode is null
        or reminder_mode = any (array['none', 'due_date_9am', '1_day_before', '2_days_before', 'custom'])
      );
  end if;
end
$$;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  comment_body text not null,
  created_by text,
  created_by_email text,
  updated_by text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.task_comments add column if not exists created_by text;
alter table if exists public.task_comments add column if not exists created_by_email text;
alter table if exists public.task_comments add column if not exists updated_by text;
alter table if exists public.task_comments add column if not exists updated_by_email text;
alter table if exists public.task_comments add column if not exists created_at timestamptz;
alter table if exists public.task_comments add column if not exists updated_at timestamptz;

update public.task_comments
set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where true;

create table if not exists public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  user_id text,
  user_email text,
  created_by text,
  created_by_email text,
  created_at timestamptz not null default now()
);

alter table if exists public.task_watchers add column if not exists user_id text;
alter table if exists public.task_watchers add column if not exists user_email text;
alter table if exists public.task_watchers add column if not exists created_by text;
alter table if exists public.task_watchers add column if not exists created_by_email text;
alter table if exists public.task_watchers add column if not exists created_at timestamptz;

update public.task_watchers
set
  created_at = coalesce(created_at, now())
where created_at is null;

create table if not exists public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  recipient_user_id text,
  recipient_email text,
  reminder_mode text not null default 'custom',
  send_at timestamptz,
  sent_at timestamptz,
  status public.task_reminder_status not null default 'pending',
  failure_reason text,
  created_by text,
  created_by_email text,
  updated_by text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.task_reminders add column if not exists recipient_user_id text;
alter table if exists public.task_reminders add column if not exists recipient_email text;
alter table if exists public.task_reminders add column if not exists reminder_mode text;
alter table if exists public.task_reminders add column if not exists send_at timestamptz;
alter table if exists public.task_reminders add column if not exists sent_at timestamptz;
alter table if exists public.task_reminders add column if not exists status public.task_reminder_status;
alter table if exists public.task_reminders add column if not exists failure_reason text;
alter table if exists public.task_reminders add column if not exists created_by text;
alter table if exists public.task_reminders add column if not exists created_by_email text;
alter table if exists public.task_reminders add column if not exists updated_by text;
alter table if exists public.task_reminders add column if not exists updated_by_email text;
alter table if exists public.task_reminders add column if not exists created_at timestamptz;
alter table if exists public.task_reminders add column if not exists updated_at timestamptz;

update public.task_reminders
set
  reminder_mode = coalesce(nullif(btrim(reminder_mode), ''), 'custom'),
  status = coalesce(status, 'pending'::public.task_reminder_status),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.task_reminders'::regclass
      and conname = 'task_reminders_mode_check'
  ) then
    alter table public.task_reminders
      add constraint task_reminders_mode_check
      check (reminder_mode = any (array['none', 'due_date_9am', '1_day_before', '2_days_before', 'custom']));
  end if;
end
$$;

create table if not exists public.task_audit_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.task_items(id) on delete cascade,
  action_type text not null,
  actor_user_id text,
  actor_email text,
  entity_type text not null default 'task',
  entity_id text,
  source_action text,
  old_data jsonb not null default '{}'::jsonb,
  new_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.task_audit_log add column if not exists task_id uuid;
alter table if exists public.task_audit_log add column if not exists action_type text;
alter table if exists public.task_audit_log add column if not exists actor_user_id text;
alter table if exists public.task_audit_log add column if not exists actor_email text;
alter table if exists public.task_audit_log add column if not exists entity_type text;
alter table if exists public.task_audit_log add column if not exists entity_id text;
alter table if exists public.task_audit_log add column if not exists source_action text;
alter table if exists public.task_audit_log add column if not exists old_data jsonb;
alter table if exists public.task_audit_log add column if not exists new_data jsonb;
alter table if exists public.task_audit_log add column if not exists metadata jsonb;
alter table if exists public.task_audit_log add column if not exists created_at timestamptz;

update public.task_audit_log
set
  entity_type = coalesce(nullif(btrim(entity_type), ''), 'task'),
  old_data = coalesce(old_data, '{}'::jsonb),
  new_data = coalesce(new_data, '{}'::jsonb),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now())
where
  entity_type is null
  or old_data is null
  or new_data is null
  or metadata is null
  or created_at is null;

create index if not exists idx_task_items_status on public.task_items(status);
create index if not exists idx_task_items_due_at on public.task_items(due_at);
create index if not exists idx_task_items_created_by on public.task_items(created_by);
create index if not exists idx_task_items_created_by_email on public.task_items(lower(created_by_email));
create index if not exists idx_task_items_assigned_to on public.task_items(assigned_to);
create index if not exists idx_task_items_assigned_to_email on public.task_items(lower(assigned_to_email));
create index if not exists idx_task_items_archived_at on public.task_items(archived_at);
create index if not exists idx_task_items_updated_at on public.task_items(updated_at desc);

create index if not exists idx_task_comments_task_id on public.task_comments(task_id);
create index if not exists idx_task_comments_created_by on public.task_comments(created_by);
create index if not exists idx_task_comments_created_by_email on public.task_comments(lower(created_by_email));
create index if not exists idx_task_comments_created_at on public.task_comments(created_at);

create index if not exists idx_task_watchers_task_id on public.task_watchers(task_id);
create index if not exists idx_task_watchers_user_id on public.task_watchers(user_id);
create index if not exists idx_task_watchers_user_email on public.task_watchers(lower(user_email));

create index if not exists idx_task_reminders_task_id on public.task_reminders(task_id);
create index if not exists idx_task_reminders_send_at on public.task_reminders(send_at);
create index if not exists idx_task_reminders_status on public.task_reminders(status);
create index if not exists idx_task_reminders_recipient_email on public.task_reminders(lower(recipient_email));

create index if not exists idx_task_audit_log_task_id on public.task_audit_log(task_id);
create index if not exists idx_task_audit_log_actor_user_id on public.task_audit_log(actor_user_id);
create index if not exists idx_task_audit_log_created_at on public.task_audit_log(created_at desc);
create index if not exists idx_task_audit_log_action_type on public.task_audit_log(action_type);
create index if not exists idx_task_audit_log_entity_type on public.task_audit_log(entity_type);

create or replace function public.hmj_task_current_user_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'sub', ''),
    nullif(auth.jwt() ->> 'user_id', ''),
    nullif(auth.uid()::text, '')
  );
$$;

create or replace function public.hmj_task_current_user_email()
returns text
language sql
stable
as $$
  select lower(
    coalesce(
      nullif(auth.jwt() ->> 'email', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'email', ''),
      nullif(auth.jwt() -> 'app_metadata' ->> 'email', '')
    )
  );
$$;

create or replace function public.hmj_task_current_roles()
returns text[]
language plpgsql
stable
as $$
declare
  claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  roles jsonb;
  role_text text;
  out_roles text[] := '{}'::text[];
begin
  roles := claims -> 'app_metadata' -> 'roles';
  if jsonb_typeof(roles) = 'array' then
    select coalesce(array_agg(lower(value)), '{}'::text[])
    into out_roles
    from jsonb_array_elements_text(roles) as value;
    return out_roles;
  end if;

  roles := claims -> 'roles';
  if jsonb_typeof(roles) = 'array' then
    select coalesce(array_agg(lower(value)), '{}'::text[])
    into out_roles
    from jsonb_array_elements_text(roles) as value;
    return out_roles;
  end if;

  role_text := lower(
    coalesce(
      nullif(claims -> 'app_metadata' ->> 'role', ''),
      nullif(claims ->> 'role', '')
    )
  );
  if role_text <> '' then
    return array[role_text];
  end if;

  return out_roles;
end;
$$;

create or replace function public.hmj_task_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  roles text[] := public.hmj_task_current_roles();
  actor_id text := public.hmj_task_current_user_id();
  actor_email text := public.hmj_task_current_user_email();
begin
  if roles && array['admin', 'super-admin', 'super_admin', 'owner'] then
    return true;
  end if;

  if to_regclass('public.admin_users') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.admin_users as admin_user
    where coalesce(admin_user.is_active, true) = true
      and (
        (actor_id is not null and actor_id <> '' and admin_user.user_id = actor_id)
        or (
          actor_email is not null
          and actor_email <> ''
          and lower(coalesce(admin_user.email, '')) = actor_email
        )
      )
  );
end;
$$;

create or replace function public.hmj_task_is_creator(p_created_by text, p_created_by_email text default null)
returns boolean
language sql
stable
as $$
  select (
    (
      nullif(public.hmj_task_current_user_id(), '') is not null
      and nullif(p_created_by, '') = public.hmj_task_current_user_id()
    )
    or (
      nullif(public.hmj_task_current_user_email(), '') is not null
      and lower(coalesce(p_created_by_email, '')) = public.hmj_task_current_user_email()
    )
  );
$$;

create or replace function public.task_items_assign_actor()
returns trigger
language plpgsql
as $$
declare
  actor_id text := nullif(public.hmj_task_current_user_id(), '');
  actor_email text := nullif(public.hmj_task_current_user_email(), '');
begin
  if coalesce(actor_id, actor_email) is null then
    raise exception 'HMJ task identity missing for task write.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(new.created_by, ''), actor_id, actor_email);
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email);
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
  end if;

  new.updated_by := coalesce(actor_id, actor_email);
  new.updated_by_email := actor_email;
  new.updated_at := now();
  new.tags := coalesce(new.tags, '{}'::text[]);
  new.sort_order := coalesce(new.sort_order, 0);
  new.reminder_enabled := coalesce(new.reminder_enabled, false);

  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') and new.completed_at is null then
    new.completed_at := now();
  elsif tg_op = 'UPDATE' and new.status <> 'done' and old.status = 'done' then
    new.completed_at := null;
  end if;

  if new.status = 'archived' and new.archived_at is null then
    new.archived_at := now();
  elsif tg_op = 'UPDATE' and new.status <> 'archived' and old.status = 'archived' then
    new.archived_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.task_comments_assign_actor()
returns trigger
language plpgsql
as $$
declare
  actor_id text := nullif(public.hmj_task_current_user_id(), '');
  actor_email text := nullif(public.hmj_task_current_user_email(), '');
begin
  if coalesce(actor_id, actor_email) is null then
    raise exception 'HMJ task identity missing for comment write.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(new.created_by, ''), actor_id, actor_email);
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email);
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
  end if;

  new.updated_by := coalesce(actor_id, actor_email);
  new.updated_by_email := actor_email;
  new.updated_at := now();

  return new;
end;
$$;

create or replace function public.task_watchers_assign_actor()
returns trigger
language plpgsql
as $$
declare
  actor_id text := nullif(public.hmj_task_current_user_id(), '');
  actor_email text := nullif(public.hmj_task_current_user_email(), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(new.created_by, ''), actor_id, actor_email);
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email);
    new.created_at := coalesce(new.created_at, now());
  end if;
  return new;
end;
$$;

create or replace function public.task_reminders_assign_actor()
returns trigger
language plpgsql
as $$
declare
  actor_id text := nullif(public.hmj_task_current_user_id(), '');
  actor_email text := nullif(public.hmj_task_current_user_email(), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(new.created_by, ''), actor_id, actor_email);
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email);
    new.created_at := coalesce(new.created_at, now());
  end if;

  new.updated_by := coalesce(actor_id, actor_email);
  new.updated_by_email := actor_email;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.log_task_audit(
  p_task_id uuid,
  p_action_type text,
  p_old_data jsonb default '{}'::jsonb,
  p_new_data jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_source_action text default null,
  p_entity_type text default 'task',
  p_entity_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_audit_log (
    task_id,
    action_type,
    actor_user_id,
    actor_email,
    entity_type,
    entity_id,
    source_action,
    old_data,
    new_data,
    metadata
  )
  values (
    p_task_id,
    p_action_type,
    nullif(public.hmj_task_current_user_id(), ''),
    nullif(public.hmj_task_current_user_email(), ''),
    coalesce(nullif(p_entity_type, ''), 'task'),
    coalesce(nullif(p_entity_id, ''), case when p_task_id is null then null else p_task_id::text end),
    nullif(p_source_action, ''),
    coalesce(p_old_data, '{}'::jsonb),
    coalesce(p_new_data, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_task_audit(uuid, text, jsonb, jsonb, jsonb, text, text, text) from public;
grant execute on function public.log_task_audit(uuid, text, jsonb, jsonb, jsonb, text, text, text)
  to authenticated, service_role;

create or replace function public.hmj_task_audit_generic()
returns trigger
language plpgsql
as $$
declare
  task_ref uuid;
  entity_type text;
  entity_id text;
begin
  task_ref := coalesce(new.task_id, old.task_id, new.id, old.id);
  entity_type := case
    when TG_TABLE_NAME = 'task_items' then 'task'
    when TG_TABLE_NAME = 'task_comments' then 'comment'
    when TG_TABLE_NAME = 'task_watchers' then 'watcher'
    when TG_TABLE_NAME = 'task_reminders' then 'reminder'
    else TG_TABLE_NAME
  end;
  entity_id := coalesce(new.id::text, old.id::text);

  if tg_op = 'INSERT' then
    perform public.log_task_audit(
      task_ref,
      lower(entity_type || '_created'),
      '{}'::jsonb,
      to_jsonb(new),
      '{}'::jsonb,
      TG_TABLE_NAME || '.insert',
      entity_type,
      entity_id
    );
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_task_audit(
      task_ref,
      lower(entity_type || '_updated'),
      to_jsonb(old),
      to_jsonb(new),
      '{}'::jsonb,
      TG_TABLE_NAME || '.update',
      entity_type,
      entity_id
    );
    return new;
  else
    perform public.log_task_audit(
      task_ref,
      lower(entity_type || '_deleted'),
      to_jsonb(old),
      '{}'::jsonb,
      '{}'::jsonb,
      TG_TABLE_NAME || '.delete',
      entity_type,
      entity_id
    );
    return old;
  end if;
end;
$$;

create or replace function public.guard_task_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Task audit log is immutable.';
end;
$$;

drop trigger if exists trg_task_items_actor on public.task_items;
create trigger trg_task_items_actor
before insert or update on public.task_items
for each row
execute function public.task_items_assign_actor();

drop trigger if exists trg_task_comments_actor on public.task_comments;
create trigger trg_task_comments_actor
before insert or update on public.task_comments
for each row
execute function public.task_comments_assign_actor();

drop trigger if exists trg_task_watchers_actor on public.task_watchers;
create trigger trg_task_watchers_actor
before insert on public.task_watchers
for each row
execute function public.task_watchers_assign_actor();

drop trigger if exists trg_task_reminders_actor on public.task_reminders;
create trigger trg_task_reminders_actor
before insert or update on public.task_reminders
for each row
execute function public.task_reminders_assign_actor();

drop trigger if exists trg_task_items_audit on public.task_items;
create trigger trg_task_items_audit
after insert or update or delete on public.task_items
for each row
execute function public.hmj_task_audit_generic();

drop trigger if exists trg_task_comments_audit on public.task_comments;
create trigger trg_task_comments_audit
after insert or update or delete on public.task_comments
for each row
execute function public.hmj_task_audit_generic();

drop trigger if exists trg_task_watchers_audit on public.task_watchers;
create trigger trg_task_watchers_audit
after insert or update or delete on public.task_watchers
for each row
execute function public.hmj_task_audit_generic();

drop trigger if exists trg_task_reminders_audit on public.task_reminders;
create trigger trg_task_reminders_audit
after insert or update or delete on public.task_reminders
for each row
execute function public.hmj_task_audit_generic();

drop trigger if exists trg_guard_task_audit_log_mutation on public.task_audit_log;
create trigger trg_guard_task_audit_log_mutation
before update or delete on public.task_audit_log
for each row
execute function public.guard_task_audit_log_mutation();

alter table public.task_items enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_watchers enable row level security;
alter table public.task_reminders enable row level security;
alter table public.task_audit_log enable row level security;

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

create or replace view public.task_items_view as
select
  task.*,
  case
    when task.status in ('done', 'archived') then false
    when task.due_at is null then false
    when task.due_at < now() then true
    else false
  end as is_overdue,
  case
    when task.status in ('done', 'archived') then false
    when task.due_at is null then false
    when task.due_at >= now() and task.due_at < now() + interval '1 day' then true
    else false
  end as is_due_today,
  case
    when task.status in ('done', 'archived') then false
    when task.due_at is null then false
    when task.due_at >= now() + interval '1 day'
      and task.due_at < now() + interval '3 day' then true
    else false
  end as is_due_soon
from public.task_items as task;

grant select on public.task_items_view to authenticated;
grant select on public.task_items_view to service_role;

create or replace function public.get_task_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'open_total', count(*) filter (where status in ('open', 'in_progress', 'waiting') and archived_at is null),
    'due_today', count(*) filter (
      where status not in ('done', 'archived')
        and due_at is not null
        and due_at >= now()
        and due_at < now() + interval '1 day'
    ),
    'overdue', count(*) filter (
      where status not in ('done', 'archived')
        and due_at is not null
        and due_at < now()
    ),
    'done_total', count(*) filter (where status = 'done')
  )
  from public.task_items;
$$;

revoke all on function public.get_task_summary() from public;
grant execute on function public.get_task_summary() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Security posture for server-side-only support objects
-- -----------------------------------------------------------------------------

alter table public.admin_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.noticeboard_posts enable row level security;
alter table public.team_members enable row level security;
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
revoke all on public.noticeboard_posts from anon, authenticated;
revoke all on public.team_members from anon, authenticated;
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

grant all on public.admin_settings to service_role;
grant all on public.admin_users to service_role;
grant all on public.admin_audit_logs to service_role;
grant all on public.noticeboard_posts to service_role;
grant all on public.team_members to service_role;
grant all on public.short_links to service_role;
grant all on public.job_specs to service_role;
grant all on public.candidate_match_runs to service_role;
grant all on public.candidate_match_files to service_role;
grant all on public.chatbot_conversations to service_role;
grant all on public.chatbot_messages to service_role;
grant all on public.chatbot_events to service_role;
grant all on public.analytics_events to service_role;
grant select on public.analytics_session_rollups to service_role;
grant select on public.analytics_page_daily to service_role;
grant select on public.analytics_listing_daily to service_role;

drop policy if exists "analytics_no_direct_client_access" on public.analytics_events;

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
  ),
  (
    'team_tasks_settings',
    jsonb_build_object(
      'dueSoonDays', 3,
      'collapseDoneByDefault', true,
      'reminderRecipientMode', 'assignee_creator_watchers',
      'defaultPriority', 'medium'
    )
  )
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Validation queries
-- -----------------------------------------------------------------------------

-- Required tables and views
select
  'required_relation' as check_type,
  required.name as object_name,
  required.object_type,
  to_regclass(required.regclass_name) is not null as exists_now
from (
  values
    ('admin_settings', 'table', 'public.admin_settings'),
    ('admin_users', 'table', 'public.admin_users'),
    ('admin_audit_logs', 'table', 'public.admin_audit_logs'),
    ('candidate_documents', 'table', 'public.candidate_documents'),
    ('noticeboard_posts', 'table', 'public.noticeboard_posts'),
    ('team_members', 'table', 'public.team_members'),
    ('short_links', 'table', 'public.short_links'),
    ('job_specs', 'table', 'public.job_specs'),
    ('candidate_skills', 'table', 'public.candidate_skills'),
    ('job_applications', 'table', 'public.job_applications'),
    ('candidate_activity', 'table', 'public.candidate_activity'),
    ('candidate_match_runs', 'table', 'public.candidate_match_runs'),
    ('candidate_match_files', 'table', 'public.candidate_match_files'),
    ('chatbot_conversations', 'table', 'public.chatbot_conversations'),
    ('chatbot_messages', 'table', 'public.chatbot_messages'),
    ('chatbot_events', 'table', 'public.chatbot_events'),
    ('analytics_events', 'table', 'public.analytics_events'),
    ('task_items', 'table', 'public.task_items'),
    ('task_comments', 'table', 'public.task_comments'),
    ('task_watchers', 'table', 'public.task_watchers'),
    ('task_reminders', 'table', 'public.task_reminders'),
    ('task_audit_log', 'table', 'public.task_audit_log'),
    ('audit_log', 'view', 'public.audit_log'),
    ('analytics_session_rollups', 'view', 'public.analytics_session_rollups'),
    ('analytics_page_daily', 'view', 'public.analytics_page_daily'),
    ('analytics_listing_daily', 'view', 'public.analytics_listing_daily'),
    ('task_items_view', 'view', 'public.task_items_view')
) as required(name, object_type, regclass_name)
order by required.object_type, required.name;

-- Key columns that the repo depends on heavily
select
  'required_column' as check_type,
  expected.table_name,
  expected.column_name,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.table_name
      and c.column_name = expected.column_name
  ) as exists_now
from (
  values
    ('jobs', 'public_page_config'),
    ('jobs', 'client_name'),
    ('jobs', 'benefits'),
    ('candidates', 'auth_user_id'),
    ('candidates', 'full_name'),
    ('candidates', 'headline_role'),
    ('candidates', 'sector_focus'),
    ('candidates', 'summary'),
    ('candidates', 'portal_account_closed_at'),
    ('candidate_documents', 'document_type'),
    ('candidate_documents', 'owner_auth_user_id'),
    ('candidate_documents', 'storage_bucket'),
    ('candidate_documents', 'storage_path'),
    ('candidate_documents', 'uploaded_at'),
    ('candidate_documents', 'deleted_at'),
    ('job_applications', 'share_code'),
    ('job_applications', 'source_submission_id'),
    ('candidate_activity', 'actor_role'),
    ('candidate_activity', 'meta'),
    ('team_members', 'slug'),
    ('team_members', 'is_published'),
    ('noticeboard_posts', 'publish_at'),
    ('noticeboard_posts', 'featured'),
    ('task_items', 'linked_module'),
    ('task_items', 'linked_url'),
    ('task_items', 'tags'),
    ('task_comments', 'created_by_email'),
    ('task_reminders', 'recipient_user_id'),
    ('task_reminders', 'reminder_mode'),
    ('task_audit_log', 'entity_type'),
    ('task_audit_log', 'source_action'),
    ('analytics_events', 'event_id'),
    ('analytics_events', 'page_visit_id'),
    ('analytics_events', 'payload'),
    ('analytics_events', 'meta')
) as expected(table_name, column_name)
order by expected.table_name, expected.column_name;

-- Policies that should now exist
select
  'required_policy' as check_type,
  expected.schemaname,
  expected.tablename,
  expected.policyname,
  exists (
    select 1
    from pg_policies p
    where p.schemaname = expected.schemaname
      and p.tablename = expected.tablename
      and p.policyname = expected.policyname
  ) as exists_now
from (
  values
    ('public', 'candidate_skills', 'candidate skills self select'),
    ('public', 'candidate_skills', 'candidate skills self insert'),
    ('public', 'candidate_skills', 'candidate skills self delete'),
    ('public', 'job_applications', 'candidate apps self select'),
    ('public', 'candidate_activity', 'candidate activity self select'),
    ('public', 'candidate_activity', 'candidate activity self insert'),
    ('public', 'candidate_documents', 'candidate docs self select'),
    ('public', 'candidate_documents', 'candidate docs self insert'),
    ('public', 'candidate_documents', 'candidate docs self delete'),
    ('storage', 'objects', 'candidate portal storage select'),
    ('storage', 'objects', 'candidate portal storage insert'),
    ('storage', 'objects', 'candidate portal storage update'),
    ('storage', 'objects', 'candidate portal storage delete'),
    ('storage', 'objects', 'Team images are publicly readable'),
    ('storage', 'objects', 'Noticeboard images are publicly readable'),
    ('public', 'task_items', 'task_items_select_admins'),
    ('public', 'task_items', 'task_items_insert_admins'),
    ('public', 'task_items', 'task_items_update_admins'),
    ('public', 'task_items', 'task_items_delete_creator_only'),
    ('public', 'task_comments', 'task_comments_select_admins'),
    ('public', 'task_comments', 'task_comments_insert_admins'),
    ('public', 'task_comments', 'task_comments_update_author_only'),
    ('public', 'task_watchers', 'task_watchers_select_admins'),
    ('public', 'task_watchers', 'task_watchers_insert_admins'),
    ('public', 'task_watchers', 'task_watchers_update_admins'),
    ('public', 'task_watchers', 'task_watchers_delete_admins_or_self'),
    ('public', 'task_reminders', 'task_reminders_select_admins'),
    ('public', 'task_reminders', 'task_reminders_insert_admins'),
    ('public', 'task_reminders', 'task_reminders_update_admins'),
    ('public', 'task_reminders', 'task_reminders_delete_admins'),
    ('public', 'task_audit_log', 'task_audit_log_select_admins')
) as expected(schemaname, tablename, policyname)
order by expected.schemaname, expected.tablename, expected.policyname;

-- Functions relied on by runtime or reconciliation
select
  'required_function' as check_type,
  expected.function_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = expected.function_name
  ) as exists_now
from (
  values
    ('set_row_updated_at'),
    ('hmj_touch_updated_at'),
    ('team_member_slugify'),
    ('audit_log_view_insert_bridge'),
    ('audit_log_table_sync_bridge'),
    ('hmj_candidate_has_auth_user'),
    ('analytics_extract_path'),
    ('analytics_extract_referrer_domain'),
    ('analytics_numeric_or_null'),
    ('analytics_integer_or_null'),
    ('analytics_events_sync_compat'),
    ('hmj_task_current_user_id'),
    ('hmj_task_current_user_email'),
    ('hmj_task_current_roles'),
    ('hmj_task_is_admin'),
    ('hmj_task_is_creator'),
    ('log_task_audit'),
    ('get_task_summary')
) as expected(function_name)
order by expected.function_name;

-- Storage buckets
select
  'required_bucket' as check_type,
  bucket_id,
  exists (
    select 1
    from storage.buckets b
    where b.id = bucket_id
  ) as exists_now
from (
  values
    ('candidate-docs'),
    ('noticeboard-images'),
    ('team-images'),
    ('candidate-matcher-uploads')
) as required(bucket_id)
order by bucket_id;

-- Manual-action markers for legacy core CRM objects.
select
  'MANUAL ACTION REQUIRED' as status,
  relation_name,
  case
    when to_regclass(regclass_name) is null then 'missing'
    else 'present_check_shape_manually'
  end as current_state,
  reason
from (
  values
    ('clients', 'public.clients', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('contractors', 'public.contractors', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('assignments', 'public.assignments', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('projects', 'public.projects', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('sites', 'public.sites', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('timesheets', 'public.timesheets', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('timesheet_entries', 'public.timesheet_entries', 'Older CRM base table not authoritatively bootstrapped in repo SQL.'),
    ('v_timesheets_admin', 'public.v_timesheets_admin', 'Legacy reporting view required by admin timesheets export/remind flows.'),
    ('upsert_timesheet_entry', 'public.upsert_timesheet_entry', 'Legacy RPC required by contractor/admin timesheet save flows.')
) as manual(relation_name, regclass_name, reason)
order by relation_name;
