# HMJ Global Supabase Reconciliation Audit

Date: 2026-03-15

## 1. Executive Summary

This audit traced the HMJ Global repo as the application source of truth and compared that runtime expectation to the Supabase structures that are currently represented in checked-in SQL.

The biggest finding is structural rather than a single broken table:

- the repo already has a broad additive reconciliation script in `scripts/supabase-project-reconciliation.sql`
- newer Supabase-backed modules were added after that master script and are not fully folded into it yet
- the main gaps are:
  - candidate portal schema and RLS coverage
  - team module coverage
  - team tasks schema/RLS/realtime coverage
  - a few runtime-to-SQL mismatches such as `job_applications.share_code`

The repo also still does not contain one authoritative bootstrap for the older CRM/timesheet core (`clients`, `contractors`, `assignments`, `projects`, `sites`, `timesheets`, `timesheet_entries`, `v_timesheets_admin`, `upsert_timesheet_entry`). Because of that, the safest reconciliation posture is:

- fully reconcile the repo-owned support modules
- add the new repo-driven fields on existing core tables where evidence is strong
- avoid blindly rebuilding the older CRM/timesheet base from guesswork

## 2. Audit Method And Important Limitation

Audit method:

- searched the repo for all Supabase clients, `from(...)`, `rpc(...)`, `storage.from(...)`, `auth.*`, and realtime usage
- reviewed all checked-in SQL scripts under `scripts/`
- mapped runtime code paths to the tables, views, functions, buckets, policies, and helper assumptions they require

Important limitation:

- this audit did **not** have live database catalog access during execution
- no live `SUPABASE_*` credentials were available locally
- the “current exists” side of the comparison therefore means:
  - present in checked-in repo SQL
  - not present in checked-in repo SQL
  - live verification still required in Supabase after running the generated checks

## 3. Supabase Architecture Currently Used By The Website

### Primary pattern

The live architecture is mixed and intentional:

- Netlify Functions with the Supabase service role remain the main write/read path for most public/admin features
- Netlify Identity remains the current admin auth boundary
- Supabase Auth is used only for the newer candidate portal flows
- one admin module, Team Tasks, uses a browser Supabase client plus a short-lived JWT signed server-side for authenticated realtime/RLS access

### Client map

| Client | Files | Purpose |
| --- | --- | --- |
| Service role server client | `netlify/functions/_supabase.js`, `admin-v2/functions/_supabase.js` | Public/admin server-side access to database and storage |
| Candidate browser client | `js/hmj-candidate-portal.js`, `netlify/functions/candidate-auth-config.js` | Candidate auth, profile, files, self-service activity |
| Team Tasks browser client | `admin/team-tasks.js`, `netlify/functions/admin-team-tasks-config.js` | Admin realtime task board with RLS-backed direct table access |

### Auth map

| Auth model | Repo source | Current role |
| --- | --- | --- |
| Netlify Identity admin auth | `netlify/functions/_auth.js`, `netlify.toml` | Current admin gate and route protection |
| Supabase Auth candidate auth | `js/hmj-candidate-portal.js`, `candidate-auth-config.js` | Candidate signup/login/reset/account flows |

## 4. Module-By-Module Dependency Matrix

