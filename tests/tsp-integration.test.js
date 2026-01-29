const http = require('http');
const { tspFetch } = require('../admin-v2/functions/_lib/tsp.js');
const { resetTokenCache } = require('../admin-v2/functions/_lib/tsp-auth.js');
const tspHealth = require('../admin-v2/functions/tsp-health.js');

describe('tsp fetch integration', () => {
  const originalEnv = process.env;
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/token') && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const grantType = params.get('grant_type');
          const clientId = params.get('client_id');
          const clientSecret = params.get('client_secret');

          if (grantType !== 'client_credentials' || clientId !== 'client-id' || clientSecret !== 'client-secret') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_client' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }));
        });
        return;
      }

      if (req.url.startsWith('/clients')) {
        const auth = req.headers.authorization || '';
        if (auth !== 'Bearer test-token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clients: [{ id: 1, name: 'Demo' }] }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TSP_BASE_URL = baseUrl;
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';
    resetTokenCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTokenCache();
  });

  test('tspFetch attaches bearer token', async () => {
    const result = await tspFetch('/clients', { query: { limit: 1 } });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.data.clients)).toBe(true);
  });

  test('health check passes with valid token', async () => {
    const response = await tspHealth.handler();
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.ok).toBe(true);
  });
});
