const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function todayString() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

Page({
  data: {
    isEdit: false,
    id: null,
    loading: false,
    error: '',
    name: '',
    previewHint: '',
    form: {
      code: '',
      buyDate: '',
      buyAmount: '',
      buyNetValue: '',
      targetProfit: '30',
      stopLoss: '20',
      strategy: 'auto',
      note: '',
    },
    strategyOptions: ['自动判断', '长线持有', '波段操作'],
    strategyIndex: 0,
  },

  onLoad(query) {
    this.setData({ 'form.buyDate': todayString() });
    if (query.id) {
      this.setData({ isEdit: true, id: Number(query.id) });
      wx.setNavigationBarTitle({ title: '编辑持仓纪律' });
      this.loadEdit();
    }
  },

  async loadEdit() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.holdings();
      const list = Array.isArray(data) ? data : (data.items || []);
      const item = list.find((row) => Number(row.id) === this.data.id);
      if (!item) throw new Error('没有找到这笔持仓');
      const strategyIndex = item.strategy === 'long' ? 1 : (item.strategy === 'swing' ? 2 : 0);
      this.setData({
        loading: false,
        name: item.fundName || '',
        strategyIndex,
        form: {
          code: item.fundCode,
          buyDate: item.buyDate,
          buyAmount: String(item.buyAmount),
          buyNetValue: String(item.buyNetValue),
          targetProfit: String(Math.round(Number(item.targetProfit) * 100)),
          stopLoss: String(Math.round(Math.abs(Number(item.stopLoss)) * 100)),
          strategy: item.strategy || 'auto',
          note: item.note || '',
        },
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '读取失败' });
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onCodeInput(event) {
    this.setData({ 'form.code': String(event.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  onDate(event) {
    this.setData({ 'form.buyDate': event.detail.value });
  },

  onStrategy(event) {
    const index = Number(event.detail.value);
    const value = ['auto', 'long', 'swing'][index] || 'auto';
    this.setData({ strategyIndex: index, 'form.strategy': value });
  },

  async preview() {
    const code = this.data.form.code;
    if (!/^\d{6}$/.test(code)) return;
    try {
      const data = await api.previewFund(code);
      const patch = {
        name: data.name || '',
        previewHint: `${data.name || code} · ${data.navDate || ''} 净值 ${fmt.num(data.netValue, 4)}`,
      };
      if (!this.data.isEdit && !this.data.form.buyNetValue) {
        patch['form.buyNetValue'] = data.netValue == null ? '' : String(data.netValue);
      }
      this.setData(patch);
    } catch (error) {
      this.setData({ previewHint: '' });
    }
  },

  submit() {
    const f = this.data.form;
    if (!/^\d{6}$/.test(f.code)) {
      wx.showToast({ title: '基金代码要 6 位', icon: 'none' });
      return;
    }
    if (!f.buyDate) {
      wx.showToast({ title: '选买入日期', icon: 'none' });
      return;
    }
    const amount = Number(f.buyAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: '买入金额要大于 0', icon: 'none' });
      return;
    }
    const nav = Number(f.buyNetValue);
    if (!Number.isFinite(nav) || nav <= 0) {
      wx.showToast({ title: '买入净值要大于 0', icon: 'none' });
      return;
    }
    const target = Number(f.targetProfit);
    const stop = Number(f.stopLoss);
    if (!Number.isFinite(target) || target < 0 || target > 200) {
      wx.showToast({ title: '止盈填 0-200 之间', icon: 'none' });
      return;
    }
    if (!Number.isFinite(stop) || stop < 0 || stop > 100) {
      wx.showToast({ title: '止损填 0-100 之间', icon: 'none' });
      return;
    }

    this.setData({ loading: true, error: '' });
    const body = {
      targetProfit: target / 100,
      stopLoss: stop / 100,
      strategy: f.strategy,
      note: f.note || '',
    };
    const task = this.data.isEdit
      ? api.updateHolding(this.data.id, body)
      : api.addHolding({
        fundCode: f.code,
        buyDate: f.buyDate,
        buyAmount: amount,
        buyNetValue: nav,
        targetProfit: target / 100,
        stopLoss: stop / 100,
        strategy: f.strategy,
        note: f.note || '',
      });
    task.then(() => {
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已添加', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '保存失败' });
    });
  },
});
