import { BACKEND_URL } from '../config';

export async function aiMailRequest(path, { token, method = 'GET', body, signal } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  const isFormData = body instanceof FormData;
  if (body && !isFormData) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BACKEND_URL}/api/ai-email${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    signal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Zahtjev nije uspio.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

