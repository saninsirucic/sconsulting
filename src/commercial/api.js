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
  deleteRecord: (id) => apiRequest(`${base}/records/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getDailyList: (code) => apiRequest(`${brandPath(code)}/daily-list`),
  createDailyList: (code) => apiRequest(`${brandPath(code)}/daily-list`, { method: 'POST' }),
  updateDailyAssignment: (id, body) => apiRequest(`${base}/daily-assignments/${encodeURIComponent(id)}`, { method: 'PUT', body }),
};
