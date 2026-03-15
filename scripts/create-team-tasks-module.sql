create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum (
      'open',
      'in_progress',
      'waiting',
      'done',
      'archived'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum (
      'low',
      'medium',
      'high',
      'urgent'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'task_reminder_status') then
    create type public.task_reminder_status as enum (
      'pending',
      'processing',
      'sent',
      'failed',
      'cancelled'
    );
  end if;
end
$$;

alter type public.task_reminder_status add value if not exists 'processing';

create table if not exists public.task_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '',
  status public.task_status not null default 'open',
  priority public.task_priority not null default 'medium',
  created_by text not null,
  created_by_email text not null default '',
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

alter table public.task_items add column if not exists description text;
alter table public.task_items add column if not exists status public.task_status;
alter table public.task_items add column if not exists priority public.task_priority;
alter table public.task_items add column if not exists created_by text;
alter table public.task_items add column if not exists created_by_email text;
alter table public.task_items add column if not exists updated_by text;
alter table public.task_items add column if not exists updated_by_email text;
alter table public.task_items add column if not exists assigned_to text;
alter table public.task_items add column if not exists assigned_to_email text;
alter table public.task_items add column if not exists due_at timestamptz;
alter table public.task_items add column if not exists completed_at timestamptz;
alter table public.task_items add column if not exists archived_at timestamptz;
alter table public.task_items add column if not exists reminder_enabled boolean default false;
alter table public.task_items add column if not exists reminder_mode text;
alter table public.task_items add column if not exists reminder_custom_at timestamptz;
alter table public.task_items add column if not exists linked_module text;
alter table public.task_items add column if not exists linked_url text;
alter table public.task_items add column if not exists tags text[] default '{}'::text[];
alter table public.task_items add column if not exists sort_order integer default 0;
alter table public.task_items add column if not exists created_at timestamptz default now();
alter table public.task_items add column if not exists updated_at timestamptz default now();

alter table public.task_items drop constraint if exists task_items_created_by_fkey;
alter table public.task_items drop constraint if exists task_items_assigned_to_fkey;
alter table public.task_items drop constraint if exists task_items_reminder_mode_check;

alter table public.task_items
  alter column created_by type text using created_by::text;
alter table public.task_items
  alter column assigned_to type text using assigned_to::text;

alter table public.task_items
  alter column description set default '';
alter table public.task_items
  alter column status set default 'open';
alter table public.task_items
  alter column priority set default 'medium';
alter table public.task_items
  alter column created_at set default now();
alter table public.task_items
  alter column updated_at set default now();
alter table public.task_items
  alter column reminder_enabled set default false;
alter table public.task_items
  alter column sort_order set default 0;
alter table public.task_items
  alter column tags set default '{}'::text[];
alter table public.task_items
  alter column created_by_email set default '';

update public.task_items
set
  description = coalesce(description, ''),
  status = coalesce(status, 'open'::public.task_status),
  priority = coalesce(priority, 'medium'::public.task_priority),
  created_by = coalesce(nullif(created_by, ''), 'legacy-' || encode(gen_random_bytes(6), 'hex')),
  created_by_email = coalesce(created_by_email, ''),
  reminder_enabled = coalesce(reminder_enabled, false),
  sort_order = coalesce(sort_order, 0),
  tags = coalesce(tags, '{}'::text[]),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  description is null
  or status is null
  or priority is null
  or created_by is null
  or created_by = ''
  or created_by_email is null
  or reminder_enabled is null
  or sort_order is null
  or tags is null
  or created_at is null
  or updated_at is null;

alter table public.task_items
  alter column description set not null;
alter table public.task_items
  alter column created_by set not null;
alter table public.task_items
  alter column created_by_email set not null;
alter table public.task_items
  alter column created_at set not null;
alter table public.task_items
  alter column updated_at set not null;
alter table public.task_items
  alter column reminder_enabled set not null;
alter table public.task_items
  alter column sort_order set not null;
alter table public.task_items
  alter column tags set not null;

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
        or reminder_mode in ('none', 'due_date_9am', '1_day_before', '2_days_before', 'custom')
      );
  end if;
