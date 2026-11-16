const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function mapResult(data) {
  const consti = data.constitution || null;
  const blocked = Boolean(consti && consti.enabled && consti.passed === false);
  const rules = consti && Array.isArray(consti.rules)
    ? consti.rules
      .filter((r) => r.applicable !== false)
      .map((r) => ({
        key: r.key,
        label: r.label,
        detail: r.detail,
        passed: Boolean(r.passed),
        cls: r.passed ? 'ok' : 'bad',
      }))
    : [];
  return {
    code: data.code,
    name: data.name || data.code,
    score: data.score,
    scoreText: data.score == null ? '—' : String(data.score),
    grade: data.grade,
    gradeLabel: data.gradeLabel || '先观察',
    tone: data.tone || 'info',
    headline: data.headline || '',
    text: data.text || '',
    reasons: data.reasons || [],
    risks: data.risks || [],
    nav: data.nav,
    navText: data.nav == null ? '—' : fmt.num(data.nav, 4),
    navDate: data.navDate || '—',
    growthText: data.growthRate == null ? '—' : fmt.signedPct(data.growthRate),
    growthClass: fmt.tone(data.growthRate),
    estimate: data.estimate ? {
      nav: fmt.num(data.estimate.nav, 4),
      pct: data.estimate.pct == null ? '—' : fmt.signedPctRaw(data.estimate.pct, 2),
      pctClass: fmt.tone(data.estimate.pct),
      time: data.estimate.time || '',
    } : null,
    plan: data.plan ? {
      firstAmount: fmt.money(data.plan.firstAmount, 0),
      batches: data.plan.batches,
      stopLoss: fmt.pct(data.plan.stopLoss, 0),
      targetProfit: fmt.pct(data.plan.targetProfit, 0),
      holdHint: data.plan.holdHint,
      lines: data.plan.lines || [],
    } : null,
    blocked,
    constitution: consti ? {
      enabled: Boolean(consti.enabled),
      level: consti.level,
      headline: consti.headline || '',
      amount: consti.amount == null ? null : fmt.money(consti.amount, 0),
      mode: consti.mode === 'add' ? '加仓' : '首笔买入',
      postWeight: consti.postWeight == null ? '—' : `${fmt.num(consti.postWeight * 100, 1)}%`,
      failed: consti.failed || [],
      rules,
      audit: (consti.audit && consti.audit.items ? consti.audit.items : []).map((item) => ({
        label: item.label,
        text: item.text,
        cls: item.level === 'info' ? 'info' : 'warn',
      })),
    } : null,
    checkedAt: data.checkedAt || '',
  };
}

Page({
  data: {
    code: '',
    amount: '',
    name: '',
    navText: '',
    loading: false,
    error: '',
    result: null,
    watchReason: '',
    watchScore: null,
    watchGrade: '',
  },

  onLoad(query) {
    if (query.code) {
      this.setData({ code: String(query.code) });
      this.preview();
    }
    if (query.amount) this.setData({ amount: String(query.amount) });
  },

  onCodeInput(event) {
    this.setData({ code: String(event.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  onAmountInput(event) {
    this.setData({ amount: String(event.detail.value || '').replace(/[^0-9.]/g, '') });
  },

  async preview() {
    const code = this.data.code;
    if (!/^\d{6}$/.test(code)) return;
    try {
      const data = await api.previewFund(code);
      this.setData({
        name: data.name || '',
        navText: data.netValue == null ? '' : fmt.num(data.netValue, 4),
      });
    } catch (error) {
      // 预览失败不挡体检，用户仍可继续
    }
  },

  async runCheck() {
    const code = this.data.code.trim();
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: '先填 6 位基金代码', icon: 'none' });
      return;
    }
    this.setData({ loading: true, error: '', result: null });
    try {
      const data = await api.checkFund(code, this.data.amount.trim());
      const result = mapResult(data);
      this.setData({
        loading: false,
        name: result.name,
        result,
        watchScore: result.score,
        watchGrade: result.gradeLabel,
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '体检失败' });
    }
  },

  onWatchReason(event) {
    this.setData({ watchReason: event.detail.value });
  },

  addWatch() {
    const result = this.data.result;
    if (!result) return;
    const targetNav = result.nav == null ? null : Number(result.nav);
    api.addWatch({
      code: result.code,
      name: result.name,
      targetNav,
      reason: this.data.watchReason || '体检后先放一晚',
      score: result.score,
      grade: result.gradeLabel,
    }).then(() => {
      wx.showToast({ title: '已放进冷静期', icon: 'success' });
      this.setData({ watchReason: '' });
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  goAsk() {
    getApp().globalData.lastCheckCode = this.data.result ? this.data.result.code : this.data.code;
    wx.switchTab({ url: '/pages/ask/ask' });
  },

  goConstitution() {
    wx.navigateTo({ url: '/pages/constitution/constitution' });
  },
});
