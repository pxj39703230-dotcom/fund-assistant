const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function kbytes(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 1024).toFixed(1)} KB`;
}

Page({
  data: {
    apiBase: '',
    token: '',
    health: null,
    meta: null,
    lanUrls: [],
    ai: null,
    aiBase: '',
    aiModel: '',
    aiProvider: '',
    aiKey: '',
    aiTesting: false,
    aiError: '',
    syncStatus: '',
    backupPath: '',
    backupSize: '',
    watchlist: [],
    loading: true,
    error: '',
    savedText: '',
  },

  onLoad() {
    this.setData({
      apiBase: getApp().globalData.apiBase,
      token: getApp().globalData.token,
    });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [health, meta, ai, watch] = await Promise.all([
        api.health().catch(() => null),
        api.meta().catch(() => null),
        api.aiGet().catch(() => null),
        api.watchlist().catch(() => null),
      ]);
      this.setData({
        loading: false,
        health,
        meta,
        lanUrls: meta && meta.lanUrls ? meta.lanUrls : [],
        ai,
        aiBase: ai ? ai.baseUrl : '',
        aiModel: ai ? ai.model : '',
        aiProvider: ai ? ai.provider : '',
        aiKey: '',
        watchlist: watch && watch.items ? watch.items.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          reason: item.reason,
          score: item.score,
          grade: item.grade,
          status: item.status,
          coolingHours: item.coolingHours,
          statusLabel: item.status === 'cooling' ? `${item.coolingHours} 小时后可复看` : (item.status === 'ready' ? '冷静期已到，可复看' : (item.status === 'bought' ? '已买' : '已放弃')),
          canDecide: item.status === 'cooling' || item.status === 'ready',
        })) : [],
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '连接失败' });
    }
  },

  onBase(event) {
    this.setData({ apiBase: event.detail.value });
  },

  onToken(event) {
    this.setData({ token: event.detail.value });
  },

  saveBase() {
    const value = String(this.data.apiBase || '').trim().replace(/\/+$/, '');
    if (!/^http:\/\/[^\s]+$/.test(value) && !/^https:\/\/[^\s]+$/.test(value)) {
      wx.showToast({ title: '地址要以 http:// 或 https:// 开头', icon: 'none' });
      return;
    }
    getApp().setApiBase(value);
    getApp().setToken(this.data.token || '');
    this.setData({ apiBase: value });
    this.test();
  },

  test() {
    api.health().then((health) => {
      this.setData({ health, error: '' });
      wx.showToast({ title: `已连上 v${health.version}`, icon: 'success' });
    }).catch((error) => {
      this.setData({ error: error.message });
      wx.showToast({ title: '连接失败', icon: 'none' });
    });
  },

  copyUrl(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.url || '' });
  },

  useUrl(event) {
    this.setData({ apiBase: event.currentTarget.dataset.url || '' });
    this.saveBase();
  },

  sync() {
    if (this.data.syncStatus === '同步中…') return;
    this.setData({ syncStatus: '同步中…' });
    api.sync().then(() => {
      this.pollSync(0);
    }).catch((error) => {
      this.setData({ syncStatus: '' });
      wx.showToast({ title: error.message, icon: 'none' });
    });
  },

  pollSync(tries) {
    if (tries > 8) {
      this.setData({ syncStatus: '已启动，回首页刷新看结果' });
      return;
    }
    setTimeout(() => {
      api.jobLatest('sync').then((job) => {
        if (job && job.status === 'success') {
          this.setData({ syncStatus: '同步完成' });
          wx.showToast({ title: '净值已更新', icon: 'success' });
          return;
        }
        if (job && job.status === 'error') {
          this.setData({ syncStatus: `同步失败：${job.message || ''}` });
          return;
        }
        this.pollSync(tries + 1);
      }).catch(() => this.pollSync(tries + 1));
    }, 2000);
  },

  backup() {
    api.backup().then((data) => {
      this.setData({
        backupPath: data.path || '',
        backupSize: kbytes(data.size),
      });
      wx.showToast({ title: '已备份', icon: 'success' });
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  copyPath() {
    if (!this.data.backupPath) return;
    wx.setClipboardData({ data: this.data.backupPath });
  },

  goReview() {
    wx.navigateTo({ url: '/pages/review/review' });
  },

  goConstitution() {
    wx.navigateTo({ url: '/pages/constitution/constitution' });
  },

  onAiField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  saveAi() {
    const body = {
      baseUrl: String(this.data.aiBase || '').trim(),
      model: String(this.data.aiModel || '').trim(),
      provider: String(this.data.aiProvider || '').trim(),
      apiKey: String(this.data.aiKey || '').trim(),
    };
    api.aiSave(body).then((data) => {
      this.setData({
        ai: data,
        aiKey: '',
        aiError: '',
      });
      wx.showToast({ title: 'AI 配置已保存', icon: 'success' });
    }).catch((error) => {
      this.setData({ aiError: error.message });
      wx.showToast({ title: error.message, icon: 'none' });
    });
  },

  testAi() {
    if (this.data.aiTesting) return;
    this.setData({ aiTesting: true, aiError: '' });
    api.aiTest().then((data) => {
      this.setData({ aiTesting: false });
      wx.showToast({ title: `AI 可用：${data.reply || 'ok'}`, icon: 'success' });
    }).catch((error) => {
      this.setData({ aiTesting: false, aiError: error.message });
      wx.showToast({ title: 'AI 连不上', icon: 'none' });
    });
  },

  clearAiKey() {
    api.aiSave({ clearKey: true }).then((data) => {
      this.setData({ ai: data, aiKey: '' });
      wx.showToast({ title: '已清空 Key', icon: 'success' });
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  updateWatch(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    api.updateWatch(id, status).then(() => {
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },
});
