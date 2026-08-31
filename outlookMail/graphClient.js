const { ConfidentialClientApplication } = require('@azure/msal-node');

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_VERSION_PATH = '/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const FIXED_MAILBOX = 'sales@s-consulting.ba';

class OutlookError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'OutlookError';
    this.status = options.status || 500;
    this.code = options.code || 'OUTLOOK_ERROR';
    this.retryAfter = options.retryAfter;
    this.details = options.details;
  }
}

function parseInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function exactBoolean(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function createOutlookConfig(env = process.env) {
  const requestedMailbox = String(env.OUTLOOK_MAILBOX_ADDRESS || FIXED_MAILBOX).trim().toLowerCase();
  const allowedMailboxes = String(env.OUTLOOK_ALLOWED_MAILBOXES || FIXED_MAILBOX)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const tenantId = String(env.MICROSOFT_TENANT_ID || '').trim();
  const clientId = String(env.MICROSOFT_CLIENT_ID || '').trim();
  const clientSecret = String(env.MICROSOFT_CLIENT_SECRET || '').trim();
  const configuredSender = String(env.MAIL_SENDER_ADDRESS || FIXED_MAILBOX).trim().toLowerCase();
  const cursorSecret = String(env.OUTLOOK_CURSOR_SECRET || env.JWT_SECRET || '').trim()
    || (env.NODE_ENV === 'production' ? '' : 'sconsulting-outlook-development-only-secret');
  const mailboxAllowed = requestedMailbox === FIXED_MAILBOX
    && configuredSender === FIXED_MAILBOX
    && allowedMailboxes.length === 1
    && allowedMailboxes[0] === FIXED_MAILBOX;
  const credentialsPresent = Boolean(tenantId && clientId && clientSecret);
  let configurationMessage = null;
  if (!mailboxAllowed) configurationMessage = 'Outlook mailbox konfiguracija nije dozvoljena.';
  else if (!credentialsPresent) configurationMessage = 'Microsoft Graph pristup još nije konfigurisan.';
  else if (!cursorSecret) configurationMessage = 'Outlook cursor potpis nije konfigurisan.';

  return {
    mailbox: FIXED_MAILBOX,
    tenantId,
    clientId,
    clientSecret,
    configured: credentialsPresent && mailboxAllowed && Boolean(cursorSecret),
    configurationMessage,
    writeEnabled: exactBoolean(env.OUTLOOK_MAIL_WRITES_ENABLED),
    maxAttachments: parseInteger(env.OUTLOOK_MAX_ATTACHMENTS, 5, 1, 10),
    maxAttachmentBytes: parseInteger(env.OUTLOOK_MAX_ATTACHMENT_BYTES, 2500000, 1, 2999999),
    maxTotalAttachmentBytes: parseInteger(env.OUTLOOK_MAX_TOTAL_ATTACHMENT_BYTES, 5000000, 1, 10000000),
    timeoutMs: parseInteger(env.OUTLOOK_GRAPH_TIMEOUT_MS, 7000, 1000, 10000),
    maxReadRetries: parseInteger(env.OUTLOOK_GRAPH_READ_RETRIES, 2, 0, 3),
    maxRetryDelayMs: parseInteger(env.OUTLOOK_GRAPH_MAX_RETRY_DELAY_MS, 2000, 100, 5000),
    maxJsonResponseBytes: parseInteger(env.OUTLOOK_MAX_JSON_RESPONSE_BYTES, 5000000, 100000, 10000000),
    cursorSecret
  };
}

function retryAfterSeconds(headers) {
  const raw = headers && headers.get ? headers.get('retry-after') : null;
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds)) return Math.max(1, Math.min(30, seconds));
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(1, Math.min(30, Math.ceil((timestamp - Date.now()) / 1000)));
}

