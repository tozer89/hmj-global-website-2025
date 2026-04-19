# Bullhorn integration

- Public callback URI to register with Bullhorn: `https://hmj-global.com/api/connectors/bullhorn/callback`
- Internal connect route in HMJ admin: `/.netlify/functions/admin-bullhorn-connect`
- Required Netlify env vars:
  - `BULLHORN_CLIENT_ID`
  - `BULLHORN_CLIENT_SECRET`
  - `BULLHORN_REDIRECT_URI`
  - `BULLHORN_API_USERNAME`

The Bullhorn redirect URI must match exactly. For production this should be:

`https://hmj-global.com/api/connectors/bullhorn/callback`

First-time authorisation flow:

1. HMJ admin opens `/.netlify/functions/admin-bullhorn-connect`.
2. HMJ discovers the correct Bullhorn data-center URLs with `loginInfo`.
3. HMJ redirects the browser to Bullhorn OAuth.
4. Bullhorn redirects back to `https://hmj-global.com/api/connectors/bullhorn/callback`.
5. HMJ exchanges the code for OAuth tokens, logs into Bullhorn REST, stores the latest refresh token, and persists the active `BhRestToken` session.

What is ready once live Bullhorn credentials are added:

- OAuth start and callback flow
- loginInfo data-center discovery
- access-token exchange and refresh-token rotation
- Bullhorn REST login and session persistence
- service methods for `ClientCorporation`, `ClientContact`, and entity metadata
- a stubbed email activity adapter interface for later tenant-specific mapping

What remains blocked until live credentials and tenant review are available:

- validating the exact Bullhorn tenant data center and account permissions
- confirming any custom `ClientCorporation` or `ClientContact` field mappings
- choosing the correct Bullhorn email activity entity and metadata mapping for inbound/outbound sync

Operational note:

- The final browser must still be able to reach `https://hmj-global.com` for the public callback.
- HMJ stores Bullhorn tokens using the existing encrypted settings pattern. If `HMJ_FINANCE_SECRET` is not set, encryption and state signing fall back to existing service secrets.
