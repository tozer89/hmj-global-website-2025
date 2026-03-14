-- HMJ Global Team / About Us module setup for Supabase
-- Safe to re-run. This script creates or upgrades the Team table, normalises
-- existing rows, wires updated_at automation, provisions image storage, and
-- seeds the current public About Us team members.

begin;

-- ---------------------------------------------------------------------------
-- Extensions and shared helper functions
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Core Team table
-- ---------------------------------------------------------------------------

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

alter table public.team_members add column if not exists id uuid;
alter table public.team_members add column if not exists created_at timestamptz default now();
alter table public.team_members add column if not exists updated_at timestamptz default now();
alter table public.team_members add column if not exists created_by text;
alter table public.team_members add column if not exists created_by_email text;
alter table public.team_members add column if not exists updated_by_email text;
alter table public.team_members add column if not exists full_name text default '';
alter table public.team_members add column if not exists slug text;
alter table public.team_members add column if not exists role_title text default '';
alter table public.team_members add column if not exists short_caption text default '';
alter table public.team_members add column if not exists full_bio text default '';
alter table public.team_members add column if not exists image_url text;
alter table public.team_members add column if not exists image_storage_key text;
alter table public.team_members add column if not exists image_alt_text text;
alter table public.team_members add column if not exists linkedin_url text;
alter table public.team_members add column if not exists email text;
alter table public.team_members add column if not exists display_order integer default 100;
alter table public.team_members add column if not exists is_published boolean default false;
alter table public.team_members add column if not exists published_at timestamptz;
alter table public.team_members add column if not exists archived_at timestamptz;

alter table public.team_members alter column id set default gen_random_uuid();
alter table public.team_members alter column created_at set default now();
alter table public.team_members alter column updated_at set default now();
alter table public.team_members alter column full_name set default '';
alter table public.team_members alter column role_title set default '';
alter table public.team_members alter column short_caption set default '';
alter table public.team_members alter column full_bio set default '';
alter table public.team_members alter column display_order set default 100;
alter table public.team_members alter column is_published set default false;

update public.team_members
set
  id = coalesce(id, gen_random_uuid()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now()),
  full_name = coalesce(full_name, ''),
  role_title = coalesce(role_title, ''),
  short_caption = coalesce(short_caption, ''),
  full_bio = coalesce(full_bio, ''),
  display_order = greatest(coalesce(display_order, 100), 0),
  is_published = case
    when archived_at is not null then false
    else coalesce(is_published, false)
  end
where id is null
   or created_at is null
   or updated_at is null
   or full_name is null
   or role_title is null
   or short_caption is null
   or full_bio is null
   or display_order is null
   or display_order < 0
   or is_published is null
   or (archived_at is not null and is_published is true);

update public.team_members
set is_published = false
where is_published is true
  and (
    length(btrim(full_name)) = 0
    or length(btrim(role_title)) = 0
    or length(btrim(short_caption)) = 0
  );

update public.team_members
set published_at = coalesce(published_at, updated_at, created_at, now())
where is_published is true
  and published_at is null;

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
    row_number() over (
      partition by base_slug
      order by created_at asc nulls first, id asc
    ) as slug_rank,
    base_slug
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
update public.team_members team_members
set slug = resolved.resolved_slug
from resolved
where team_members.id = resolved.id
  and coalesce(team_members.slug, '') <> resolved.resolved_slug;

alter table public.team_members alter column id set not null;
alter table public.team_members alter column created_at set not null;
alter table public.team_members alter column updated_at set not null;
alter table public.team_members alter column full_name set not null;
alter table public.team_members alter column slug set not null;
alter table public.team_members alter column role_title set not null;
alter table public.team_members alter column short_caption set not null;
alter table public.team_members alter column full_bio set not null;
alter table public.team_members alter column display_order set not null;
alter table public.team_members alter column is_published set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_members'::regclass
      and contype = 'p'
  ) then
    alter table public.team_members
      add constraint team_members_pkey primary key (id);
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

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_members'::regclass
      and conname = 'team_members_slug_format'
  ) then
    alter table public.team_members
      add constraint team_members_slug_format
      check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_members'::regclass
      and conname = 'team_members_archived_not_published'
  ) then
    alter table public.team_members
      add constraint team_members_archived_not_published
      check (not (archived_at is not null and is_published));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_members'::regclass
      and conname = 'team_members_publish_requires_content'
  ) then
    alter table public.team_members
      add constraint team_members_publish_requires_content
      check (
        not is_published
        or (
          length(btrim(full_name)) > 0
          and length(btrim(role_title)) > 0
          and length(btrim(short_caption)) > 0
        )
      );
  end if;
end
$$;

create unique index if not exists team_members_slug_uidx
  on public.team_members (slug);

