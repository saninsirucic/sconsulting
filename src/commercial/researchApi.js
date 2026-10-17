import { apiRequest } from '../api';

const root = '/api/haccp-research';
export const researchApi = {
  state: () => apiRequest(`${root}/state`),
  leads: (filters) => apiRequest(`${root}/leads?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== false))}`),
  settings: (body) => apiRequest(`${root}/settings`, { method: 'PUT', body }),
  run: () => apiRequest(`${root}/runs`, { method: 'POST', body: {} }),
  updateLead: (id, body) => apiRequest(`${root}/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
};
