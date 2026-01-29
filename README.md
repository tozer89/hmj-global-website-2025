# HMJ Global – Payroll Export (Test Area)

## Setup checklist (Timesheet Portal Brightwater API)

1. **Set the API base URL** (Netlify environment variable):
   - `TSP_BASE_URL=https://brightwater.api.timesheetportal.com`
2. **Configure authentication (preferred OAuth2):**
   - `TSP_CLIENT_ID`
   - `TSP_CLIENT_SECRET`

   Generate OAuth credentials in Timesheet Portal:
   **Settings → Account → Account → API access → Generate API credentials** (System Admin user).
3. **Fallback authentication (regular token flow) if OAuth2 is unavailable:**
   - `TSP_EMAIL`
   - `TSP_PASSWORD`
   - `TSP_ACCOUNT_NAME`
4. **Final fallback (pre-issued token):**
   - `TSP_API_KEY` (token value, with or without the `Bearer ` prefix).
5. **Optional “whoami” lookup:**
   - `TSP_WHOAMI_PATH` (if the API exposes a whoami endpoint), **or**
   - `TSP_API_USER_EMAIL` for the fallback email lookup.
6. **Optional endpoint overrides (only if the API paths differ):**
   - `TSP_CLIENTS_PATH` (defaults to `/clients`)
   - `TSP_PLACEMENTS_PATH` (defaults to `/placements`)
   - `TSP_USERS_PATH` (defaults to `/users`)
   - `TSP_HEALTH_PATH` (if a dedicated health endpoint exists)

