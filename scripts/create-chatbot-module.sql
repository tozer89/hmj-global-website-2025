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

create table if not exists public.chatbot_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_route text,
  latest_route text,
  latest_page_title text,
  page_category text,
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

create index if not exists chatbot_conversations_updated_idx
  on public.chatbot_conversations (updated_at desc);

create index if not exists chatbot_conversations_route_idx
  on public.chatbot_conversations (latest_route);

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
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'chatbot_conversations_set_updated_at'
  ) then
    create trigger chatbot_conversations_set_updated_at
      before update on public.chatbot_conversations
      for each row
      execute function public.set_row_updated_at();
  end if;
end
$$;

alter table public.chatbot_conversations enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.chatbot_events enable row level security;

insert into public.admin_settings (key, value)
values (
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

comment on table public.chatbot_conversations is
  'Session-level records for the HMJ website chatbot. Written server-side by Netlify Functions and surfaced in the admin module.';

comment on table public.chatbot_messages is
  'Message-level transcript rows for the HMJ website chatbot. Stores both visitor and assistant messages for admin review.';

comment on table public.chatbot_events is
  'Lightweight event records for the HMJ website chatbot, used for opens, CTA interactions, routing signals, and fallback monitoring.';
