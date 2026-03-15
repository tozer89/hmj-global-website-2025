-- HMJ Global post-reconciliation verification
-- Run after supabase/sql/full_reconciliation.sql

-- Relation existence
select
  required.object_type,
  required.object_name,
  to_regclass(required.regclass_name) is not null as exists_now
from (
  values
    ('table', 'admin_settings', 'public.admin_settings'),
    ('table', 'admin_users', 'public.admin_users'),
    ('table', 'admin_audit_logs', 'public.admin_audit_logs'),
    ('table', 'candidate_documents', 'public.candidate_documents'),
    ('table', 'noticeboard_posts', 'public.noticeboard_posts'),
    ('table', 'team_members', 'public.team_members'),
    ('table', 'short_links', 'public.short_links'),
    ('table', 'job_specs', 'public.job_specs'),
    ('table', 'candidate_skills', 'public.candidate_skills'),
    ('table', 'job_applications', 'public.job_applications'),
    ('table', 'candidate_activity', 'public.candidate_activity'),
    ('table', 'candidate_match_runs', 'public.candidate_match_runs'),
    ('table', 'candidate_match_files', 'public.candidate_match_files'),
    ('table', 'chatbot_conversations', 'public.chatbot_conversations'),
    ('table', 'chatbot_messages', 'public.chatbot_messages'),
    ('table', 'chatbot_events', 'public.chatbot_events'),
    ('table', 'analytics_events', 'public.analytics_events'),
    ('table', 'task_items', 'public.task_items'),
    ('table', 'task_comments', 'public.task_comments'),
    ('table', 'task_watchers', 'public.task_watchers'),
    ('table', 'task_reminders', 'public.task_reminders'),
    ('table', 'task_audit_log', 'public.task_audit_log'),
    ('view', 'audit_log', 'public.audit_log'),
    ('view', 'analytics_session_rollups', 'public.analytics_session_rollups'),
    ('view', 'analytics_page_daily', 'public.analytics_page_daily'),
    ('view', 'analytics_listing_daily', 'public.analytics_listing_daily'),
    ('view', 'task_items_view', 'public.task_items_view')
) as required(object_type, object_name, regclass_name)
order by required.object_type, required.object_name;

-- Critical columns
select
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
    ('candidates', 'auth_user_id'),
    ('candidates', 'portal_account_closed_at'),
    ('candidate_documents', 'document_type'),
    ('candidate_documents', 'storage_bucket'),
    ('candidate_documents', 'storage_path'),
    ('candidate_documents', 'deleted_at'),
    ('job_applications', 'share_code'),
    ('candidate_activity', 'actor_role'),
    ('team_members', 'slug'),
    ('noticeboard_posts', 'publish_at'),
    ('task_items', 'linked_module'),
    ('task_items', 'linked_url'),
    ('task_items', 'tags'),
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

-- Policies
select
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

-- Buckets
select
  required.bucket_id,
  exists (
    select 1
    from storage.buckets b
    where b.id = required.bucket_id
  ) as exists_now
from (
  values
    ('candidate-docs'),
    ('noticeboard-images'),
    ('team-images'),
    ('candidate-matcher-uploads')
) as required(bucket_id)
order by required.bucket_id;

-- Manual follow-up check list
select
  relation_name,
  case
    when relation_kind = 'function' then exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = relation_name
    )
    else to_regclass(regclass_name) is not null
  end as exists_now,
  reason
from (
  values
    ('clients', 'table', 'public.clients', 'Validate the live legacy CRM clients table shape manually.'),
    ('contractors', 'table', 'public.contractors', 'Validate the live legacy CRM contractors table shape manually.'),
    ('assignments', 'table', 'public.assignments', 'Validate the live legacy CRM assignments table shape manually.'),
    ('projects', 'table', 'public.projects', 'Validate the live legacy CRM projects table shape manually.'),
    ('sites', 'table', 'public.sites', 'Validate the live legacy CRM sites table shape manually.'),
    ('timesheets', 'table', 'public.timesheets', 'Validate the live legacy timesheets table shape manually.'),
    ('timesheet_entries', 'table', 'public.timesheet_entries', 'Validate the live legacy timesheet entries table shape manually.'),
    ('v_timesheets_admin', 'view', 'public.v_timesheets_admin', 'Validate the live reporting view used by admin timesheets export/remind flows.'),
    ('upsert_timesheet_entry', 'function', 'public.upsert_timesheet_entry', 'Validate the live RPC used by contractor/admin timesheet save flows.')
) as manual(relation_name, relation_kind, regclass_name, reason)
order by relation_name;
