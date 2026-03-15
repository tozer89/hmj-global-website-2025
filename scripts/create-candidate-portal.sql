-- HMJ candidate portal hardening migration
--
-- Canonical candidate portal model:
--   candidates           -> one row per candidate profile
--   candidate_skills     -> normalised skill tags for filtering
--   job_applications     -> one application per candidate + job
--   candidate_documents  -> storage-backed candidate files
--   candidate_activity   -> append-only audit/activity log
--
-- RLS model:
--   1. Candidates authenticate with Supabase Auth.
--   2. A candidate row is linked by candidates.auth_user_id = auth.uid().
--   3. Candidate profile reads/updates are allowed only when auth.uid() matches
--      the linked candidates.auth_user_id row.
--   4. Skills, applications, documents, and activity are all authorised by
--      joining back to the linked candidates row.
--   5. Storage access is limited to candidate-docs objects inside
--      portal/<auth.uid()>/...
--   6. Serverless functions use the service role for the small set of elevated
--      operations that must bypass RLS safely:
--      - linking auth users to pre-existing candidate rows
--      - background form sync
--      - safe account closure

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create or replace function public.hmj_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

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

create table if not exists public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  skill text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.candidate_activity (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  activity_type text not null,
  description text,
  actor_role text not null default 'candidate',
  actor_identifier text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
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

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
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
  end if;
end
$$;

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
  add column if not exists auth_user_id uuid;
alter table if exists public.candidates
  add column if not exists full_name text;
alter table if exists public.candidates
  add column if not exists sector_focus text;
alter table if exists public.candidates
  add column if not exists skills text[] not null default '{}'::text[];
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

alter table public.candidates
  alter column created_at set default now();
alter table public.candidates
  alter column updated_at set default now();
alter table public.candidates
  alter column created_at set not null;
alter table public.candidates
  alter column updated_at set not null;
alter table public.candidates
  alter column skills set default '{}'::text[];
alter table public.candidates
  alter column skills set not null;
alter table public.candidates
  alter column right_to_work_regions set default '{}'::text[];
alter table public.candidates
  alter column right_to_work_regions set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_skills'
      and column_name = 'candidate_id'
      and udt_name <> 'uuid'
  ) then
    execute $sql$
      delete from public.candidate_skills
      where candidate_id is not null
        and candidate_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $sql$;
    execute $sql$
      alter table public.candidate_skills
      alter column candidate_id
      type uuid
      using case
        when candidate_id is null then null
        when candidate_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then candidate_id::text::uuid
        else null
      end
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_applications'
      and column_name = 'candidate_id'
      and udt_name <> 'uuid'
  ) then
    execute $sql$
      delete from public.job_applications
      where candidate_id is not null
        and candidate_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $sql$;
    execute $sql$
      alter table public.job_applications
      alter column candidate_id
      type uuid
      using case
        when candidate_id is null then null
        when candidate_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then candidate_id::text::uuid
        else null
      end
    $sql$;
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

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_activity'
      and column_name = 'candidate_id'
      and udt_name <> 'uuid'
  ) then
    execute $sql$
      delete from public.candidate_activity
      where candidate_id is not null
        and candidate_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $sql$;
    execute $sql$
      alter table public.candidate_activity
      alter column candidate_id
      type uuid
      using case
        when candidate_id is null then null
        when candidate_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then candidate_id::text::uuid
        else null
      end
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_activity'
      and column_name = 'created_at'
      and data_type = 'timestamp without time zone'
  ) then
    execute 'alter table public.candidate_activity alter column created_at type timestamptz using created_at at time zone ''utc''';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_documents'
      and column_name = 'candidate_id'
      and udt_name <> 'uuid'
  ) then
    execute $sql$
      delete from public.candidate_documents
      where candidate_id is not null
        and candidate_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $sql$;
    execute $sql$
      alter table public.candidate_documents
      alter column candidate_id
      type uuid
      using case
        when candidate_id is null then null
        when candidate_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then candidate_id::text::uuid
        else null
      end
    $sql$;
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
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.job_applications
  add column if not exists updated_at timestamptz not null default now();

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

alter table public.job_applications
  alter column candidate_id set not null;
alter table public.job_applications
  alter column job_id set not null;
alter table public.job_applications
  alter column applied_at set default now();
alter table public.job_applications
  alter column applied_at set not null;
