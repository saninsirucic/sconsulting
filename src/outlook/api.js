import { apiFetch, apiRequest } from '../api';
import { parseRecipients } from './schema';

const base = '/api/outlook';

function messagePath(messageId) {
  return `${base}/messages/${encodeURIComponent(messageId)}`;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  return query.toString() ? `?${query.toString()}` : '';
}

export function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Prilog ${file.name} nije moguće pročitati.`));
    reader.onload = () => {
      const contentBytes = String(reader.result || '').split(',')[1] || '';
      resolve({
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentBytes,
      });
    };
    reader.readAsDataURL(file);
  });
}

export async function composePayload(form, files = []) {
  const attachments = await Promise.all(files.map(fileToAttachment));
  return {
    to: parseRecipients(form.to),
    cc: parseRecipients(form.cc),
    bcc: parseRecipients(form.bcc),
    subject: String(form.subject || '').trim(),
    body: String(form.body || ''),
    bodyType: 'text',
    attachments,
  };
}

export const outlookApi = {
  getStatus: () => apiRequest(`${base}/status`),
  getFolders: () => apiRequest(`${base}/folders`),
  getAccount: () => apiRequest(`${base}/account`),
  getMessages: (params) => apiRequest(`${base}/messages${buildQuery(params)}`),
  getMessage: (id) => apiRequest(messagePath(id)),
  markRead: (id, isRead) => apiRequest(messagePath(id), { method: 'PATCH', body: { isRead } }),
  moveMessage: (id, destination) => apiRequest(`${messagePath(id)}/move`, { method: 'POST', body: { destination } }),
  deleteMessage: (id) => apiRequest(messagePath(id), { method: 'DELETE' }),
  send: (body) => apiRequest(`${base}/send`, { method: 'POST', body }),
  reply: (id, body) => apiRequest(`${messagePath(id)}/reply`, { method: 'POST', body }),
  replyAll: (id, body) => apiRequest(`${messagePath(id)}/reply-all`, { method: 'POST', body }),
  forward: (id, body) => apiRequest(`${messagePath(id)}/forward`, { method: 'POST', body }),
  getAttachment: (messageId, attachmentId) => apiFetch(`${messagePath(messageId)}/attachments/${encodeURIComponent(attachmentId)}`),
};
