function getBase() {
  const app = getApp();
  const base = (app && app.globalData && app.globalData.apiBase) || 'http://127.0.0.1:3000';
  return String(base).replace(/\/+$/, '');
}

function getToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || '';
}

function normalizeError(res) {
  const data = res && res.data;
  if (data && data.error && data.error.message) return data.error.message;
  if (typeof data === 'string' && data) return data.slice(0, 200);
  return `请求失败（${res && res.statusCode ? res.statusCode : '网络错误'}）`;
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const header = Object.assign({}, options.header || {});
    if (options.data !== undefined) header['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) header['X-API-Token'] = token;
    wx.request({
      url: getBase() + path,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: options.timeout || 60000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        if (res.statusCode === 401) {
          reject(new Error('需要访问口令，请到「我的」填写 API_TOKEN'));
          return;
        }
        reject(new Error(normalizeError(res)));
      },
      fail(err) {
        const msg = err && err.errMsg ? err.errMsg : '网络错误';
        reject(new Error(`连不上电脑上的服务（${msg}）。请确认后端已启动、手机与电脑同一 Wi-Fi，并在开发者工具关闭域名校验。`));
      },
    });
  });
}

const api = {
  health: () => request('/api/health'),
  meta: () => request('/api/meta'),
  portfolio: (refresh = false) => request(`/api/portfolio${refresh ? '?refresh=1' : ''}`),
  market: (refresh = false) => request(`/api/market${refresh ? '?refresh=1' : ''}`),
  holdings: () => request('/api/holdings'),
  addHolding: (body) => request('/api/holdings', { method: 'POST', data: body }),
  updateHolding: (id, body) => request(`/api/holdings/${id}`, { method: 'PUT', data: body }),
  deleteHolding: (id) => request(`/api/holdings/${id}`, { method: 'DELETE' }),
  previewFund: (code) => request(`/api/funds/${code}/preview`),
  checkFund: (code, amount) => request(`/api/funds/${code}/check${amount ? `?amount=${encodeURIComponent(amount)}` : ''}`),
  ask: (question, code, style) => request('/api/assistant/ask', { method: 'POST', data: { question, code, style } }),
  constitution: () => request('/api/constitution'),
  saveConstitution: (body) => request('/api/constitution', { method: 'PUT', data: body }),
  checkConstitution: (body) => request('/api/constitution/check', { method: 'POST', data: body }),
  watchlist: () => request('/api/watchlist'),
  addWatch: (body) => request('/api/watchlist', { method: 'POST', data: body }),
  updateWatch: (id, status) => request(`/api/watchlist/${id}`, { method: 'PATCH', data: { status } }),
  deleteWatch: (id) => request(`/api/watchlist/${id}`, { method: 'DELETE' }),
  reviews: (type, limit) => request(`/api/reviews?type=${encodeURIComponent(type || '')}&limit=${limit || 10}`),
  generateReview: (type) => request(`/api/reviews/${type}`, { method: 'POST' }),
  sync: () => request('/api/sync', { method: 'POST' }),
  jobLatest: (name) => request(`/api/jobs/latest?name=${encodeURIComponent(name || 'sync')}`),
  alerts: (limit) => request(`/api/alerts?limit=${limit || 20}`),
  markAlertsRead: (ids) => request('/api/alerts/read', { method: 'POST', data: { ids: ids || [] } }),
  aiGet: () => request('/api/ai'),
  aiSave: (body) => request('/api/ai', { method: 'PUT', data: body }),
  aiTest: () => request('/api/ai/test', { method: 'POST', timeout: 20000 }),
  backup: () => request('/api/backup', { method: 'POST' }),
};

module.exports = { request, api };