| Module | Repo entrypoints | Required Supabase resources | Checked-in SQL coverage | Main issue / action |
| --- | --- | --- | --- | --- |
| Admin support/settings | `_auth.js`, `_settings-helpers.js`, `admin-settings-*`, `_audit.js` | `admin_users`, `admin_settings`, `admin_audit_logs`, `audit_log` view bridge | Covered in current master script | Keep additive and preserved |
| Jobs public/admin | `_jobs-helpers.js`, `jobs-list.js`, `admin-jobs-*`, `admin-job-share-create.js`, `job-spec-get.js` | `jobs`, `job_specs` | Covered in current master script plus job alter scripts | Keep additive jobs-field reconciliation |
| Candidate admin/docs | `admin-candidates-*`, `admin-candidate-doc-*`, `_candidate-docs.js` | `candidates`, `candidate_documents`, `job_applications`, `candidate_activity`, `candidate-docs` bucket | Partial | `candidate_documents` needed richer schema alignment |
| Candidate portal/public form sync | `hmj-candidate-portal.js`, `candidate-auth-config.js`, `candidate-portal-sync.js`, `candidate-account-delete.js` | `candidates`, `candidate_skills`, `job_applications`, `candidate_activity`, `candidate_documents`, `candidate-docs` bucket, candidate RLS/storage policies | Partial in standalone script only | Old candidate-portal SQL assumed UUID candidate PKs; new master must be safer |
| About/team | `team-list.js`, `admin-team-*`, `_team-helpers.js`, `about.enhanced.js` | `team_members`, `team-images` bucket | Standalone script exists, old master missing it | Fold into master reconciliation |
| Noticeboard | `noticeboard-list.js`, `admin-noticeboard-*`, `_noticeboard-helpers.js`, `about.enhanced.js` | `noticeboard_posts`, `noticeboard-images` bucket, `admin_settings.noticeboard_enabled` | Covered in current master script | Preserve public/admin split |
| Chatbot | `chatbot-*`, `admin-chatbot-*`, `_chatbot-storage.js` | `chatbot_conversations`, `chatbot_messages`, `chatbot_events`, `admin_settings.chatbot_settings` | Covered in current master script | Preserve IP hashing posture |
| Analytics | `hmj-analytics.js`, `analytics-ingest.js`, `admin-analytics-dashboard.js`, `_analytics.js` | `analytics_events`, `analytics_session_rollups`, `analytics_page_daily`, `analytics_listing_daily` | Covered in current master script | Keep compatibility columns and trigger |
| Candidate matcher | `candidate-matcher.js`, `candidate-matcher-core.js`, `admin-candidate-match*` | `candidate_match_runs`, `candidate_match_files`, `candidate-matcher-uploads` bucket | Covered in current master script | Keep async job columns |
| Team Tasks | `admin/team-tasks.js`, `admin-team-tasks-config.js`, `admin-team-tasks-reminders-run.js` | `task_items`, `task_comments`, `task_watchers`, `task_reminders`, `task_audit_log`, `task_items_view`, helper functions, RLS, realtime-friendly auth model | Standalone script exists, old master missing it | Fold into master reconciliation |
| Core CRM/timesheets/payroll/finance | `admin-clients-*`, `admin-contractors-*`, `admin-assignments-*`, `admin-timesheets-*`, `timesheets-*`, `admin-payroll-*`, `admin-report-gross-margin.js` | `clients`, `contractors`, `assignments`, `projects`, `sites`, `timesheets`, `timesheet_entries`, `v_timesheets_admin`, `upsert_timesheet_entry` | No authoritative checked-in bootstrap | Validate live schema; avoid blind rebuild |

## 5. Required Database Structures Discovered From The Codebase

### Tables fully or mostly owned by newer repo modules

| Type | Name | Where used in code | Expected purpose | Current repo-state issue | Recommended action |
| --- | --- | --- | --- | --- | --- |
| Table | `admin_settings` | `_settings-helpers.js`, public settings flow, noticeboard/chatbot/team tasks config | Shared settings store | Covered | Keep, seed missing keys additively |
| Table | `admin_users` | `_auth.js`, `admin-team-tasks-config.js` | Admin allowlist/role lookup | Covered | Keep, preserve Netlify admin architecture |
| Table | `admin_audit_logs` | `_audit.js`, many admin mutation endpoints | Canonical admin audit log sink | Covered | Keep, preserve `audit_log` compatibility bridge |
| Table | `candidate_documents` | admin docs functions, candidate portal browser, candidate detail drawer | Shared candidate document metadata table | Legacy and richer portal shapes both used | Reconcile to richer superset without breaking legacy reads |
| Table | `noticeboard_posts` | noticeboard public/admin endpoints | Noticeboard content | Covered | Keep |
| Table | `team_members` | team public/admin endpoints | About page team cards | Missing from old master | Add to master reconciliation |
| Table | `short_links` | `admin-short-links.js`, `short-link-go.js` | Branded redirects | Covered | Keep |
| Table | `job_specs` | job share/create + public spec retrieval | Shareable job snapshots | Covered | Keep |
| Table | `candidate_match_runs` | candidate matcher flows | Match run history/results | Covered | Keep |
| Table | `candidate_match_files` | candidate matcher flows | Uploaded matcher file metadata | Covered | Keep |
| Table | `chatbot_conversations` | chatbot storage/admin | Chat session summary | Covered | Keep |
| Table | `chatbot_messages` | chatbot storage/admin | Message transcript | Covered | Keep |
| Table | `chatbot_events` | chatbot storage/admin | Chatbot event log | Covered | Keep |
| Table | `analytics_events` | analytics ingest/dashboard | Raw analytics event sink | Covered | Keep compatibility shape |
| Table | `candidate_skills` | candidate portal save/sync | Normalised candidate skill tags | Old master missing it | Add to master reconciliation |
| Table | `job_applications` | candidate portal reads, background sync, admin candidate drawer | Candidate application history | Old master missing it | Add to master reconciliation and include `share_code` |
| Table | `candidate_activity` | candidate portal activity logging, admin candidate drawer | Candidate activity/audit feed | Old master missing it | Add to master reconciliation |
| Table | `task_items` | Team Tasks admin UI | Core task board items | Old master missing it | Add to master reconciliation |
| Table | `task_comments` | Team Tasks admin UI | Task comments | Old master missing it | Add to master reconciliation |
| Table | `task_watchers` | Team Tasks admin UI | Watchers/subscribers | Old master missing it | Add to master reconciliation |
| Table | `task_reminders` | Team Tasks admin UI + hourly reminder function | Reminder schedule/outcome rows | Old master missing it | Add to master reconciliation |
| Table | `task_audit_log` | Team Tasks admin UI | Append-only audit log | Old master missing it | Add to master reconciliation |

