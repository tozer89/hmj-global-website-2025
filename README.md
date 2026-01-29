# HMJ Global – Payroll Export (Test Area)

## Setup checklist (Timesheet Portal Brightwater API)

1. **Set the API base URL** (Netlify environment variable):
   - `TSP_BASE_URL=https://brightwater.api.timesheetportal.com`
2. **Configure OAuth2 client credentials (required):**
   - `TSP_OAUTH_CLIENT_ID`
   - `TSP_OAUTH_CLIENT_SECRET`
   - `(Optional) TSP_OAUTH_SCOPE`

   Generate OAuth credentials in Timesheet Portal:
   **Settings → Account → Account → API access → Generate API credentials** (System Admin user).
3. **Optional “whoami” lookup:**
   - `TSP_WHOAMI_PATH` (if the API exposes a whoami endpoint), **or**
   - `TSP_API_USER_EMAIL` for the fallback email lookup.
4. **Optional endpoint overrides (only if the API paths differ):**
   - `TSP_CLIENTS_PATH` (defaults to `/clients`)
   - `TSP_PLACEMENTS_PATH` (defaults to `/placements`)
   - `TSP_USERS_PATH` (defaults to `/users`)
   - `TSP_HEALTH_PATH` (if a dedicated health endpoint exists)

> **Netlify note:** Set the required environment variables in both **Production** and **Deploy Preview** contexts so the admin dashboard can reach the Brightwater API in live previews.

## Payroll export + review functions (Netlify)

New admin endpoints (require admin auth + Supabase):

- `/.netlify/functions/admin-payroll-export-preview`
- `/.netlify/functions/admin-payroll-export-csv`
- `/.netlify/functions/admin-payroll-mark-paid`

### Local verification (Netlify Dev)

> Never paste secrets into logs or screenshots. Use your local `.env` or Netlify site envs.

1) **OAuth health check (TSP API Tools)**
   - Run `netlify dev` and open the admin “TSP API Tools”.
   - Health check should report `token_url_present: true` with a valid token and the `/clients` call should proceed.

2) **Preview payroll review pack**
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/admin-payroll-export-preview \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <admin_jwt>" \
     -d '{"week_ending":"2025-01-31","include_unapproved":false}'
   ```
   Expected: JSON with `items`, `totals`, `by_contractor`, `warnings`.

3) **Download payroll CSV**
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/admin-payroll-export-csv \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <admin_jwt>" \
     -d '{"week_ending":"2025-01-31","format":"generic"}'
   ```
   Expected: JSON with `csv`, `filename`, and `mime: "text/csv"`.

4) **Mark paid (requires ADMIN_EXPORT_TOKEN if configured)**
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/admin-payroll-mark-paid \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <admin_jwt>" \
     -H "x-admin-export-token: <optional-token>" \
     -d '{"week_ending":"2025-01-31","payroll_batch":"2025-01-WE-2025-01-31"}'
   ```
   Expected: JSON with `updated_count`, `already_paid_count`, `failed_count`.
