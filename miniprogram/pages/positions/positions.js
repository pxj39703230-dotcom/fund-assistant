const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function buildPosition(p) {
  const advice = p.advice || {};
  const fees = p.profit.fees || {};
  const optimization = p.profit.redemption && p.profit.redemption.optimization;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    buyDate: p.buyDate,
    holdDays: p.profit.holdDays,
    buyAmount: fmt.money(p.buyAmount),
    valueText: fmt.money(p.profit.currentValue),
    shares: fmt.num(p.shares, 2),
    buyNav: fmt.num(p.buyNav, 4),
    nav: fmt.num(p.currentNav, 4),
    navDate: p.navDate || '—',
    realText: fmt.signedMoney(p.profit.realProfit),
    realClass: fmt.tone(p.profit.realProfit),
    realRate: fmt.signedPct(p.profit.realRate),
    bookText: fmt.signedMoney(p.profit.bookProfit),
    netText: fmt.signedMoney(p.profit.netProfit),
    purchaseFee: fmt.money(fees.purchaseFee),
    redemptionFee: fmt.money(fees.redemptionFee),
    redemptionRate: fmt.pct(fees.redemptionRate),
    feeHint: optimization && optimization.worthWaiting ? optimization.text : '',
    verdict: advice.verdictLabel || '先观察',
    tone: advice.tone || 'info',
    action: advice.action || '',
    headline: advice.headline || '',
    triggers: (advice.triggers || []).map((t) => `${t.label} ${t.value}`),
    stale: Boolean(p.stale),
    staleDays: p.staleDays || 0,
    error: p.error || '',
  };
}

Page({
  data: {
    loading: true,
    error: '',
    positions: [],
    summary: null,
    updatedText: '',
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (this.loaded && Date.now() - (this.lastLoad || 0) > 60000) this.load();
  },

  onPullDownRefresh() {
    this.load(true);
  },

  async load(refresh = false) {
    this.setData({ loading: true, error: '' });
    try {
      const portfolio = await api.portfolio(refresh);
      const summary = portfolio.summary || {};
      this.setData({
        loading: false,
        positions: (portfolio.positions || []).map(buildPosition),
        summary: {
          value: fmt.money(summary.value),
          invest: fmt.money(summary.invest),
          real: fmt.signedMoney(summary.realProfit),
          realClass: fmt.tone(summary.realProfit),
          rate: fmt.signedPct(summary.realRate),
          net: fmt.signedMoney(summary.netProfit),
          netClass: fmt.tone(summary.netProfit),
          funds: summary.fundCount || 0,
          count: summary.holdingCount || 0,
        },
        updatedText: portfolio.meta && portfolio.meta.updatedAt ? fmt.dateTime(portfolio.meta.updatedAt) : '尚未同步',
      });
      this.loaded = true;
      this.lastLoad = Date.now();
    } catch (error) {
      this.setData({ loading: false, error: error.message || '加载失败' });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/holding/holding' });
  },

  goEdit(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/holding/holding?id=${id}` });
  },

  goCheck(event) {
    const code = event.currentTarget.dataset.code;
    wx.navigateTo({ url: `/pages/check/check?code=${code}` });
  },

  deleteOne(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name;
    wx.showModal({
      title: '删除持仓',
      content: `确定删除「${name}」这笔记录吗？删除后不可恢复，基金数据本身还在。`,
      confirmColor: '#b42318',
      success: (res) => {
        if (!res.confirm) return;
        api.deleteHolding(id).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load(true);
        }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
      },
    });
  },
});