end
$$;

create index if not exists idx_task_items_status on public.task_items(status);
create index if not exists idx_task_items_due_at on public.task_items(due_at);
create index if not exists idx_task_items_created_by on public.task_items(created_by);
create index if not exists idx_task_items_created_by_email on public.task_items(lower(created_by_email));
create index if not exists idx_task_items_assigned_to on public.task_items(assigned_to);
create index if not exists idx_task_items_assigned_to_email on public.task_items(lower(assigned_to_email));
create index if not exists idx_task_items_archived_at on public.task_items(archived_at);
create index if not exists idx_task_items_updated_at on public.task_items(updated_at desc);

drop trigger if exists trg_task_items_updated_at on public.task_items;
create trigger trg_task_items_updated_at
before update on public.task_items
for each row
execute function public.set_updated_at();

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  comment_body text not null check (char_length(trim(comment_body)) between 1 and 5000),
  created_by text not null,
  created_by_email text not null default '',
  updated_by text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.task_comments add column if not exists created_by text;
alter table public.task_comments add column if not exists created_by_email text;
alter table public.task_comments add column if not exists updated_by text;
alter table public.task_comments add column if not exists updated_by_email text;
alter table public.task_comments add column if not exists created_at timestamptz default now();
alter table public.task_comments add column if not exists updated_at timestamptz default now();

alter table public.task_comments drop constraint if exists task_comments_created_by_fkey;

alter table public.task_comments
  alter column created_by type text using created_by::text;

alter table public.task_comments
  alter column created_at set default now();
alter table public.task_comments
  alter column updated_at set default now();
alter table public.task_comments
  alter column created_by_email set default '';

update public.task_comments
set
  created_by = coalesce(nullif(created_by, ''), 'legacy-' || encode(gen_random_bytes(6), 'hex')),
  created_by_email = coalesce(created_by_email, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  created_by is null
  or created_by = ''
  or created_by_email is null
  or created_at is null
  or updated_at is null;

alter table public.task_comments
  alter column created_by set not null;
alter table public.task_comments
  alter column created_by_email set not null;
alter table public.task_comments
  alter column created_at set not null;
alter table public.task_comments
  alter column updated_at set not null;

create index if not exists idx_task_comments_task_id on public.task_comments(task_id);
create index if not exists idx_task_comments_created_by on public.task_comments(created_by);
create index if not exists idx_task_comments_created_by_email on public.task_comments(lower(created_by_email));
create index if not exists idx_task_comments_created_at on public.task_comments(created_at);

drop trigger if exists trg_task_comments_updated_at on public.task_comments;
create trigger trg_task_comments_updated_at
before update on public.task_comments
for each row
execute function public.set_updated_at();

create table if not exists public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  user_id text not null,
  user_email text,
  created_by text,
  created_by_email text,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

alter table public.task_watchers add column if not exists user_id text;
alter table public.task_watchers add column if not exists user_email text;
alter table public.task_watchers add column if not exists created_by text;
alter table public.task_watchers add column if not exists created_by_email text;
alter table public.task_watchers add column if not exists created_at timestamptz default now();

alter table public.task_watchers drop constraint if exists task_watchers_user_id_fkey;

alter table public.task_watchers
  alter column user_id type text using user_id::text;

update public.task_watchers
set
  user_id = coalesce(nullif(user_id, ''), 'legacy-' || encode(gen_random_bytes(6), 'hex')),
  created_at = coalesce(created_at, now())
where user_id is null or user_id = '' or created_at is null;

alter table public.task_watchers
  alter column user_id set not null;
alter table public.task_watchers
  alter column created_at set not null;

create index if not exists idx_task_watchers_task_id on public.task_watchers(task_id);
create index if not exists idx_task_watchers_user_id on public.task_watchers(user_id);
create index if not exists idx_task_watchers_user_email on public.task_watchers(lower(user_email));

create table if not exists public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_items(id) on delete cascade,
  recipient_user_id text,
  recipient_email text,
  reminder_mode text not null default 'custom',
  send_at timestamptz not null,
  sent_at timestamptz,
  status public.task_reminder_status not null default 'pending',
  failure_reason text,
  created_by text,
  created_by_email text,
  updated_by text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_reminders_recipient_check
    check (recipient_user_id is not null or recipient_email is not null)
);

