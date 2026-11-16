const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function buildIndices(market) {
  return (market && market.indices ? market.indices : []).map((item) => ({
    name: item.name || '',
    price: fmt.num(item.price, 2),
    pctText: fmt.signedPctRaw(item.pct, 2),
    pctClass: fmt.tone(item.pct),
differential: false,
  }));
}

function buildSummary(summary) {
  return [
    { label: '累计投入', value: fmt.money(summary.invest), note: '买入金额合计', cls: '' },
    { label: '当前市值', value: fmt.money(summary.value), note: '净值 × 份额', cls: '' },
    { label: '真实盈亏', value: fmt.signedMoney(summary.realProfit), note: `${fmt.signedPct(summary.realRate)} · 已扣申购费`, cls: fmt.tone(summary.realProfit) },
    { label: '净收益', value: fmt.signedMoney(summary.netProfit), note: `${fmt.signedPct(summary.netRate)} · 扣赎回费后`, cls: fmt.tone(summary.netProfit) },
    { label: '今日盈亏', value: fmt.signedMoney(summary.todayProfit), note: '按最新日涨跌估算', cls: fmt.tone(summary.todayProfit) },
    { label: '持仓', value: `${summary.fundCount || 0} 只`, note: `${summary.holdingCount || 0} 笔 · ${summary.today || ''}`, cls: '' },
  ];
}

function buildWeights(positions, summary) {
  const total = Number(summary.value) || 0;
  const colors = ['#0f766e', '#f59e0b', '#64748b', '#94a3b8', '#cbd5e1'];
  const items = (positions || [])
    .slice()
    .sort((a, b) => Number(b.profit.currentValue) - Number(a.profit.currentValue))
    .map((p, i) => ({
      code: p.code,
      name: p.name,
      width: total > 0 ? Math.max(1, Math.round((Number(p.profit.currentValue) / total) * 1000) / 10) : 0,
      color: colors[i % colors.length],
      label: `${p.name} ${total > 0 ? ((Number(p.profit.currentValue) / total) * 100).toFixed(1) : '0.0'}%`,
    }));
  return items;
}

function buildPositions(positions) {
  return (positions || []).map((p) => {
    const advice = p.advice || {};
    const triggers = (advice.triggers || []).slice(0, 2).map((t) => `${t.label} ${t.value}`);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      valueText: fmt.money(p.profit.currentValue),
      costText: fmt.money(p.buyAmount),
      realText: fmt.signedMoney(p.profit.realProfit),
      realClass: fmt.tone(p.profit.realProfit),
      rateText: fmt.signedPct(p.profit.realRate),
      todayText: fmt.signedMoney(p.todayProfit),
      todayClass: fmt.tone(p.todayProfit),
      holdDays: p.profit.holdDays,
      navText: `${fmt.num(p.currentNav, 4)} / 买入 ${fmt.num(p.buyNav, 4)}`,
      verdict: advice.verdictLabel || '先观察',
      tone: advice.tone || 'info',
      action: advice.action || '',
      triggers,
      stale: Boolean(p.stale),
    };
  });
}

function buildConstitution(data) {
  if (!data || !data.rules) return null;
  const rules = data.rules;
  return {
    enabled: Boolean(rules.enabled),
    items: [
      { label: '单只占比', value: `≤ ${rules.maxSingleWeight}%` },
      { label: '单笔亏损', value: `≤ ${rules.maxLossPerBuy} 元` },
      { label: '新基金首笔', value: `≤ ${rules.maxFirstBuy} 元` },
      { label: '体检分', value: `≥ ${rules.minCheckScore} 分` },
      { label: '基金只数', value: `≤ ${rules.maxFunds} 只` },
    ],
    audit: (data.audit && data.audit.items ? data.audit.items : []).map((item) => ({
      label: item.label,
      text: item.text,
      level: item.level || 'warn',
      cls: item.level === 'info' ? 'info' : 'warn',
    })),
  };
}

Page({
  data: {
    loading: true,
    error: '',
    version: '',
    today: '',
    updatedText: '',
    market: null,
    indices: [],
    metrics: [],
    weights: [],
    alerts: [],
    plan: null,
    positions: [],
    constitution: null,
    summaryNote: '',
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
      const [portfolio, health, meta] = await Promise.all([
        api.portfolio(refresh),
        api.health().catch(() => null),
        api.meta().catch(() => null),
      ]);
      const summary = portfolio.summary || {};
      const market = portfolio.market || {};
      const plan = portfolio.advice ? portfolio.advice.plan : null;
      const positions = buildPositions(portfolio.positions || []);
      this.setData({
        loading: false,
        error: '',
        version: (health && health.version) || (meta && meta.version) || '',
        today: summary.today || (portfolio.meta && portfolio.meta.today) || '',
        updatedText: portfolio.meta && portfolio.meta.updatedAt ? fmt.dateTime(portfolio.meta.updatedAt) : '尚未同步',
        market: market,
        indices: buildIndices(market),
        metrics: buildSummary(summary),
        weights: buildWeights(portfolio.positions || [], summary),
        alerts: (portfolio.alerts || []).slice(0, 3).map((a) => ({
          id: a.id,
          title: a.title,
          message: a.message,
          cls: a.level === 'critical' ? 'danger' : (a.level === 'warn' ? 'warn' : 'info'),
        })),
        plan,
        positions,
        constitution: buildConstitution(portfolio.constitution),
        summaryNote: `真实盈亏扣申购费；净收益按现在全部赎回、扣赎回费后测算。管理费/托管费已含在净值里，不重复扣。`,
      });
      this.loaded = true;
      this.lastLoad = Date.now();
    } catch (error) {
      this.setData({ loading: false, error: error.message || '加载失败' });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  goRefresh() {
    this.load(true);
  },

  goCheck() {
    wx.navigateTo({ url: '/pages/check/check' });
  },

  goConstitution() {
    wx.navigateTo({ url: '/pages/constitution/constitution' });
  },

  goReview() {
    wx.navigateTo({ url: '/pages/review/review' });
  },

  goAsk() {
    wx.switchTab({ url: '/pages/ask/ask' });
  },

  goPositions() {
    wx.switchTab({ url: '/pages/positions/positions' });
  },

  goPosition(event) {
    const code = event.currentTarget.dataset.code;
    wx.navigateTo({ url: `/pages/check/check?code=${code}` });
  },

  markAlertsRead() {
    const ids = this.data.alerts.map((a) => a.id);
    api.markAlertsRead(ids).then(() => {
      this.setData({ alerts: [] });
      wx.showToast({ title: '已读', icon: 'success' });
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },
});
