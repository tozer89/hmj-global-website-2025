const { getAccessToken, getOAuthEnv, resetTokenCache } = require('../admin-v2/functions/_lib/tsp-auth.js');

describe('tsp oauth token helper', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetTokenCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTokenCache();
    jest.restoreAllMocks();
  });

  test('caches token between calls', async () => {
    process.env.TSP_BASE_URL = 'https://example.test';
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';

    const env = getOAuthEnv();
    const fetchJson = jest.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { access_token: 'token-1', expires_in: 120 },
    });

    const first = await getAccessToken(env, fetchJson);
    const second = await getAccessToken(env, fetchJson);

    expect(first.ok).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.cached).toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  test('refreshes token when near expiry', async () => {
    process.env.TSP_BASE_URL = 'https://example.test';
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';

    const env = getOAuthEnv();
    const fetchJson = jest.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { access_token: 'token-1', expires_in: 120 },
    });

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);

    await getAccessToken(env, fetchJson);

    nowSpy.mockReturnValue(61000);
    await getAccessToken(env, fetchJson);

    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  test('formats token request as form-urlencoded without blank scope', async () => {
    process.env.TSP_BASE_URL = 'https://example.test';
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';

    const env = getOAuthEnv();
    let capturedBody = '';
    let capturedHeaders = {};

    const fetchJson = jest.fn().mockImplementation(async (_url, options) => {
      capturedBody = options.body;
      capturedHeaders = options.headers;
      return {
        response: { ok: true, status: 200 },
        data: { access_token: 'token-1', expires_in: 3600 },
      };
    });

    await getAccessToken(env, fetchJson);

    expect(capturedHeaders['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(capturedBody).toContain('grant_type=client_credentials');
    expect(capturedBody).toContain('client_id=client-id');
    expect(capturedBody).toContain('client_secret=client-secret');
    expect(capturedBody).not.toContain('scope=');
  });

  test('includes scope when provided', async () => {
    process.env.TSP_BASE_URL = 'https://example.test';
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.TSP_OAUTH_SCOPE = 'read write';

    const env = getOAuthEnv();
    let capturedBody = '';

    const fetchJson = jest.fn().mockImplementation(async (_url, options) => {
      capturedBody = options.body;
      return {
        response: { ok: true, status: 200 },
        data: { access_token: 'token-1', expires_in: 3600 },
      };
    });

    await getAccessToken(env, fetchJson);

    expect(capturedBody).toContain('scope=read+write');
  });

  test('handles failed token responses', async () => {
    process.env.TSP_BASE_URL = 'https://example.test';
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';

    const env = getOAuthEnv();
    const fetchJson = jest.fn().mockResolvedValue({
      response: { ok: false, status: 401 },
      data: { error: 'invalid_client' },
      text: '',
    });

    const result = await getAccessToken(env, fetchJson);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe('invalid_client');
  });

  test('handles network errors', async () => {
    process.env.TSP_BASE_URL = 'https://example.test';
    process.env.TSP_OAUTH_CLIENT_ID = 'client-id';
    process.env.TSP_OAUTH_CLIENT_SECRET = 'client-secret';

    const env = getOAuthEnv();
    const fetchJson = jest.fn().mockResolvedValue({
      error: new Error('Network down'),
    });

    const result = await getAccessToken(env, fetchJson);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network down');
  });
});