### Existing core tables with additive repo expectations

| Type | Name | Where used in code | Expected purpose | Current repo-state issue | Recommended action |
| --- | --- | --- | --- | --- | --- |
| Table | `jobs` | public jobs page, admin jobs page, candidate matcher, job share flows | Job catalogue | Additive public/commercial fields already identified | Keep additive reconciliation only |
| Table | `candidates` | admin candidates, candidate portal sync/browser | Candidate CRM plus portal identity link | No authoritative bootstrap in repo | Add only strongly evidenced portal fields; validate live base schema separately |
| Table | `timesheets` | timesheets UI, payroll, reports | Timesheet records | No authoritative bootstrap in repo | Validate live schema; do not blind-create |
| Table | `timesheet_entries` | timesheet save/submit/history/detail | Day-by-day timesheet entries | No authoritative bootstrap in repo | Validate live schema; do not blind-create |
| Table | `clients` | admin clients, assignments dropdowns | Client master | No authoritative bootstrap in repo | Validate live schema |
| Table | `contractors` | admin contractors, assignments publish, contractor timesheets | Contractor master | No authoritative bootstrap in repo | Validate live schema |
| Table | `assignments` | assignments admin, timesheets, payroll | Assignment master | No authoritative bootstrap in repo | Validate live schema |
| Table | `projects` | assignments dropdowns, payroll | Project master | No authoritative bootstrap in repo | Validate live schema |
| Table | `sites` | assignments dropdowns, payroll | Site master | No authoritative bootstrap in repo | Validate live schema |

### Views, RPCs, storage, and helper functions

| Type | Name | Where used | Current issue | Recommended action |
| --- | --- | --- | --- | --- |
| View | `analytics_session_rollups` | analytics reporting | Covered | Keep |
| View | `analytics_page_daily` | analytics reporting | Covered | Keep |
| View | `analytics_listing_daily` | analytics reporting/future listing reports | Covered | Keep |
| View | `task_items_view` | Team Tasks SQL script expectations | Missing from old master | Add to master reconciliation |
| View | `v_timesheets_admin` | admin timesheets export/remind | No authoritative bootstrap in repo | Validate live object, do not blind-create from guesswork |
| RPC | `upsert_timesheet_entry` | `timesheets-save.js`, `timesheets-submit.js`, legacy `admin-timesheets-edit.js` | No authoritative bootstrap in repo | Validate live object manually |
| Bucket | `candidate-docs` | admin candidate docs + candidate portal | Covered but must support both admin and self-service portal paths | Keep private; add portal storage policies |
| Bucket | `noticeboard-images` | noticeboard image uploads/public image URLs | Covered | Keep public |
| Bucket | `team-images` | team image uploads/public image URLs | Missing from old master | Add to master reconciliation, keep public |
| Bucket | `candidate-matcher-uploads` | candidate matcher uploads | Covered | Keep private |

## 6. Missing Structures

Missing from the checked-in master reconciliation script, but clearly required by the repo:

- `team_members`
- `team-images` bucket reconciliation
- `candidate_skills`
- `job_applications`
- `candidate_activity`
- candidate-portal RLS and storage policies
- Team Tasks tables:
  - `task_items`
  - `task_comments`
  - `task_watchers`
  - `task_reminders`
  - `task_audit_log`
