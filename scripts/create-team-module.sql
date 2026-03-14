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

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  created_by_email text,
  updated_by_email text,
  full_name text not null default '',
  slug text not null unique,
  role_title text not null default '',
  short_caption text not null default '',
  full_bio text not null default '',
  image_url text,
  image_storage_key text,
  image_alt_text text,
  linkedin_url text,
  email text,
  display_order integer not null default 100 check (display_order >= 0),
  is_published boolean not null default false,
  archived_at timestamptz
);

alter table public.team_members add column if not exists created_at timestamptz not null default now();
alter table public.team_members add column if not exists updated_at timestamptz not null default now();
alter table public.team_members add column if not exists created_by text;
alter table public.team_members add column if not exists created_by_email text;
alter table public.team_members add column if not exists updated_by_email text;
alter table public.team_members add column if not exists full_name text not null default '';
alter table public.team_members add column if not exists slug text;
alter table public.team_members add column if not exists role_title text not null default '';
alter table public.team_members add column if not exists short_caption text not null default '';
alter table public.team_members add column if not exists full_bio text not null default '';
alter table public.team_members add column if not exists image_url text;
alter table public.team_members add column if not exists image_storage_key text;
alter table public.team_members add column if not exists image_alt_text text;
alter table public.team_members add column if not exists linkedin_url text;
alter table public.team_members add column if not exists email text;
alter table public.team_members add column if not exists display_order integer not null default 100;
alter table public.team_members add column if not exists is_published boolean not null default false;
alter table public.team_members add column if not exists archived_at timestamptz;

update public.team_members
set
  full_name = coalesce(full_name, ''),
  role_title = coalesce(role_title, ''),
  short_caption = coalesce(short_caption, ''),
  full_bio = coalesce(full_bio, ''),
  updated_at = coalesce(updated_at, now()),
  created_at = coalesce(created_at, now()),
  display_order = coalesce(display_order, 100),
  is_published = coalesce(is_published, false)
where full_name is null
  or role_title is null
  or short_caption is null
  or full_bio is null
  or updated_at is null
  or created_at is null
  or display_order is null
  or is_published is null;

alter table public.team_members
  alter column slug set not null;

create unique index if not exists team_members_slug_uidx
  on public.team_members (slug);

create index if not exists team_members_live_order_idx
  on public.team_members (is_published, archived_at, display_order asc, created_at asc);

create index if not exists team_members_archived_idx
  on public.team_members (archived_at desc);

alter table public.team_members enable row level security;

comment on table public.team_members is
  'HMJ About page team members. Browser clients should not query this table directly; Netlify Functions handle public filtering and admin writes.';

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'team_members_set_updated_at'
  ) then
    create trigger team_members_set_updated_at
      before update on public.team_members
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
  image_alt_text,
  linkedin_url,
  display_order,
  is_published
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
    'Portrait of Nick Chamberlain',
    'https://www.linkedin.com/in/nchamberlain88/',
    10,
    true
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
    'Portrait of Joe Tozer-O''Sullivan',
    'https://www.linkedin.com/in/joe-t-4091542ba',
    20,
    true
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
    'Portrait of Samira Patel',
    'https://www.linkedin.com/company/hmj-global',
    30,
    true
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
    'Portrait of Liam O''Connor',
    'https://www.linkedin.com/company/hmj-global',
    40,
    true
  )
on conflict (id) do nothing;
