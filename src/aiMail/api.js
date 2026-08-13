import { apiRequest } from '../api';

export async function aiMailRequest(path, { token, method = 'GET', body, signal } = {}) {
  return apiRequest(`/api/ai-email${path}`, {
    method,
    token,
    body,
    signal
  });
}
