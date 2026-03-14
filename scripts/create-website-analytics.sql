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

alter table public.analytics_events enable row level security;

revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_session_rollups from anon, authenticated;
revoke all on public.analytics_page_daily from anon, authenticated;
revoke all on public.analytics_listing_daily from anon, authenticated;

drop policy if exists "analytics_no_direct_client_access" on public.analytics_events;

-- No insert/select policies are created on purpose:
-- writes should only happen through the Netlify analytics ingestion function
-- and admin reads should happen through service-role Netlify functions.