alter table public.task_reminders add column if not exists recipient_user_id text;
alter table public.task_reminders add column if not exists recipient_email text;
alter table public.task_reminders add column if not exists reminder_mode text default 'custom';
alter table public.task_reminders add column if not exists send_at timestamptz;
alter table public.task_reminders add column if not exists sent_at timestamptz;
alter table public.task_reminders add column if not exists status public.task_reminder_status default 'pending';
alter table public.task_reminders add column if not exists failure_reason text;
alter table public.task_reminders add column if not exists created_by text;
alter table public.task_reminders add column if not exists created_by_email text;
alter table public.task_reminders add column if not exists updated_by text;
alter table public.task_reminders add column if not exists updated_by_email text;
alter table public.task_reminders add column if not exists created_at timestamptz default now();
alter table public.task_reminders add column if not exists updated_at timestamptz default now();

alter table public.task_reminders drop constraint if exists task_reminders_recipient_user_id_fkey;

alter table public.task_reminders
  alter column recipient_user_id type text using recipient_user_id::text;

alter table public.task_reminders
  alter column reminder_mode set default 'custom';
alter table public.task_reminders
  alter column status set default 'pending';
alter table public.task_reminders
  alter column created_at set default now();
alter table public.task_reminders
  alter column updated_at set default now();

update public.task_reminders
set
  reminder_mode = coalesce(nullif(reminder_mode, ''), 'custom'),
  status = coalesce(status, 'pending'::public.task_reminder_status),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  reminder_mode is null
  or reminder_mode = ''
  or status is null
  or created_at is null
  or updated_at is null;

alter table public.task_reminders
  alter column reminder_mode set not null;
alter table public.task_reminders
  alter column created_at set not null;
alter table public.task_reminders
  alter column updated_at set not null;

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
      check (reminder_mode in ('due_date_9am', '1_day_before', '2_days_before', 'custom'));
  end if;
end
$$;

create index if not exists idx_task_reminders_task_id on public.task_reminders(task_id);
create index if not exists idx_task_reminders_send_at on public.task_reminders(send_at);
create index if not exists idx_task_reminders_status on public.task_reminders(status);
create index if not exists idx_task_reminders_recipient_email on public.task_reminders(lower(recipient_email));

drop trigger if exists trg_task_reminders_updated_at on public.task_reminders;
create trigger trg_task_reminders_updated_at
before update on public.task_reminders
for each row
execute function public.set_updated_at();

create table if not exists public.task_audit_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid,
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

alter table public.task_audit_log add column if not exists task_id uuid;
alter table public.task_audit_log add column if not exists action_type text;
alter table public.task_audit_log add column if not exists actor_user_id text;
alter table public.task_audit_log add column if not exists actor_email text;
alter table public.task_audit_log add column if not exists entity_type text default 'task';
alter table public.task_audit_log add column if not exists entity_id text;
alter table public.task_audit_log add column if not exists source_action text;
alter table public.task_audit_log add column if not exists old_data jsonb default '{}'::jsonb;
alter table public.task_audit_log add column if not exists new_data jsonb default '{}'::jsonb;
alter table public.task_audit_log add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.task_audit_log add column if not exists created_at timestamptz default now();

alter table public.task_audit_log drop constraint if exists task_audit_log_actor_user_id_fkey;
alter table public.task_audit_log drop constraint if exists task_audit_log_task_id_fkey;

alter table public.task_audit_log
  alter column actor_user_id type text using actor_user_id::text;

update public.task_audit_log
set
  entity_type = coalesce(nullif(entity_type, ''), 'task'),
  entity_id = coalesce(nullif(entity_id, ''), case when task_id is null then null else task_id::text end),
  old_data = coalesce(old_data, '{}'::jsonb),
  new_data = coalesce(new_data, '{}'::jsonb),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now())
