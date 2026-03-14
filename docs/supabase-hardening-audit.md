# Supabase Hardening Audit

## What changed

- `scripts/supabase-project-reconciliation.sql` remains the main additive/idempotent reconciliation script.
- Admin audit writes are standardised on `public.admin_audit_logs`.
- Candidate documents now assume a **private** `candidate-docs` bucket and should be served to admins via signed URLs generated server-side.
- Chatbot conversation storage no longer needs raw IP for current HMJ behaviour. New writes should use `ip_hash` only, and the reconciliation SQL nulls legacy `ip_address` values after backfilling missing hashes.

## Manual SQL

Run this in Supabase SQL Editor:

- `scripts/supabase-project-reconciliation.sql`

Optional only if you separately bootstrap the chatbot module outside the reconciliation script:

- `scripts/create-chatbot-module.sql`

## Intentionally preserved for compatibility

- `public.audit_log` remains supported as a compatibility bridge in SQL so legacy reads/inserts do not break, but application code should treat `public.admin_audit_logs` as canonical.
- `public.candidate_documents.url` is retained for legacy rows and external/manual links. New document rows should rely on `storage_key` plus server-generated signed URLs instead of public bucket URLs.
- `candidates.rtw_url` and `candidates.contract_url` were **not** auto-migrated because those fields may point to external/manual documents rather than Supabase Storage objects.

## Candidate document storage notes

- Bucket: `storage.buckets.id = 'candidate-docs'`
- Target posture: `public = false`
- Access pattern:
  - upload through admin Netlify functions using the service role
  - store `storage_key` in `public.candidate_documents`
  - generate signed URLs server-side for admin responses
  - fall back to legacy `url` only when no storage-backed access can be generated
- Current admin UX impact:
  - candidate drawer document links can safely open signed URLs
  - legacy rows still degrade gracefully

## Chatbot IP privacy notes

- Current runtime behaviour should only persist `ip_hash`.
- `chatbot_conversations.ip_address` is now treated as a deprecated legacy column.
- The reconciliation SQL:
  - backfills `ip_hash` from any existing raw `ip_address`
  - nulls `ip_address`
- No current admin/chatbot screens in the repo rely on displaying raw IP.

## Analytics verification

The reconciliation SQL analytics additions match current query patterns in `netlify/functions/_analytics.js`:

- `analytics_events_page_visit_idx`
  - supports page-visit rollups and dwell-time grouping
- `analytics_events_utm_source_idx`
  - supports source filters and dashboard source breakdowns
- `analytics_events_full_url_idx`
  - supports listing/spec resolution and query-string-derived job/spec lookup
- `analytics_listing_daily`
  - optional helper view for future listing rollups; not required for the current dashboard to function

## Core CRM / timesheet schema gap audit

The repo still does **not** contain a single authoritative bootstrap migration for the following business-critical objects. They were audited from code references only and were intentionally **not** recreated in SQL here.

- `clients`
  - key refs: `netlify/functions/admin-clients-save.js`, `netlify/functions/admin-clients-list.js`, `netlify/functions/admin-clients-get.js`, `netlify/functions/admin-assignments-dropdowns.js`
  - inferred columns used by code: `id`, `name`, `billing_email`, `phone`, `contact_name`, `contact_email`, `contact_phone`, `terms_days`, `status`, `address`, `billing`
- `candidates`
  - key refs: `netlify/functions/admin-candidates-save.js`, `netlify/functions/admin-candidates-list.js`, `netlify/functions/admin-candidates-get.js`, `netlify/functions/admin-payroll-list.js`
  - inferred columns used by code: `id`, `ref`, `user_id`, `first_name`, `last_name`, `full_name`, `email`, `phone`, `status`, `job_title`, `client_name`, `pay_type`, `payroll_ref`, `internal_ref`, `address`, `address1`, `address2`, `town`, `county`, `postcode`, `country`, `address_json`, `bank_name`, `bank_sort`, `bank_sort_code`, `bank_account`, `bank_iban`, `bank_swift`, `emergency_name`, `emergency_phone`, `rtw_url`, `contract_url`, `terms_ok`, `right_to_work`, `role`, `start_date`, `end_date`, `timesheet_status`, `tax_id`, `notes`, `skills`, `created_at`, `updated_at`
