import { BACKEND_URL } from './config';

export const SESSION_STORAGE_KEY = 'sconsulting-session';
export const AUTH_UNAUTHORIZED_EVENT = 'sconsulting:unauthorized';

export class ApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function readStoredSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)) || null;
  } catch (error) {
    return null;
  }
}

export function writeStoredSession(session) {
  if (session) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function notifyUnauthorized(response, isPublic) {
  if (response.status !== 401 || isPublic || typeof window === 'undefined') return;
  const event = typeof CustomEvent === 'function' ? new CustomEvent(AUTH_UNAUTHORIZED_EVENT, {
    detail: { status: response.status }
  }) : new Event(AUTH_UNAUTHORIZED_EVENT);
  window.dispatchEvent(event);
}

export async function apiFetch(path, options = {}) {
  const {
    public: isPublic = false,
    token: explicitToken,
    headers: providedHeaders,
    ...fetchOptions
  } = options;
  const headers = new Headers(providedHeaders || {});
  const token = explicitToken || readStoredSession()?.token;

  if (!isPublic && token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(buildUrl(path), { ...fetchOptions, headers });
  notifyUnauthorized(response, isPublic);
  return response;
}

export async function apiRequest(path, options = {}) {
  const { body, headers: providedHeaders, ...requestOptions } = options;
  const headers = new Headers(providedHeaders || {});
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  let requestBody = body;

  if (body !== undefined && body !== null && !isFormData && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  const response = await apiFetch(path, { ...requestOptions, headers, body: requestBody });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      payload = raw;
    }
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Zahtjev nije uspio (${response.status}).`;
    throw new ApiError(message, { status: response.status, payload });
  }

  return payload;
}