async function readBoundedBuffer(response, maximumBytes, options = {}) {
  const errorStatus = options.status || 413;
  const errorCode = options.code || 'OUTLOOK_ATTACHMENT_TOO_LARGE';
  const errorMessage = options.message || 'Graph odgovor je veći od dozvoljenog.';
  const contentLength = Number.parseInt(response.headers && response.headers.get && response.headers.get('content-length'), 10);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new OutlookError(errorMessage, { status: errorStatus, code: errorCode });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maximumBytes) throw new OutlookError(errorMessage, { status: errorStatus, code: errorCode });
    return data;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new OutlookError(errorMessage, { status: errorStatus, code: errorCode });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function validateGraphUrl(value, mailbox) {
  const url = value instanceof URL ? value : new URL(value, `${GRAPH_ORIGIN}${GRAPH_VERSION_PATH}/`);
  if (url.origin !== GRAPH_ORIGIN || url.username || url.password || url.port || url.hash) {
    throw new OutlookError('Nevažeći Microsoft Graph nastavak stranice.', {
      status: 400,
      code: 'INVALID_CURSOR'
    });
  }
  const expectedRoot = `${GRAPH_VERSION_PATH}/users/${encodeURIComponent(mailbox)}`;
  const normalizedPath = url.pathname.toLowerCase();
  const normalizedRoot = expectedRoot.toLowerCase();
  if (/%(?:25|2e|2f|5c)/i.test(url.pathname)) {
    throw new OutlookError('Nevažeća Microsoft Graph putanja.', { status: 400, code: 'INVALID_CURSOR' });
  }
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}/`)) {
    throw new OutlookError('Nastavak stranice ne pripada konfigurisanom mailboxu.', {
      status: 400,
      code: 'INVALID_CURSOR'
    });
  }
  return url;
}

function createGraphClient(options = {}) {
  const config = options.config || createOutlookConfig(options.env);
  const fetchImpl = options.fetchImpl || global.fetch;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let msalClient = options.msalClient || null;

  function ensureConfigured() {
    if (!config.configured) {
      throw new OutlookError(config.configurationMessage || 'Microsoft Graph nije konfigurisan.', {
        status: 503,
        code: 'OUTLOOK_NOT_CONFIGURED'
      });
    }
    if (!msalClient) {
      msalClient = new ConfidentialClientApplication({
        auth: {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}`
        }
      });
    }
  }

  async function getAccessToken(forceRefresh = false) {
    ensureConfigured();
    const result = await msalClient.acquireTokenByClientCredential({
      scopes: [GRAPH_SCOPE],
      skipCache: forceRefresh
    });
    if (!result || !result.accessToken) {
      throw new OutlookError('Microsoft Graph token nije dostupan.', {
        status: 503,
        code: 'OUTLOOK_TOKEN_UNAVAILABLE'
      });
    }
    return result.accessToken;
  }

  async function request(pathOrUrl, requestOptions = {}) {
    ensureConfigured();
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const url = validateGraphUrl(pathOrUrl, config.mailbox);
    const mayRetry = requestOptions.idempotent ?? method === 'GET';
    const maximumAttempts = 1 + (mayRetry ? config.maxReadRetries : 0);
    let refreshedAfterUnauthorized = false;
    let forceTokenRefresh = false;
    let lastError;

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const accessToken = await getAccessToken(forceTokenRefresh);
        forceTokenRefresh = false;
        const headers = {
          ...(requestOptions.headers || {}),
          Authorization: `Bearer ${accessToken}`,
          Accept: requestOptions.responseType === 'buffer' ? '*/*' : 'application/json',
          Prefer: 'IdType="ImmutableId"'
        };
        let body = requestOptions.body;
        if (body !== undefined && body !== null && !Buffer.isBuffer(body) && typeof body !== 'string') {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(body);
        }
        const response = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: 'error' });
        if (response.status === 401 && !refreshedAfterUnauthorized) {
          clearTimeout(timeout);
          refreshedAfterUnauthorized = true;
          forceTokenRefresh = true;
          attempt -= 1;
          continue;
        }
        if (response.ok) {
          let data = null;
          if (response.status !== 204) {
            if (requestOptions.responseType === 'buffer') {
              data = await readBoundedBuffer(response, requestOptions.maxResponseBytes || 3000000);
            }
            else {
              const bytes = await readBoundedBuffer(response, requestOptions.maxResponseBytes || config.maxJsonResponseBytes, {
                status: 502,
                code: 'OUTLOOK_RESPONSE_TOO_LARGE',
                message: 'Microsoft Graph odgovor je prevelik.'
              });
              const text = bytes.toString('utf8');
              data = text ? JSON.parse(text) : null;
            }
          }
          clearTimeout(timeout);
          return { data, headers: response.headers, status: response.status };
        }

        const retryAfter = retryAfterSeconds(response.headers);
        try {
          await readBoundedBuffer(response, 65536, { status: 502, code: 'OUTLOOK_GRAPH_ERROR' });
        } catch (error) { /* Error bodies are best-effort and never returned or logged. */ }
        clearTimeout(timeout);
        const retryDelayMs = (retryAfter || Math.min(2, 2 ** attempt)) * 1000;
        const retryable = mayRetry
          && [429, 503, 504].includes(response.status)
          && retryDelayMs <= config.maxRetryDelayMs
          && attempt + 1 < maximumAttempts;
        if (retryable) {
          await sleep(retryDelayMs);
          continue;
        }
        throw new OutlookError(
          response.status === 404 ? 'Outlook stavka nije pronađena.' : 'Microsoft Graph zahtjev nije uspio.',
          {
            status: response.status === 404 ? 404 : (response.status === 429 ? 429 : 502),
            code: response.status === 404 ? 'OUTLOOK_ITEM_NOT_FOUND' : 'OUTLOOK_GRAPH_ERROR',
            retryAfter
          }
        );
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof OutlookError) throw error;
        lastError = error;
        const retryable = mayRetry && attempt + 1 < maximumAttempts;
        if (retryable) {
          await sleep(Math.min(config.maxRetryDelayMs, Math.min(2, 2 ** attempt) * 1000));
          continue;
        }
        throw new OutlookError(
          error && error.name === 'AbortError' ? 'Microsoft Graph zahtjev je istekao.' : 'Microsoft Graph trenutno nije dostupan.',
          { status: 503, code: error && error.name === 'AbortError' ? 'OUTLOOK_TIMEOUT' : 'OUTLOOK_UNAVAILABLE' }
        );
      }
    }
    throw lastError || new OutlookError('Microsoft Graph trenutno nije dostupan.', { status: 503 });
  }

  function mailboxPath(suffix = '') {
    return `${GRAPH_ORIGIN}${GRAPH_VERSION_PATH}/users/${encodeURIComponent(config.mailbox)}${suffix}`;
  }

  return { config, mailboxPath, request, validateGraphUrl: (value) => validateGraphUrl(value, config.mailbox) };
}

module.exports = {
  FIXED_MAILBOX,
  GRAPH_ORIGIN,
  OutlookError,
  createGraphClient,
  createOutlookConfig,
  validateGraphUrl
};
