# Supabase Function Review — October 2025

This document captures the current state of the Netlify Functions that integrate with Supabase. It lists the areas that were already working reliably, the issues discovered during this pass, and the corrective actions applied so future troubleshooting has a clear baseline.

## Working paths

| Area | Function(s) | Notes |
| --- | --- | --- |
| Timesheet read/write (contractor portal) | `timesheets-get-this-week`, `timesheets-save`, `timesheets-submit`, `timesheets-history`, `contractor-profile` | These rely on the shared helper in `_timesheet-helpers.js` which builds the authenticated contractor context directly from Netlify Identity cookies. They already used the correct helper and continued to function. |
| Admin timesheet workflows | `admin-timesheets-list`, `admin-timesheets-get`, `admin-timesheets-create`, `admin-timesheets-edit`, `admin-timesheets-approve`, `admin-timesheets-reject`, `admin-timesheets-export`, `admin-timesheets-remind` | All use the newer `withSupabase` wrapper which creates the service-role client and consistently pass `(event, context)` into `_auth.getContext`, so permissions and data access behaved as expected. |
| Health checks | `supa-health` | Confirms environment variables are present and Supabase auth endpoint is reachable. |

## Issues fixed in this pass

| Symptom | Root cause | Resolution |
| --- | --- | --- |
| Admin CRUD functions (clients, contractors, assignments, candidates) responded `401 Unauthorized` even for signed-in admins. | Legacy handlers were calling `getContext(context, { requireAdmin: true })` — note the missing `event` argument. In `_auth.js` the signature is `getContext(event, context, opts)`, so the original code never saw headers or Netlify’s clientContext and always threw. | Updated every handler in `netlify/functions/admin-*-*.js` to call `getContext(event, context, …)` so Supabase uses the service key and Netlify Identity is honoured. |
| Job share links fell back to a static preview with no persistence. | There was no Netlify function for jobs, and no Supabase table to cache generated links. | Added `admin-jobs-share.js` which stores a payload in `job_shares` with a 60-day TTL and returns a durable `/jobs/spec.html?share=TOKEN` link. Fallback still points to the static page if Supabase is unavailable. |
| Jobs admin page (referenced in previous conversations) missing entirely. | Page and APIs were never implemented in this repo. | Built `/admin/jobs.html` and the supporting Netlify functions (`admin-jobs-list`, `admin-jobs-save`, `admin-jobs-reorder`, `admin-jobs-email`, `admin-jobs-section-save`) plus the public `job-spec` reader. |

## Comparison: why some flows worked while others failed

Working endpoints (timesheets portal + new jobs suite) share three traits:

1. **Consistent auth bootstrap** — they all call `getContext(event, context, …)` before hitting Supabase so the service-role key is attached and Netlify Identity is honoured. 【F:netlify/functions/admin-jobs-share.js†L27-L33】【F:netlify/functions/admin-jobs-email.js†L81-L87】
2. **Shared Supabase wrapper** — the `withSupabase` helper standardises error handling and injects tracing, so any connection issues bubble up as JSON instead of silent failures. 【F:netlify/functions/_supabase.js†L73-L115】
3. **Graceful fallbacks** — when Supabase is unreachable the UI shows cached/static data instead of crashing (e.g. job share links degrade to static URLs). 【F:netlify/functions/admin-jobs-share.js†L70-L85】【F:jobs/spec.html†L107-L150】

Legacy handlers that misbehaved (older admin CRUD endpoints) skipped one or more of those steps—primarily passing the wrong arguments into `getContext`, which meant the helper never saw the JWT headers. Fixing the call signature brought them in line with the working pattern above.

## Open follow-ups / observations

* **Email dispatch provider** — `admin-jobs-email.js` will send via Resend when `RESEND_API_KEY` is present; otherwise it logs the HTML and returns it to the UI. If another provider is preferred, mirror the helper in that file.
* **Database objects expected**
  * `jobs` table with columns: `id`, `title`, `status`, `section`, `section_label`, `section_description`, `discipline`, `type`, `location_text`, `location_code`, `overview`, `responsibilities`, `requirements`, `apply_url`, `keywords`, `published`, `sort_order`, `match_assignment`, `is_live`, timestamps.
  * `job_sections` table (optional; derived sections used if missing).
  * `job_shares` table storing `{ token, job_id, payload jsonb, expires_at }`.
  * `job_email_logs` table for audit. Inserts are `try/catch` guarded so absence does not break email sending.
* **Environment variables** — ensure Netlify has `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and for email `RESEND_API_KEY`/`HMJ_EMAIL_FROM`. Set `HMJ_PUBLIC_URL` if share links need a custom base URL.

With these fixes in place, the admin job tooling now follows the same auth pattern as the timesheet suite and will surface trace IDs (via `x-trace`) in logs for easier debugging.
