## HMJ Analytics Supabase Audit

Date: 2026-03-14

### What the analytics module currently uses

- The admin analytics dashboard reads from `public.analytics_events` through:
  - `netlify/functions/admin-analytics-dashboard.js`
  - `netlify/functions/_analytics.js`
- The public/admin tracker writes raw events through:
  - `js/hmj-analytics.js`
  - `netlify/functions/analytics-ingest.js`
- The dashboard currently derives sessions, landing pages, exits, top pages, listings, CTA activity, and trends from raw events.
- The dashboard does **not** currently query `public.analytics_sessions`.

### Attached live schema mismatch

The attached Supabase schema uses an alternate raw-event shape on `public.analytics_events`, including:

- `id`
- `event_at`
- `path`
- `page_url`
- `click_target`
- `click_text`
- `click_href`
- `anon_ip_hash`
- `country_code`
- `meta`

The HMJ analytics module expects canonical compatibility fields as well, including:

- `event_id`
- `occurred_at`
- `page_visit_id`
- `page_path`
- `full_url`
- `referrer_domain`
- `link_url`
- `link_text`
- `event_value`
- `path_from`
- `path_to`
- `ip_hash`
- `country`
- `payload`

### Required Supabase action

Run one of the following scripts in Supabase SQL Editor:

- Analytics-only: `scripts/create-website-analytics.sql`
- Full additive project reconciliation: `scripts/supabase-project-reconciliation.sql`

Recommended: use `scripts/supabase-project-reconciliation.sql`.

### What the updated SQL now does

- Adds missing canonical analytics columns without dropping existing live columns.
- Preserves the attached schema's existing `id` primary key model.
- Backfills canonical fields from existing live columns.
- Keeps canonical and alternate columns synchronized with a trigger.
- Generates/backfills `event_id` for stable deduplication.
- Reconciles duplicate/missing `event_id` values safely.
- Ensures a full unique `event_id` index exists for reliable `ON CONFLICT (event_id)` upserts.
- Adds analytics indexes used by the dashboard query pattern.
- Adds derived views:
  - `public.analytics_session_rollups`
  - `public.analytics_page_daily`
  - `public.analytics_listing_daily`

### Intentionally left unchanged

- `public.analytics_sessions` was not rewritten because the current dashboard does not depend on it.
- No destructive rebuild of analytics tables was introduced.
- No unrelated CRM/admin schema was changed as part of this analytics audit.

### Known follow-up option

If HMJ later wants `public.analytics_sessions` maintained as a first-class reporting table, that should be added as a separate phase using a derived refresh process or a database-side aggregation routine. It is not required for the current live analytics dashboard to function.
