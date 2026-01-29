# Admin v2 Netlify Functions – Timesheet Portal (TSP)

## Required environment variables

Set these in Netlify (Deploy Preview + Production) or your local `.env` when using Netlify CLI:

- `TSP_BASE_URL` (e.g. `https://brightwater.api.timesheetportal.com`)
- `TSP_CLIENT_ID`
- `TSP_CLIENT_SECRET`

Optional fallback (legacy auth):

- `TSP_API_KEY` (used only to request a token via `POST /token` if client credentials are missing)

## Local testing with Netlify CLI

```bash
netlify dev
```

Then open `/admin/` and use the TSP API cards to call the Netlify Functions under `/.netlify/functions/`.
