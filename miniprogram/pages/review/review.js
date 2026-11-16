const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

const TYPES = [
  { key: 'daily', label: '每日' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
];

function mapReview(row) {
  const data = row.data || {};
  const summary = data.summary || {};
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    typeName: row.typeName,
    content: row.content || '',
    createdAt: fmt.dateTime(row.createdAt),
    metrics: summary.value == null ? null : [
      { label: '市值', value: fmt.money(summary.value) },
      { label: '真实盈亏', value: fmt.signedMoney(summary.realProfit), cls: fmt.tone(summary.realProfit) },
      { label: '净收益', value: fmt.signedMoney(summary.netProfit), cls: fmt.tone(summary.netProfit) },
      { label: '今日', value: fmt.signedMoney(summary.todayProfit), cls: fmt.tone(summary.todayProfit) },
    ],
  };
}

Page({
  data: {
    tabs: TYPES,
    type: 'daily',
    loading: true,
    generating: false,
    error: '',
    reviews: [],
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load();
  },

  switchType(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.setData({ type });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.reviews(this.data.type, 10);
      this.setData({
        loading: false,
        reviews: (Array.isArray(data) ? data : []).map(mapReview),
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '读取失败' });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  generate() {
    if (this.data.generating) return;
    this.setData({ generating: true });
    api.generateReview(this.data.type).then((data) => {
      this.setData({ generating: false });
      if (data && data.status === 'skipped') {
        wx.showToast({ title: data.message || '暂无持仓，跳过', icon: 'none' });
        return;
      }
      wx.showToast({ title: '复盘已生成', icon: 'success' });
      this.load();
    }).catch((error) => {
      this.setData({ generating: false });
      wx.showToast({ title: error.message, icon: 'none' });
    });
  },

  copyContent(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.text || '' });
  },
});
