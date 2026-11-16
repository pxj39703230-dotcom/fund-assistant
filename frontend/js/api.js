const TOKEN_KEY = 'fund-assistant-api-token';
let authPrompt = null;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (error) {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
}

export function onAuthRequired(handler) {
  authPrompt = handler;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['X-API-Token'] = token;

  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new ApiError('无法连接服务，请确认 node 服务仍在运行', 0);
  }

  if (response.status === 401 && authPrompt) {
    const input = await authPrompt();
    if (input !== null && input !== undefined) {
      setToken(input.trim());
      return request(path, options);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = payload && payload.error ? payload.error.message : (typeof payload === 'string' ? payload : `请求失败（${response.status}）`);
    throw new ApiError(message, response.status);
  }
  return payload;
}

export const api = {
  meta: () => request('/api/meta'),
  health: () => request('/api/health'),
  portfolio: (refresh = false) => request(`/api/portfolio${refresh ? '?refresh=1' : ''}`),
  market: (refresh = false) => request(`/api/market${refresh ? '?refresh=1' : ''}`),
  holdings: () => request('/api/holdings'),
  addHolding: (body) => request('/api/holdings', { method: 'POST', body }),
  updateHolding: (id, body) => request(`/api/holdings/${id}`, { method: 'PUT', body }),
  deleteHolding: (id) => request(`/api/holdings/${id}`, { method: 'DELETE' }),
  previewFund: (code) => request(`/api/funds/${code}/preview`),
  history: (code, days = 30) => request(`/api/funds/${code}/history?days=${days}`),
  checkFund: (code) => request(`/api/funds/${code}/check`),
  assistantAsk: (question, code, style = 'coach') => request('/api/assistant/ask', { method: 'POST', body: { question, code, style } }),
  aiGet: () => request('/api/ai'),
  aiSave: (body) => request('/api/ai', { method: 'PUT', body }),
  aiTest: () => request('/api/ai/test', { method: 'POST' }),
  analysisOverview: () => request('/api/analysis/overview'),
  analysisDca: (code, amount, months) => request(`/api/analysis/dca?code=${code}&amount=${amount}&months=${months}`),
  constitution: () => request('/api/constitution'),
  saveConstitution: (body) => request('/api/constitution', { method: 'PUT', body }),
  checkConstitution: (body) => request('/api/constitution/check', { method: 'POST', body }),
  watchlist: () => request('/api/watchlist'),
  addWatch: (body) => request('/api/watchlist', { method: 'POST', body }),
  updateWatch: (id, status) => request(`/api/watchlist/${id}`, { method: 'PATCH', body: { status } }),
  deleteWatch: (id) => request(`/api/watchlist/${id}`, { method: 'DELETE' }),
  sync: () => request('/api/sync', { method: 'POST' }),
  jobLatest: (name = 'sync') => request(`/api/jobs/latest?name=${encodeURIComponent(name)}`),
  reviews: (type = '', limit = 10) => request(`/api/reviews?type=${encodeURIComponent(type)}&limit=${limit}`),
  generateReview: (type) => request(`/api/reviews/${type}`, { method: 'POST' }),
  alerts: (limit = 20) => request(`/api/alerts?limit=${limit}`),
  markAlertsRead: (ids) => request('/api/alerts/read', { method: 'POST', body: { ids } }),
};
