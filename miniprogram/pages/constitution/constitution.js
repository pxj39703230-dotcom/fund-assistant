const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function mapRules(rules) {
  return {
    enabled: Boolean(rules.enabled),
    maxSingleWeight: String(rules.maxSingleWeight),
    maxLossPerBuy: String(rules.maxLossPerBuy),
    maxFirstBuy: String(rules.maxFirstBuy),
    minCheckScore: String(rules.minCheckScore),
    maxFunds: String(rules.maxFunds),
  };
}

function mapResult(constitution) {
  if (!constitution) return null;
  return {
    enabled: Boolean(constitution.enabled),
    passed: Boolean(constitution.passed),
    level: constitution.level || 'unknown',
    headline: constitution.headline || '',
    amount: constitution.amount == null ? '—' : fmt.money(constitution.amount, 0),
    mode: constitution.mode === 'add' ? '加仓' : '首笔买入',
    postWeight: constitution.postWeight == null ? '—' : `${fmt.num(constitution.postWeight * 100, 1)}%`,
    failed: constitution.failed || [],
    rules: (constitution.rules || []).filter((r) => r.applicable !== false).map((r) => ({
      key: r.key,
      label: r.label,
      detail: r.detail,
      passed: Boolean(r.passed),
      cls: r.passed ? 'ok' : 'bad',
    })),
    cls: constitution.passed ? 'ok' : 'error',
  };
}

Page({
  data: {
    loading: true,
    error: '',
    savedText: '',
    form: {
      enabled: true,
      maxSingleWeight: '30',
      maxLossPerBuy: '50',
      maxFirstBuy: '300',
      minCheckScore: '55',
      maxFunds: '5',
    },
    audit: [],
    auditLevel: '',
    testCode: '110022',
    testAmount: '100',
    testLoading: false,
    testError: '',
    result: null,
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [data, portfolio] = await Promise.all([
        api.constitution(),
        api.portfolio().catch(() => null),
      ]);
      const form = mapRules(data.rules || {});
      const audit = portfolio && portfolio.constitution && portfolio.constitution.audit
        ? portfolio.constitution.audit
        : null;
      this.setData({
        loading: false,
        form,
        savedText: data.updatedAt ? fmt.dateTime(data.updatedAt) : '',
        audit: audit && audit.items ? audit.items.map((item) => ({
          label: item.label,
          text: item.text,
          cls: item.level === 'info' ? 'info' : 'warn',
        })) : [],
        auditLevel: audit ? audit.level : '',
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '读取失败' });
    }
  },

  onNumber(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: String(event.detail.value || '').replace(/[^0-9.]/g, '') });
  },

  onEnabled(event) {
    this.setData({ 'form.enabled': Boolean(event.detail.value) });
  },

  save() {
    const f = this.data.form;
    const body = {
      enabled: Boolean(f.enabled),
      maxSingleWeight: Number(f.maxSingleWeight),
      maxLossPerBuy: Number(f.maxLossPerBuy),
      maxFirstBuy: Number(f.maxFirstBuy),
      minCheckScore: Number(f.minCheckScore),
      maxFunds: Number(f.maxFunds),
    };
    api.saveConstitution(body).then((data) => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({
        form: mapRules(data.rules || {}),
        savedText: data.updatedAt ? fmt.dateTime(data.updatedAt) : '',
      });
      this.load();
    }).catch((error) => wx.showToast({ title: error.message, icon: 'none' }));
  },

  onTestCode(event) {
    this.setData({ testCode: String(event.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  onTestAmount(event) {
    this.setData({ testAmount: String(event.detail.value || '').replace(/[^0-9.]/g, '') });
  },

  async testBuy() {
    const code = this.data.testCode.trim();
    const amount = Number(this.data.testAmount);
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: '先填 6 位基金代码', icon: 'none' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: '金额要大于 0', icon: 'none' });
      return;
    }
    this.setData({ testLoading: true, testError: '', result: null });
    try {
      const data = await api.checkConstitution({ code, amount });
      this.setData({
        testLoading: false,
        result: mapResult(data.constitution),
      });
    } catch (error) {
      this.setData({ testLoading: false, testError: error.message || '核对失败' });
    }
  },
});
