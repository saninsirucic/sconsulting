import { PRODUCTION_BACKEND_URL, resolveBackendUrl } from './config';

test('produkcijski build nikada ne koristi localhost backend', () => {
  expect(resolveBackendUrl('http://localhost:3001', 'production')).toBe(PRODUCTION_BACKEND_URL);
  expect(resolveBackendUrl('http://127.0.0.1:3001/', 'production')).toBe(PRODUCTION_BACKEND_URL);
});

test('razvoj i eksplicitni produkcijski backend ostaju podržani', () => {
  expect(resolveBackendUrl('http://localhost:3001/', 'development')).toBe('http://localhost:3001');
  expect(resolveBackendUrl('https://api.example.ba/', 'production')).toBe('https://api.example.ba');
});
