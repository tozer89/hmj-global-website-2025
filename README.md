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
