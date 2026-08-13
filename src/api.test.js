import { apiRequest, writeStoredSession } from './api';

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn();
});

test('authenticated API šalje Bearer token iz sesije', async () => {
  writeStoredSession({ token: 'commercial-token', user: { role: 'komercijala' } });
  fetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ items: [] }) });

  await apiRequest('/api/commercial/brands');

  const [, options] = fetch.mock.calls[0];
  expect(options.headers.get('Authorization')).toBe('Bearer commercial-token');
});

test('public API ne šalje token', async () => {
  writeStoredSession({ token: 'secret-token', user: { role: 'direktor' } });
  fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

  await apiRequest('/api/auth/login', { public: true });

  expect(fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false);
});