- `contractors`
  - key refs: `netlify/functions/admin-contractors-save.js`, `netlify/functions/admin-contractors-get.js`, `netlify/functions/admin-contractors-list.js`, `netlify/functions/_timesheet-helpers.js`
  - inferred columns used by code: `id`, `name`, `email`, `phone`, `payroll_ref`, `pay_type`, `address_json`, `bank`, `emergency_contact`, `right_to_work`
- `assignments`
  - key refs: `netlify/functions/admin-assignments-save.js`, `netlify/functions/admin-assignments-list.js`, `netlify/functions/admin-assignments-get.js`, `netlify/functions/_timesheet-helpers.js`, `netlify/functions/admin-payroll-list.js`
  - inferred columns used by code: `id`, `contractor_id`, `project_id`, `site_id`, `job_title`, `status`, `candidate_name`, `client_name`, `client_site`, `consultant_name`, `po_number`, `po_ref`, `as_ref`, `start_date`, `end_date`, `days_per_week`, `hours_per_day`, `currency`, `rate_std`, `rate_ot`, `charge_std`, `charge_ot`, `rate_pay`, `rate_charge`, `pay_freq`, `ts_type`, `shift_type`, `auto_ts`, `approver`, `notes`, `hs_risk`, `rtw_ok`, `quals`, `special`, `duties`, `equipment`, `terms_sent`, `sig_ok`, `notice_temp`, `notice_client`, `term_reason`, `contract_url`, `active`
- `projects`
  - key refs: `netlify/functions/admin-assignments-dropdowns.js`, `netlify/functions/admin-payroll-list.js`, `netlify/functions/_timesheet-helpers.js`
  - inferred columns used by code: `id`, `name`, `client_id`
- `sites`
  - key refs: `netlify/functions/admin-assignments-dropdowns.js`, `netlify/functions/admin-payroll-list.js`, `netlify/functions/_timesheet-helpers.js`
  - inferred columns used by code: `id`, `name`, `client_id`
- `timesheets`
  - key refs: `netlify/functions/admin-timesheets-list.js`, `netlify/functions/admin-timesheets-detail.js`, `netlify/functions/admin-payroll-list.js`, `netlify/functions/timesheets-save.js`, `netlify/functions/timesheets-submit.js`
  - inferred columns used by code: `id`, `assignment_id`, `candidate_id`, `candidate_name`, `client_name`, `week_start`, `week_ending`, `status`, `submitted_at`, `approved_at`, `approved_by`, `approver_email`, `ts_ref`, `assignment_ref`, `total_hours`, `ot_hours`, `rate_pay`, `rate_charge`, `currency`, `pay_amount`, `charge_amount`, `gp_amount`, `h_mon`, `h_tue`, `h_wed`, `h_thu`, `h_fri`, `h_sat`, `h_sun`, `updated_at`
- `timesheet_entries`
  - key refs: `netlify/functions/timesheets-save.js`, `netlify/functions/timesheets-submit.js`, `netlify/functions/timesheets-get-this-week.js`, `netlify/functions/timesheets-history.js`
  - inferred columns used by code: `id`, `timesheet_id`, `day`, `hours_std`, `hours_ot`, `note`
  - implied constraint: unique key on `(timesheet_id, day)` for the direct upsert fallback
- `v_timesheets_admin`
  - key refs: `netlify/functions/admin-timesheets-remind.js`
  - inferred columns used by code: `id`, `status`, `week_ending`, `contractor_email`, `client_name`, `project_name`
- `upsert_timesheet_entry`
  - key refs: `netlify/functions/timesheets-save.js`, `netlify/functions/timesheets-submit.js`
  - inferred RPC params: `p_timesheet_id`, `p_day`, `p_std`, `p_ot`, `p_note`

## Known remaining gaps

- There is still no repo-authoritative SQL for the full CRM/timesheet model. That should be captured from the live source of truth before any future rebuild or environment bootstrap work.
- Legacy candidate URLs stored directly on `candidates.rtw_url` / `candidates.contract_url` are outside the new `candidate_documents` privacy hardening and may still point to public/external files.
- The candidate document upload/list/delete functions exist, but the wider candidate document management UX is still lightweight rather than a full document centre.