create index if not exists team_members_admin_board_idx
  on public.team_members (archived_at asc nulls first, display_order asc, created_at asc, full_name asc);

create index if not exists team_members_public_order_idx
  on public.team_members (display_order asc, created_at asc, full_name asc)
  where is_published is true and archived_at is null;

create index if not exists team_members_updated_idx
  on public.team_members (updated_at desc);

comment on table public.team_members is
  'HMJ About page team members. Browser clients should not query this table directly; Netlify Functions handle public filtering and admin writes using the service role key.';

comment on column public.team_members.slug is
  'Unique public identifier used for stable team-card references.';

comment on column public.team_members.image_storage_key is
  'Supabase Storage object key inside the team-images bucket.';

comment on column public.team_members.published_at is
  'Timestamp of the most recent publish action used for admin metadata and ordering diagnostics.';

-- Lock the table down to server-side access. RLS stays enabled with no browser
-- policies so anon/authenticated clients cannot query or mutate team records.
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;
grant all on public.team_members to service_role;

-- ---------------------------------------------------------------------------
-- updated_at automation
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.team_members'::regclass
      and tgname = 'team_members_set_updated_at'
  ) then
    create trigger team_members_set_updated_at
      before update on public.team_members
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Supabase Storage bucket for Team portraits
-- ---------------------------------------------------------------------------

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

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Team images are publicly readable'
  ) then
    create policy "Team images are publicly readable"
      on storage.objects
      for select
      using (bucket_id = 'team-images');
  end if;
end
$$;

-- Team image writes are intentionally handled by Netlify Functions using the
-- service role key, so no direct browser upload/update/delete policies are
-- granted here.

-- ---------------------------------------------------------------------------
-- Seed the current live About Us cards so the public page stays populated
-- ---------------------------------------------------------------------------

insert into public.team_members (
  id,
  created_at,
  updated_at,
  full_name,
  slug,
  role_title,
  short_caption,
  full_bio,
  image_url,
  image_storage_key,
  image_alt_text,
  linkedin_url,
  display_order,
  is_published,
  published_at,
  archived_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '2025-01-10T09:00:00.000Z',
    '2025-01-10T09:00:00.000Z',
    'Nick Chamberlain',
    'nick-chamberlain',
    'Co-founder & Delivery Director',
    'Mobilises CSA and MEP contractors for live hyperscale builds, keeping safety and critical milestones in view.',
    'Specialises in mobilising CSA and MEP contractors inside live hyperscale builds, with a focus on safety briefings and programme-critical milestones.',
    '/images/director1.jpg',
    null,
    'Portrait of Nick Chamberlain',
    'https://www.linkedin.com/in/nchamberlain88/',
    10,
    true,
    '2025-01-10T09:00:00.000Z',
    null
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '2025-01-10T09:05:00.000Z',
    '2025-01-10T09:05:00.000Z',
    'Joe Tozer-O''Sullivan',
    'joe-tozer-osullivan',
    'Co-founder & Finance Partner',
    'Keeps commercial visibility, payroll compliance and contractor care aligned across every HMJ jurisdiction.',
    'Ensures commercial transparency and compliant payroll across all jurisdictions, aligning HMJ invoicing, insurance and contractor care.',
    '/images/director2.jpg',
    null,
    'Portrait of Joe Tozer-O''Sullivan',
    'https://www.linkedin.com/in/joe-t-4091542ba',
    20,
    true,
    '2025-01-10T09:05:00.000Z',
    null
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '2025-01-10T09:10:00.000Z',
    '2025-01-10T09:10:00.000Z',
    'Samira Patel',
    'samira-patel',
    'Head of Contractor Care',
    'Leads onboarding, wellbeing and weekly payroll operations so contractors stay supported from pre-start to completion.',
    'Leads onboarding, wellbeing and weekly payroll operations, making sure every contractor is supported from pre-start to project completion.',
    '/images/about-team.jpg',
    null,
    'Portrait of Samira Patel',
    'https://www.linkedin.com/company/hmj-global',
    30,
    true,
    '2025-01-10T09:10:00.000Z',
    null
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '2025-01-10T09:15:00.000Z',
    '2025-01-10T09:15:00.000Z',
    'Liam O''Connor',
    'liam-oconnor',
    'Technical Resourcing Lead',
    'Connects specialist commissioning, controls and HV talent with projects where uptime and safety are non-negotiable.',
    'Connects specialist commissioning, controls and HV talent with projects where uptime and safety standards are non-negotiable.',
    '/images/about-team.jpg',
    null,
    'Portrait of Liam O''Connor',
    'https://www.linkedin.com/company/hmj-global',
    40,
    true,
    '2025-01-10T09:15:00.000Z',
    null
  )
on conflict (id) do nothing;

commit;