where
  entity_type is null
  or entity_type = ''
  or old_data is null
  or new_data is null
  or metadata is null
  or created_at is null;

alter table public.task_audit_log
  alter column entity_type set not null;
alter table public.task_audit_log
  alter column old_data set not null;
alter table public.task_audit_log
  alter column new_data set not null;
alter table public.task_audit_log
  alter column metadata set not null;
alter table public.task_audit_log
  alter column created_at set not null;

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

create or replace function public.enforce_task_item_write()
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
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email, '');
    new.updated_by := coalesce(actor_id, actor_email);
    new.updated_by_email := actor_email;
  else
    if new.created_by is distinct from old.created_by
       or new.created_by_email is distinct from old.created_by_email
       or new.created_at is distinct from old.created_at then
      raise exception 'Task creator fields are immutable.';
    end if;

    if (
      new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.linked_module is distinct from old.linked_module
      or new.linked_url is distinct from old.linked_url
      or new.tags is distinct from old.tags
    ) and not public.hmj_task_is_creator(old.created_by, old.created_by_email) then
      raise exception 'Only the task creator can edit the original title or description.';
    end if;

    new.updated_by := coalesce(actor_id, actor_email);
    new.updated_by_email := actor_email;
  end if;

  if new.status = 'done' and coalesce(old.status::text, '') <> 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' and coalesce(old.status::text, '') = 'done' then
    new.completed_at := null;
  end if;

  if new.status = 'archived' and new.archived_at is null then
    new.archived_at := now();
  elsif new.status <> 'archived' and coalesce(old.status::text, '') = 'archived' then
    new.archived_at := null;
  end if;

  new.description := coalesce(new.description, '');
  new.created_by_email := coalesce(new.created_by_email, '');
  new.sort_order := coalesce(new.sort_order, 0);
  new.tags := coalesce(new.tags, '{}'::text[]);
  new.reminder_enabled := coalesce(new.reminder_enabled, false);

  return new;
end;
$$;

create or replace function public.enforce_task_item_delete()
returns trigger
language plpgsql
as $$
begin
  if not public.hmj_task_is_creator(old.created_by, old.created_by_email) then
    raise exception 'Only the task creator can delete this task.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_enforce_task_item_write on public.task_items;
create trigger trg_enforce_task_item_write
before insert or update on public.task_items
for each row
execute function public.enforce_task_item_write();

drop trigger if exists trg_enforce_task_item_delete on public.task_items;
create trigger trg_enforce_task_item_delete
before delete on public.task_items
for each row
execute function public.enforce_task_item_delete();

create or replace function public.enforce_task_comment_write()
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
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email, '');
    new.updated_by := coalesce(actor_id, actor_email);
    new.updated_by_email := actor_email;
  else
    if new.task_id is distinct from old.task_id
       or new.created_by is distinct from old.created_by
       or new.created_by_email is distinct from old.created_by_email
       or new.created_at is distinct from old.created_at then
      raise exception 'Comment ownership fields are immutable.';
    end if;

    if not public.hmj_task_is_creator(old.created_by, old.created_by_email) then
      raise exception 'Only the comment author can edit this comment.';
    end if;

    new.updated_by := coalesce(actor_id, actor_email);
    new.updated_by_email := actor_email;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_task_comment_write on public.task_comments;
create trigger trg_enforce_task_comment_write
before insert or update on public.task_comments
for each row
execute function public.enforce_task_comment_write();

create or replace function public.enforce_task_watcher_write()
returns trigger
language plpgsql
as $$
declare
  actor_id text := nullif(public.hmj_task_current_user_id(), '');
  actor_email text := nullif(public.hmj_task_current_user_email(), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(new.created_by, ''), actor_id, actor_email);
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email, '');
  else
    if new.task_id is distinct from old.task_id
       or new.user_id is distinct from old.user_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Watcher identity fields are immutable.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_task_watcher_write on public.task_watchers;
create trigger trg_enforce_task_watcher_write
before insert or update on public.task_watchers
for each row
execute function public.enforce_task_watcher_write();

