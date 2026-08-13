export const PRODUCTION_BACKEND_URL = "https://radiant-beach-27998-21e0f72a6a44.herokuapp.com";

export function resolveBackendUrl(configuredUrl, environment = process.env.NODE_ENV) {
  const normalized = String(configuredUrl || '').trim().replace(/\/$/, '');
  const pointsToLocalhost = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(normalized);

  // A local .env override must never make it into the public GitHub Pages build.
  if (environment === 'production' && pointsToLocalhost) return PRODUCTION_BACKEND_URL;
  return normalized || PRODUCTION_BACKEND_URL;
}

export const BACKEND_URL = resolveBackendUrl(process.env.REACT_APP_BACKEND_URL);
