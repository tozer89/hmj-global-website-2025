-- HMJ targeted patch: candidate document ownership + storage RLS
--
-- Use this on a live Supabase project that already has candidate portal tables
-- but is still rejecting candidate self-service uploads with row-level security
-- errors. It aligns the candidate_documents table and storage.objects policies
-- with the current portal upload path: candidate-docs / portal/<auth.uid()>/...

create extension if not exists pgcrypto;

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

update public.candidate_documents
set
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

alter table public.candidate_documents enable row level security;
revoke all on public.candidate_documents from anon;
grant select, insert, delete on public.candidate_documents to authenticated;

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

drop policy if exists "candidate portal storage select" on storage.objects;
create policy "candidate portal storage select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'candidate-docs'
    and split_part(name, '/', 1) = 'portal'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "candidate portal storage insert" on storage.objects;
create policy "candidate portal storage insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'candidate-docs'
    and split_part(name, '/', 1) = 'portal'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "candidate portal storage update" on storage.objects;
create policy "candidate portal storage update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'candidate-docs'
    and split_part(name, '/', 1) = 'portal'
    and split_part(name, '/', 2) = auth.uid()::text
  )
  with check (
    bucket_id = 'candidate-docs'
    and split_part(name, '/', 1) = 'portal'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "candidate portal storage delete" on storage.objects;
create policy "candidate portal storage delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'candidate-docs'
    and split_part(name, '/', 1) = 'portal'
    and split_part(name, '/', 2) = auth.uid()::text
  );
