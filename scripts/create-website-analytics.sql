create extension if not exists pgcrypto;

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

comment on table public.analytics_events is
  'HMJ website analytics raw events. Privacy boundary: no form contents, CVs, passwords, or confidential payloads are stored here.';

comment on column public.analytics_events.ip_hash is
  'Salted one-way hash of the request IP when available. Raw IP addresses are intentionally not stored.';

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);

create index if not exists analytics_events_session_idx
  on public.analytics_events (session_id, occurred_at desc);

create index if not exists analytics_events_visitor_idx
  on public.analytics_events (visitor_id, occurred_at desc);

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

alter table public.analytics_events enable row level security;

revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_session_rollups from anon, authenticated;
revoke all on public.analytics_page_daily from anon, authenticated;

drop policy if exists "analytics_no_direct_client_access" on public.analytics_events;

-- No insert/select policies are created on purpose:
-- writes should only happen through the Netlify analytics ingestion function
-- and admin reads should happen through service-role Netlify functions.
