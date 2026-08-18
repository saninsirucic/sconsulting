import { apiRequest } from '../api';

const base = '/api/commercial';
const brandPath = (code) => `${base}/brands/${encodeURIComponent(code)}`;

export const commercialApi = {
  getBrands: () => apiRequest(`${base}/brands`),
  getDashboard: (code) => apiRequest(`${brandPath(code)}/dashboard`),
  getRecords: (code, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
    });
    return apiRequest(`${brandPath(code)}/records${query.toString() ? `?${query}` : ''}`);
  },
  createRecord: (code, body) => apiRequest(`${brandPath(code)}/records`, { method: 'POST', body }),
  updateRecord: (id, body) => apiRequest(`${base}/records/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  transferRecord: (id, targetBrandCode) => apiRequest(`${base}/records/${encodeURIComponent(id)}/transfer`, {
    method: 'POST',
    body: { target_brand_code: targetBrandCode },
  }),
  deleteRecord: (id) => apiRequest(`${base}/records/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getDailyList: (code) => apiRequest(`${brandPath(code)}/daily-list`),
  createDailyList: (code) => apiRequest(`${brandPath(code)}/daily-list`, { method: 'POST' }),
  updateDailyAssignment: (id, body) => apiRequest(`${base}/daily-assignments/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  approveDailyAssignments: (code, assignmentIds) => apiRequest(`${brandPath(code)}/daily-assignments/approval`, {
    method: 'PATCH',
    body: { assignment_ids: assignmentIds, decision: 'APPROVED' },
  }),
  getMailAutomation: (code) => apiRequest(`${brandPath(code)}/mail-automation`),
  updateMailAutomation: (code, body) => apiRequest(`${brandPath(code)}/mail-automation`, { method: 'PUT', body }),
  prepareMailAutomation: (code) => apiRequest(`${brandPath(code)}/mail-automation/prepare`, { method: 'POST' }),
  importDailyApprovedMailAutomation: (code, assignmentIds, { includeLegacyCompleted = false } = {}) => apiRequest(`${brandPath(code)}/mail-automation/import-daily-approved`, {
    method: 'POST',
    body: {
      assignment_ids: assignmentIds,
      confirm: true,
      ...(includeLegacyCompleted ? { include_legacy_completed: true } : {}),
    },
  }),
  decideMailAutomationCandidates: (code, accountIds, decision) => apiRequest(`${brandPath(code)}/mail-automation/candidates`, {
    method: 'PATCH',
    body: { account_ids: accountIds, decision },
  }),
  updateMailAutomationCandidateRecipients: (code, accountId, ccEmails) => apiRequest(`${brandPath(code)}/mail-automation/candidates/${encodeURIComponent(accountId)}/recipients`, {
    method: 'PATCH',
    body: { cc_emails: ccEmails },
  }),
  sendSelectedMailAutomation: (code, accountIds) => apiRequest(`${brandPath(code)}/mail-automation/send-selected`, {
    method: 'POST',
    body: { account_ids: accountIds, confirm: true },
  }),
  pauseMailAutomation: (code) => apiRequest(`${brandPath(code)}/mail-automation/pause`, { method: 'POST' }),
  sendNextMailAutomation: (code) => apiRequest(`${brandPath(code)}/mail-automation/send-next`, { method: 'POST', body: { confirm: true } }),
};