create or replace function public.enforce_task_reminder_write()
returns trigger
language plpgsql
as $$
declare
  actor_id text := nullif(public.hmj_task_current_user_id(), '');
  actor_email text := nullif(public.hmj_task_current_user_email(), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(new.created_by, ''), actor_id, actor_email);
    new.created_by_email := coalesce(nullif(new.created_by_email, ''), actor_email, '');
    new.updated_by := coalesce(actor_id, actor_email);
    new.updated_by_email := actor_email;
  else
    if new.task_id is distinct from old.task_id
       or new.created_by is distinct from old.created_by
       or new.created_by_email is distinct from old.created_by_email
       or new.created_at is distinct from old.created_at then
      raise exception 'Reminder ownership fields are immutable.';
    end if;
    new.updated_by := coalesce(actor_id, actor_email);
    new.updated_by_email := actor_email;
  end if;

  if new.send_at is null then
    raise exception 'Reminder send time is required.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_task_reminder_write on public.task_reminders;
create trigger trg_enforce_task_reminder_write
before insert or update on public.task_reminders
for each row
execute function public.enforce_task_reminder_write();

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

create or replace function public.task_items_audit_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_task_audit(
      new.id,
      'task_created',
      '{}'::jsonb,
      to_jsonb(new),
      '{}'::jsonb,
      'task_items.insert',
      'task',
      new.id::text
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.log_task_audit(
      old.id,
      'task_deleted',
      to_jsonb(old),
      '{}'::jsonb,
      '{}'::jsonb,
      'task_items.delete',
      'task',
      old.id::text
    );
    return old;
  end if;

  if old.title is distinct from new.title
     or old.description is distinct from new.description
     or old.linked_module is distinct from new.linked_module
     or old.linked_url is distinct from new.linked_url
     or old.tags is distinct from new.tags
     or old.priority is distinct from new.priority then
    perform public.log_task_audit(
      new.id,
      'task_edited',
      jsonb_build_object(
        'title', old.title,
        'description', old.description,
        'linked_module', old.linked_module,
        'linked_url', old.linked_url,
        'tags', old.tags,
        'priority', old.priority
      ),
      jsonb_build_object(
        'title', new.title,
        'description', new.description,
        'linked_module', new.linked_module,
        'linked_url', new.linked_url,
        'tags', new.tags,
        'priority', new.priority
      ),
      '{}'::jsonb,
      'task_items.update.content',
      'task',
      new.id::text
    );
  end if;

  if old.assigned_to is distinct from new.assigned_to
     or old.assigned_to_email is distinct from new.assigned_to_email then
    perform public.log_task_audit(
      new.id,
      'task_reassigned',
      jsonb_build_object('assigned_to', old.assigned_to, 'assigned_to_email', old.assigned_to_email),
      jsonb_build_object('assigned_to', new.assigned_to, 'assigned_to_email', new.assigned_to_email),
      '{}'::jsonb,
      'task_items.update.assignment',
      'task',
      new.id::text
    );
  end if;

  if old.due_at is distinct from new.due_at then
    perform public.log_task_audit(
      new.id,
      'task_due_date_changed',
      jsonb_build_object('due_at', old.due_at),
      jsonb_build_object('due_at', new.due_at),
      '{}'::jsonb,
      'task_items.update.due_at',
      'task',
      new.id::text
    );
  end if;

  if old.status is distinct from new.status then
    perform public.log_task_audit(
      new.id,
      case
        when new.status = 'done' then 'task_completed'
        when new.status = 'archived' then 'task_archived'
        when old.status = 'archived' and new.status <> 'archived' then 'task_restored'
        else 'task_status_changed'
      end,
      jsonb_build_object('status', old.status, 'completed_at', old.completed_at, 'archived_at', old.archived_at),
      jsonb_build_object('status', new.status, 'completed_at', new.completed_at, 'archived_at', new.archived_at),
      '{}'::jsonb,
      'task_items.update.status',
      'task',
      new.id::text
    );
  elsif old.archived_at is distinct from new.archived_at then
    perform public.log_task_audit(
      new.id,
      case
        when new.archived_at is not null then 'task_archived'
        else 'task_restored'
      end,
      jsonb_build_object('archived_at', old.archived_at),
      jsonb_build_object('archived_at', new.archived_at),
      '{}'::jsonb,
      'task_items.update.archived_at',
      'task',
      new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_task_items_audit on public.task_items;
create trigger trg_task_items_audit
after insert or update or delete on public.task_items
for each row
execute function public.task_items_audit_trigger();

create or replace function public.task_comments_audit_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_task_audit(
      new.task_id,
      'comment_added',
      '{}'::jsonb,
      to_jsonb(new),
      jsonb_build_object('comment_id', new.id),
      'task_comments.insert',
      'comment',
      new.id::text
    );
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_task_audit(
      new.task_id,
      'comment_edited',
      to_jsonb(old),
      to_jsonb(new),
      jsonb_build_object('comment_id', new.id),
      'task_comments.update',
      'comment',
      new.id::text
    );
    return new;
  end if;

  perform public.log_task_audit(
    old.task_id,
    'comment_deleted',
    to_jsonb(old),
    '{}'::jsonb,
    jsonb_build_object('comment_id', old.id),
    'task_comments.delete',
    'comment',
    old.id::text
  );
  return old;
end;
$$;

drop trigger if exists trg_task_comments_audit on public.task_comments;
create trigger trg_task_comments_audit
after insert or update or delete on public.task_comments
for each row
execute function public.task_comments_audit_trigger();

create or replace function public.task_reminders_audit_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_task_audit(
      new.task_id,
      'reminder_created',
      '{}'::jsonb,
      to_jsonb(new),
      jsonb_build_object('reminder_id', new.id),
      'task_reminders.insert',
      'reminder',
      new.id::text
    );
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.log_task_audit(
      new.task_id,
      case
        when old.status is distinct from new.status and new.status = 'sent' then 'reminder_sent'
        when old.status is distinct from new.status and new.status = 'failed' then 'reminder_failed'
        when old.status is distinct from new.status and new.status = 'cancelled' then 'reminder_cancelled'
        else 'reminder_updated'
      end,
      to_jsonb(old),
      to_jsonb(new),
      jsonb_build_object('reminder_id', new.id),
      'task_reminders.update',
      'reminder',
      new.id::text
    );
    return new;
  end if;

  perform public.log_task_audit(
    old.task_id,
    'reminder_deleted',
    to_jsonb(old),
    '{}'::jsonb,
    jsonb_build_object('reminder_id', old.id),
    'task_reminders.delete',
    'reminder',
    old.id::text
  );
  return old;
end;
$$;

drop trigger if exists trg_task_reminders_audit on public.task_reminders;
create trigger trg_task_reminders_audit
after insert or update or delete on public.task_reminders
for each row
execute function public.task_reminders_audit_trigger();

create or replace function public.task_watchers_audit_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_task_audit(
      new.task_id,
      'watcher_added',
      '{}'::jsonb,
      to_jsonb(new),
      jsonb_build_object('watcher_id', new.id),
      'task_watchers.insert',
      'watcher',
      new.id::text
    );
    return new;
  end if;

  perform public.log_task_audit(
    old.task_id,
    'watcher_removed',
    to_jsonb(old),
    '{}'::jsonb,
    jsonb_build_object('watcher_id', old.id),
    'task_watchers.delete',
    'watcher',
    old.id::text
  );
  return old;
end;
$$;

drop trigger if exists trg_task_watchers_audit on public.task_watchers;
create trigger trg_task_watchers_audit
after insert or delete on public.task_watchers
for each row
execute function public.task_watchers_audit_trigger();

create or replace function public.guard_task_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Task audit log is immutable.';
end;
$$;

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

insert into public.admin_settings (key, value)
values (
  'team_tasks_settings',
  jsonb_build_object(
    'dueSoonDays', 3,
    'collapseDoneByDefault', true,
    'reminderRecipientMode', 'assignee_creator_watchers',
    'defaultPriority', 'medium'
  )
)
on conflict (key) do nothing;