alter table public.job_applications
  alter column source set default 'candidate_portal';
alter table public.job_applications
  alter column source set not null;
alter table public.job_applications
  alter column created_at set default now();
alter table public.job_applications
  alter column created_at set not null;
alter table public.job_applications
  alter column updated_at set default now();
alter table public.job_applications
  alter column updated_at set not null;

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
  meta = coalesce(meta, '{}'::jsonb),
  created_at = coalesce(created_at, now())
where true;

alter table public.candidate_activity
  alter column candidate_id set not null;
alter table public.candidate_activity
  alter column activity_type set not null;
alter table public.candidate_activity
  alter column created_at set default now();
alter table public.candidate_activity
  alter column created_at set not null;

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
  add column if not exists uploaded_at timestamptz;
alter table if exists public.candidate_documents
  add column if not exists is_primary boolean not null default false;
alter table if exists public.candidate_documents
  add column if not exists meta jsonb not null default '{}'::jsonb;
alter table if exists public.candidate_documents
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.candidate_documents
  add column if not exists updated_at timestamptz not null default now();
alter table if exists public.candidate_documents
  add column if not exists deleted_at timestamptz;
alter table if exists public.candidate_documents
  add column if not exists storage_key text;
alter table if exists public.candidate_documents
  add column if not exists url text;

update public.candidate_documents
set
  document_type = case
    when lower(trim(coalesce(document_type, ''))) in ('cv', 'cover_letter', 'certificate', 'right_to_work', 'other')
      then lower(trim(document_type))
    when lower(trim(coalesce(document_type, ''))) in ('right to work') then 'right_to_work'
    when lower(trim(coalesce(document_type, ''))) in ('certification') then 'certificate'
    when lower(trim(coalesce(document_type, ''))) in ('document') then 'other'
    else 'other'
  end,
  label = nullif(trim(label), ''),
  filename = coalesce(nullif(trim(filename), ''), nullif(trim(original_filename), '')),
  original_filename = coalesce(nullif(trim(original_filename), ''), nullif(trim(filename), ''), 'candidate-document'),
  storage_bucket = coalesce(nullif(trim(storage_bucket), ''), 'candidate-docs'),
  storage_path = coalesce(nullif(trim(storage_path), ''), nullif(trim(storage_key), ''), concat('legacy/', id::text)),
  storage_key = coalesce(nullif(trim(storage_key), ''), nullif(trim(storage_path), ''), concat('legacy/', id::text)),
  file_extension = coalesce(
    nullif(trim(file_extension), ''),
    nullif(lower(regexp_replace(coalesce(original_filename, filename, ''), '^.*(\.[^.]+)$', '\1')), '')
  ),
  meta = coalesce(meta, '{}'::jsonb),
  uploaded_at = coalesce(uploaded_at, created_at, now()),
  created_at = coalesce(created_at, uploaded_at, now()),
  updated_at = coalesce(updated_at, uploaded_at, created_at, now())
where true;

alter table public.candidate_documents
  alter column candidate_id set not null;
alter table public.candidate_documents
  alter column document_type set default 'other';
alter table public.candidate_documents
  alter column document_type set not null;
alter table public.candidate_documents
  alter column original_filename set not null;
alter table public.candidate_documents
  alter column storage_bucket set default 'candidate-docs';
alter table public.candidate_documents
  alter column storage_bucket set not null;
alter table public.candidate_documents
  alter column storage_path set not null;
alter table public.candidate_documents
  alter column uploaded_at set default now();
alter table public.candidate_documents
  alter column uploaded_at set not null;
alter table public.candidate_documents
  alter column meta set default '{}'::jsonb;
alter table public.candidate_documents
  alter column meta set not null;
alter table public.candidate_documents
  alter column created_at set default now();
alter table public.candidate_documents
  alter column created_at set not null;
alter table public.candidate_documents
  alter column updated_at set default now();
alter table public.candidate_documents
  alter column updated_at set not null;

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

