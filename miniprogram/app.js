App({
  globalData: {
    apiBase: 'http://127.0.0.1:3000',
    token: '',
    version: '',
  },

  onLaunch() {
    const base = wx.getStorageSync('apiBase');
    const token = wx.getStorageSync('apiToken');
    if (base) this.globalData.apiBase = String(base).replace(/\/+$/, '');
    if (token) this.globalData.token = String(token);
  },

  setApiBase(value) {
    const base = String(value || '').trim().replace(/\/+$/, '');
    this.globalData.apiBase = base;
    wx.setStorageSync('apiBase', base);
  },

  setToken(value) {
    const token = String(value || '').trim();
    this.globalData.token = token;
    wx.setStorageSync('apiToken', token);
  },
});