- Team Tasks helper functions and policies:
  - `hmj_task_current_user_id`
  - `hmj_task_current_user_email`
  - `hmj_task_current_roles`
  - `hmj_task_is_admin`
  - `hmj_task_is_creator`
  - `log_task_audit`
  - `get_task_summary`
  - `task_items_view`

Missing from checked-in SQL but required by runtime code:

- `job_applications.share_code`

## 7. Mismatched Structures

### Candidate documents

Repo expectation:

- admin flows and candidate portal both write/read `candidate_documents`
- portal code expects richer metadata:
  - `document_type`
  - `original_filename`
  - `file_extension`
  - `mime_type`
  - `file_size_bytes`
  - `storage_bucket`
  - `storage_path`
  - `uploaded_at`
  - `updated_at`
  - `deleted_at`
  - `owner_auth_user_id`

Problem found:

- `admin-candidate-doc-upload.js` inserted only the old minimal shape before this audit
- portal/browser code had to keep compatibility fallbacks because the database shape could lag

Decision:

- database should be reconciled to the richer superset
- code should also write the richer shape where possible

### Candidate portal key-type assumption

Problem found:

- `scripts/create-candidate-portal.sql` assumes UUID candidate primary keys and tries to coerce related tables to UUID candidate references
- repo runtime code is more tolerant and mostly treats candidate IDs as strings
- fallback/admin seed data does not prove UUID candidate IDs

Decision:

- do not force a candidate primary key type migration from this master reconciliation
- keep portal support tables compatible with a legacy candidate ID that may not be UUID-backed
- document live validation of the actual `candidates.id` type as a manual step

### Legacy admin timesheet functions

Problem found:

- the legacy endpoints:
  - `netlify/functions/admin-timesheets-create.js`
  - `netlify/functions/admin-timesheets-edit.js`
  - `netlify/functions/admin-timesheets-approve.js`
  - `netlify/functions/admin-timesheets-bulk-approve.js`
  - `netlify/functions/admin-timesheet-reject.js`
- imported the contractor-facing `_timesheet-helpers.js` admin-incorrectly
- they called `getContext` and `ensureTimesheet` with the wrong signatures

Decision:

- patch the repo code safely because the function files are part of the deployed surface even if the current UI no longer calls them directly

## 8. Likely Stale / Legacy / Compatibility Structures

- `public.audit_log`
  - intentionally retained as a compatibility bridge to `admin_audit_logs`
- legacy `candidate_documents.url`
  - retained for old/manual rows and graceful fallback
- admin candidate drawer still supports legacy `candidates.rtw_url` and `candidates.contract_url`
- the candidate portal/browser code contains temporary unknown-column fallbacks
  - useful for rolling migrations
  - should stop being the normal path after reconciliation
- older admin timesheet mutation endpoints appear to be legacy and currently not referenced by the active `admin/timesheets.js`

## 9. RLS / Auth / Storage Risks

### Correct security boundary to preserve

- admin auth should remain on Netlify Identity plus server-side checks
- candidate auth should remain separate on Supabase Auth
- do not force a breaking admin auth migration during this reconciliation

### Main RLS expectations by module

| Resource | Desired access model |
| --- | --- |
| `admin_settings`, `admin_users`, `admin_audit_logs`, `noticeboard_posts`, `team_members`, `short_links`, `job_specs`, `candidate_match_runs`, `candidate_match_files`, `chatbot_*`, `analytics_events` | Service-role/server-side only |
| `candidate_documents` | Admin service-role full access plus candidate self-service access limited to own profile and own `portal/<auth.uid()>/...` files |
| `candidates` | Candidate can read/insert/update own linked row only |
| `candidate_skills` | Candidate can read/insert/delete own rows only |
| `job_applications` | Candidate self-read only is sufficient for current browser usage; service role handles sync writes |
| `candidate_activity` | Candidate can self-read and insert activity rows tied to their profile |
| `task_*` tables | Authenticated admin/team-task token only, using JWT role helpers and least-privilege policies |

### Storage expectations

| Bucket | Expected posture | Why |
| --- | --- | --- |
| `candidate-docs` | Private | Candidate/admin documents must use signed URLs or controlled reads |
| `noticeboard-images` | Public | Public notices need direct image URLs |
| `team-images` | Public | Public team cards need direct image URLs |
| `candidate-matcher-uploads` | Private | Admin-only matching documents |

