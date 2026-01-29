# Timesheet Portal (TSP) Admin v2

These Netlify Functions power the `/admin/` tools and now connect to the live Brightwater Timesheet Portal API.

## Required environment variables

Set these in Netlify (or your local `.env` when using `netlify dev`):

- `TSP_MODE` — must be set to `live` to enable real API calls.
- `TSP_OAUTH_CLIENT_ID` — OAuth2 client ID for Brightwater TSP.
- `TSP_OAUTH_CLIENT_SECRET` — OAuth2 client secret for Brightwater TSP.
- `TSP_OAUTH_SCOPE` — OAuth2 scope string supplied by Brightwater (optional).

Optional overrides:

- `TSP_BASE_URL` — defaults to `https://brightwater.api.timesheetportal.com`.
- `TSP_TOKEN_URL` — overrides the token endpoint (defaults to `${TSP_BASE_URL}/token`).
- `TSP_CLIENTS_PATH` — defaults to `/clients`.
- `TSP_PROJECTS_PATH` — defaults to `/projects`.
- `TSP_USERS_PATH` — defaults to `/users`.
- `TSP_PLACEMENTS_PATH` — defaults to `/placements`.
- `TSP_HEALTH_PATH` — when set, overrides the default health probe path.
- `TSP_WHOAMI_PATH` — when set, uses the dedicated whoami endpoint instead of a `/users` lookup.
- `TSP_API_USER_EMAIL` — fallback email for whoami lookup when no whoami endpoint exists.

Deprecated (ignored):

- `TSP_API_KEY` — legacy API key support has been removed in favor of OAuth2 client credentials.

## Local testing with Netlify CLI

1. Ensure the Netlify CLI is installed (`npm install -g netlify-cli`).
2. Create a local `.env` file or export the required variables above.
3. Run `netlify dev`.
4. Open `http://localhost:8888/admin/` and click:
   - **Check env**
   - **Health check**
   - **List clients**

If `TSP_MODE` is not set to `live`, the functions will respond with `{ ok: false, mode: "standby" }`.
