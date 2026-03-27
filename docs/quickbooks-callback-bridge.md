# QuickBooks Callback Bridge

- Public redirect URI: `https://hmj-global.com/api/connectors/quickbooks/callback`
- Required Netlify env var: `HMJ_ASSISTANT_QBO_CALLBACK_TARGET`
- Optional Netlify env var: `HMJ_ASSISTANT_QBO_ALLOWED_HOSTS`
- Intuit redirect URI must match the public redirect URI exactly.
- `HMJ_ASSISTANT_QBO_CALLBACK_TARGET` must be the final HMJ assistant callback URL at `/api/connectors/quickbooks/callback`.
- The browser that returns from Intuit must still be able to reach the private assistant callback target after the Netlify redirect.