## 10. Recommended Reconciliation Plan

1. Reconcile shared/admin support tables first.
2. Reconcile content/public-support modules:
   - noticeboard
   - team
   - short links
   - job specs
   - jobs additive fields
3. Reconcile candidate document superset and `candidate-docs` private storage posture.
4. Reconcile candidate portal support tables and RLS:
   - `candidate_skills`
   - `job_applications`
   - `candidate_activity`
   - `candidate_documents` browser policies
5. Reconcile chatbot, analytics, and candidate matcher support objects.
6. Reconcile Team Tasks tables/functions/RLS/grants/realtime-supporting schema.
7. Run validation checks.
8. Separately validate older CRM/timesheet base objects live before any wider manual CRM migration work.

## 11. Items Fixed In Code

Repo fixes applied as part of this audit:

- admin candidate document upload now writes the richer `candidate_documents` storage metadata shape as well as remaining compatible with legacy readers
- legacy admin timesheet mutation endpoints were corrected to use admin auth context rather than the contractor-side timesheet helper contract

## 12. Items Fixed In SQL

The new master reconciliation SQL added or folded in:

- team module schema/bucket/policy coverage
- candidate portal support tables and candidate-facing RLS/storage policies, using a safer legacy-compatible candidate key approach
- Team Tasks schema/functions/policies/view coverage
- `job_applications.share_code`
- richer `candidate_documents` superset reconciliation
- post-run validation queries and manual action markers

## 13. Items Intentionally Left Unchanged

- Netlify-based admin auth architecture
- Netlify-based public form submissions
- fire-and-forget candidate background sync behaviour from public forms
- service-role Netlify function access patterns for public/admin site modules
- older CRM/timesheet base table creation or destructive alteration
- destructive cleanup of legacy compatibility columns such as `candidate_documents.url`

## 14. Concrete Resource Notes

### `candidate_documents`

- Used in:
  - `netlify/functions/admin-candidate-doc-upload.js`
  - `netlify/functions/admin-candidate-doc-delete.js`
  - `netlify/functions/admin-candidate-docs-list.js`
  - `netlify/functions/admin-candidates-get.js`
  - `js/hmj-candidate-portal.js`
- Required purpose:
  - shared metadata table for both admin-managed candidate docs and candidate self-service uploads
- Fix direction:
  - keep legacy fields
  - add and backfill richer storage metadata fields
  - preserve private bucket access via signed URLs or scoped candidate storage policies

### `job_applications`

- Used in:
  - `netlify/functions/_candidate-portal.js`
  - `netlify/functions/candidate-portal-sync.js`
  - `netlify/functions/admin-candidates-get.js`
  - `js/hmj-candidate-portal.js`
- Required purpose:
  - candidate application history and candidate drawer visibility
- Key required columns:
  - `candidate_id`, `job_id`, `status`, `applied_at`, `job_title`, `job_location`, `job_type`, `job_pay`, `source`, `source_submission_id`, `share_code`
- Key mismatch:
  - `share_code` existed in runtime code but not in checked-in SQL

### `team_members`

- Used in:
  - `netlify/functions/team-list.js`
  - `netlify/functions/admin-team-list.js`
  - `netlify/functions/admin-team-save.js`
  - `assets/js/about.enhanced.js`
- Required purpose:
  - dynamic About page team cards and admin team management
- Key issue:
  - standalone SQL existed, but the older master reconciliation script did not include it

### `task_*`

- Used in:
  - `admin/team-tasks.js`
  - `netlify/functions/admin-team-tasks-config.js`
  - `netlify/functions/admin-team-tasks-reminders-run.js`
- Required purpose:
  - direct admin task board with realtime and RLS-backed access
- Key issue:
  - full checked-in SQL existed, but the older master reconciliation script did not include it

## 15. Final Audit Conclusion

The repo is not fundamentally “Supabase-broken”; it is in a transitional state where the application has outgrown the older checked-in master reconciliation script.

The safest production-grade response is therefore:

- keep the current live architecture
- generate one additive master reconciliation SQL that catches the checked-in master up with the actual repo
- patch the small runtime mismatches that the repo itself introduced
- explicitly keep the older CRM/timesheet base in the “validate live first” lane until there is a canonical schema source