create or replace function public.merge_candidate_records(keep_id uuid, drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_row public.candidates%rowtype;
  drop_row public.candidates%rowtype;
begin
  if keep_id is null or drop_id is null or keep_id = drop_id then
    return;
  end if;

  select * into keep_row from public.candidates where id = keep_id;
  select * into drop_row from public.candidates where id = drop_id;

  if keep_row.id is null or drop_row.id is null then
    return;
  end if;

  update public.candidates
  set
    auth_user_id = coalesce(keep_row.auth_user_id, drop_row.auth_user_id),
    ref = coalesce(nullif(keep_row.ref, ''), nullif(drop_row.ref, '')),
    first_name = coalesce(nullif(keep_row.first_name, ''), nullif(drop_row.first_name, '')),
    last_name = coalesce(nullif(keep_row.last_name, ''), nullif(drop_row.last_name, '')),
    full_name = coalesce(
      nullif(keep_row.full_name, ''),
      nullif(drop_row.full_name, ''),
      nullif(trim(concat_ws(' ', keep_row.first_name, keep_row.last_name)), ''),
      nullif(trim(concat_ws(' ', drop_row.first_name, drop_row.last_name)), '')
    ),
    email = coalesce(nullif(keep_row.email, ''), nullif(drop_row.email, '')),
    phone = coalesce(nullif(keep_row.phone, ''), nullif(drop_row.phone, '')),
    address1 = coalesce(nullif(keep_row.address1, ''), nullif(drop_row.address1, '')),
    address2 = coalesce(nullif(keep_row.address2, ''), nullif(drop_row.address2, '')),
    town = coalesce(nullif(keep_row.town, ''), nullif(drop_row.town, '')),
    county = coalesce(nullif(keep_row.county, ''), nullif(drop_row.county, '')),
    postcode = coalesce(nullif(keep_row.postcode, ''), nullif(drop_row.postcode, '')),
    location = coalesce(nullif(keep_row.location, ''), nullif(drop_row.location, '')),
    country = coalesce(nullif(keep_row.country, ''), nullif(drop_row.country, '')),
    nationality = coalesce(nullif(keep_row.nationality, ''), nullif(drop_row.nationality, '')),
    right_to_work_status = coalesce(nullif(keep_row.right_to_work_status, ''), nullif(drop_row.right_to_work_status, '')),
    right_to_work_regions = (
      select coalesce(array_agg(distinct region order by region), '{}'::text[])
      from unnest(coalesce(keep_row.right_to_work_regions, '{}'::text[]) || coalesce(drop_row.right_to_work_regions, '{}'::text[])) as region
      where nullif(trim(region), '') is not null
    ),
    primary_specialism = coalesce(nullif(keep_row.primary_specialism, ''), nullif(drop_row.primary_specialism, '')),
    secondary_specialism = coalesce(nullif(keep_row.secondary_specialism, ''), nullif(drop_row.secondary_specialism, '')),
    current_job_title = coalesce(nullif(keep_row.current_job_title, ''), nullif(drop_row.current_job_title, '')),
    desired_roles = coalesce(nullif(keep_row.desired_roles, ''), nullif(drop_row.desired_roles, '')),
    qualifications = coalesce(nullif(keep_row.qualifications, ''), nullif(drop_row.qualifications, '')),
    sector_experience = coalesce(nullif(keep_row.sector_experience, ''), nullif(drop_row.sector_experience, '')),
    relocation_preference = coalesce(nullif(keep_row.relocation_preference, ''), nullif(drop_row.relocation_preference, '')),
    salary_expectation = coalesce(nullif(keep_row.salary_expectation, ''), nullif(drop_row.salary_expectation, '')),
    headline_role = coalesce(nullif(keep_row.headline_role, ''), nullif(drop_row.headline_role, '')),
    experience_years = coalesce(keep_row.experience_years, drop_row.experience_years),
    sector_focus = coalesce(nullif(keep_row.sector_focus, ''), nullif(drop_row.sector_focus, '')),
    summary = coalesce(nullif(keep_row.summary, ''), nullif(drop_row.summary, '')),
    linkedin_url = coalesce(nullif(keep_row.linkedin_url, ''), nullif(drop_row.linkedin_url, '')),
    cv_url = coalesce(nullif(keep_row.cv_url, ''), nullif(drop_row.cv_url, '')),
    availability_date = coalesce(keep_row.availability_date, drop_row.availability_date),
    availability = coalesce(nullif(keep_row.availability, ''), nullif(drop_row.availability, '')),
    status = case
      when coalesce(nullif(keep_row.status, ''), 'active') = 'archived'
        and coalesce(nullif(drop_row.status, ''), 'active') <> 'archived'
        then coalesce(nullif(drop_row.status, ''), 'active')
      else coalesce(nullif(keep_row.status, ''), nullif(drop_row.status, ''), 'active')
    end,
    skills = (
      select coalesce(array_agg(distinct skill order by skill), '{}'::text[])
      from unnest(coalesce(keep_row.skills, '{}'::text[]) || coalesce(drop_row.skills, '{}'::text[])) as skill
      where nullif(trim(skill), '') is not null
    ),
    created_at = least(coalesce(keep_row.created_at, now()), coalesce(drop_row.created_at, now())),
    updated_at = greatest(coalesce(keep_row.updated_at, now()), coalesce(drop_row.updated_at, now()))
  where id = keep_id;

  update public.candidate_skills
  set candidate_id = keep_id
  where candidate_id = drop_id;

  update public.job_applications
  set candidate_id = keep_id
  where candidate_id = drop_id;

  update public.candidate_activity
  set candidate_id = keep_id
  where candidate_id = drop_id;

  update public.candidate_documents
  set candidate_id = keep_id
  where candidate_id = drop_id;

  delete from public.candidates where id = drop_id;
end
$$;

do $$
declare
  rec record;
begin
  for rec in
    with ranked as (
      select
        id as drop_id,
        first_value(id) over (
          partition by auth_user_id
          order by updated_at desc nulls last, created_at desc nulls last, id
        ) as keep_id
      from public.candidates
      where auth_user_id is not null
    )
    select distinct keep_id, drop_id
    from ranked
    where drop_id <> keep_id
  loop
    perform public.merge_candidate_records(rec.keep_id, rec.drop_id);
  end loop;

  for rec in
    with ranked as (
      select
        id as drop_id,
        first_value(id) over (
          partition by lower(email)
          order by (auth_user_id is not null) desc, updated_at desc nulls last, created_at desc nulls last, id
        ) as keep_id
      from public.candidates
      where email is not null and trim(email) <> ''
    )
    select distinct keep_id, drop_id
    from ranked
    where drop_id <> keep_id
  loop
    perform public.merge_candidate_records(rec.keep_id, rec.drop_id);
  end loop;
end
$$;

do $$
declare
  rec record;
begin
  for rec in
    with ranked as (
      select
        id as drop_id,
        first_value(id) over (
          partition by candidate_id, job_id
          order by updated_at desc nulls last, applied_at desc nulls last, id
        ) as keep_id
      from public.job_applications
      where candidate_id is not null
        and job_id is not null
    )
    select distinct keep_id, drop_id
    from ranked
    where drop_id <> keep_id
  loop
    delete from public.job_applications where id = rec.drop_id;
  end loop;
end
$$;

create unique index if not exists candidates_auth_user_id_uidx
  on public.candidates (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists candidates_email_uidx
  on public.candidates (lower(email))
  where email is not null and trim(email) <> '';

create index if not exists candidates_email_idx
  on public.candidates (lower(email));

create index if not exists candidates_status_updated_idx
  on public.candidates (status, updated_at desc);

create unique index if not exists candidate_skills_candidate_skill_uidx
  on public.candidate_skills (candidate_id, lower(skill));

create index if not exists candidate_skills_candidate_idx
  on public.candidate_skills (candidate_id, created_at desc);

create unique index if not exists job_applications_candidate_job_uidx
  on public.job_applications (candidate_id, job_id);

create index if not exists job_applications_candidate_idx
  on public.job_applications (candidate_id, applied_at desc);

create index if not exists job_applications_job_idx
  on public.job_applications (job_id, applied_at desc);

create index if not exists job_applications_status_idx
  on public.job_applications (status, applied_at desc);

create index if not exists job_applications_source_submission_idx
  on public.job_applications (source_submission_id)
  where source_submission_id is not null;

create index if not exists candidate_activity_candidate_idx
  on public.candidate_activity (candidate_id, created_at desc);

create index if not exists candidate_activity_type_idx
  on public.candidate_activity (activity_type, created_at desc);

create unique index if not exists candidate_documents_storage_uidx
  on public.candidate_documents (storage_bucket, storage_path);

create index if not exists candidate_documents_candidate_idx
  on public.candidate_documents (candidate_id, uploaded_at desc);

create index if not exists candidate_documents_owner_idx
  on public.candidate_documents (owner_auth_user_id, uploaded_at desc);

create index if not exists candidate_documents_uploaded_idx
  on public.candidate_documents (uploaded_at desc);

create index if not exists candidate_documents_type_idx
  on public.candidate_documents (document_type, uploaded_at desc);

drop trigger if exists candidates_touch_updated_at on public.candidates;
create trigger candidates_touch_updated_at
  before update on public.candidates
  for each row
  execute function public.hmj_touch_updated_at();

drop trigger if exists job_applications_touch_updated_at on public.job_applications;
create trigger job_applications_touch_updated_at
  before update on public.job_applications
  for each row
  execute function public.hmj_touch_updated_at();

drop trigger if exists candidate_documents_touch_updated_at on public.candidate_documents;
create trigger candidate_documents_touch_updated_at
  before update on public.candidate_documents
  for each row
  execute function public.hmj_touch_updated_at();

create or replace function public.ensure_candidate_profile_from_auth(
  auth_user uuid,
  auth_email text,
  auth_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_candidate_id uuid;
  clean_email text;
  meta_first_name text;
  meta_last_name text;
  meta_full_name text;
begin
  if auth_user is null then
    return null;
  end if;

  clean_email := lower(nullif(trim(auth_email), ''));
  meta_first_name := nullif(trim(auth_meta ->> 'first_name'), '');
  meta_last_name := nullif(trim(auth_meta ->> 'last_name'), '');
  meta_full_name := coalesce(
    nullif(trim(auth_meta ->> 'full_name'), ''),
    nullif(trim(concat_ws(' ', meta_first_name, meta_last_name)), '')
  );

  select id
    into target_candidate_id
  from public.candidates
  where auth_user_id = auth_user
  limit 1;

  if target_candidate_id is null and clean_email is not null then
    select id
      into target_candidate_id
    from public.candidates
    where lower(email) = clean_email
      and (auth_user_id is null or auth_user_id = auth_user)
    order by updated_at desc nulls last, created_at desc nulls last
    limit 1;
  end if;

  if target_candidate_id is null then
    insert into public.candidates (
      auth_user_id,
      email,
      first_name,
      last_name,
      full_name,
      status,
      created_at,
      updated_at
    )
    values (
      auth_user,
      clean_email,
      meta_first_name,
      meta_last_name,
      meta_full_name,
      'active',
      now(),
      now()
    )
    returning id into target_candidate_id;

    insert into public.candidate_activity (
      candidate_id,
      activity_type,
      description,
      actor_role,
      actor_identifier,
      meta
    )
    values (
      target_candidate_id,
      'profile_created',
      'Candidate profile created from candidate auth signup.',
      'system',
      auth_user::text,
      jsonb_build_object('source', 'auth_trigger')
    );

    return target_candidate_id;
  end if;

  update public.candidates
  set
    auth_user_id = auth_user,
    email = coalesce(clean_email, email),
    first_name = coalesce(first_name, meta_first_name),
    last_name = coalesce(last_name, meta_last_name),
    full_name = coalesce(full_name, meta_full_name),
    status = coalesce(nullif(status, ''), 'active'),
    updated_at = now()
  where id = target_candidate_id;

  return target_candidate_id;
end
$$;

create or replace function public.handle_candidate_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_candidate_profile_from_auth(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );
  return new;
end
$$;

drop trigger if exists on_auth_user_created_candidate_portal on auth.users;
create trigger on_auth_user_created_candidate_portal
  after insert or update of email, raw_user_meta_data on auth.users
  for each row
  execute function public.handle_candidate_auth_user();

alter table public.candidates enable row level security;
alter table public.candidate_skills enable row level security;
alter table public.job_applications enable row level security;
alter table public.candidate_activity enable row level security;
alter table public.candidate_documents enable row level security;

revoke all on public.candidates from anon;
revoke all on public.candidate_skills from anon;
revoke all on public.job_applications from anon;
revoke all on public.candidate_activity from anon;
revoke all on public.candidate_documents from anon;

drop policy if exists "candidate self select" on public.candidates;
create policy "candidate self select"
  on public.candidates
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists "candidate self insert" on public.candidates;
create policy "candidate self insert"
  on public.candidates
  for insert
  to authenticated
  with check (auth.uid() = auth_user_id);

drop policy if exists "candidate self update" on public.candidates;
create policy "candidate self update"
  on public.candidates
  for update
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

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
