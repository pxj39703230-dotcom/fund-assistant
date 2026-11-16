const { api } = require('../../utils/api');
const fmt = require('../../utils/format');

function mapCheck(check) {
  if (!check) return null;
  const c = check.constitution || null;
  return {
    name: check.name,
    code: check.code,
    score: check.score == null ? '—' : String(check.score),
    gradeLabel: check.gradeLabel || '',
    headline: check.headline || '',
    blocked: Boolean(c && c.enabled && c.passed === false),
    constitutionHeadline: c ? c.headline : '',
    tone: check.tone || 'info',
  };
}

Page({
  data: {
    code: '',
    input: '',
    style: 'coach',
    styleLabel: '详细',
    sending: false,
    messages: [
      {
        id: 'hello',
        role: 'bot',
        title: '新手教练',
        text: '我是你基金助手里的教练，不预测涨跌，只按你的钱、你的持仓和你的投资宪法说话。\n你可以直接问：这只能不能买、我该不该卖、今天跌了要不要割。',
        check: null,
      },
    ],
    quick: [
      '110022 买 500 元行不行？',
      '我现在该不该卖？',
      '为什么我的组合一直在亏？',
      '今天大盘跌，我要不要割？',
    ],
    scrollInto: '',
  },

  onShow() {
    const code = getApp().globalData.lastCheckCode;
    if (code) {
      getApp().globalData.lastCheckCode = '';
      this.setData({ code: String(code) });
    }
  },

  onCodeInput(event) {
    this.setData({ code: String(event.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  onInput(event) {
    this.setData({ input: event.detail.value });
  },

  toggleStyle() {
    const next = this.data.style === 'coach' ? 'brief' : 'coach';
    this.setData({ style: next, styleLabel: next === 'coach' ? '详细' : '简洁' });
  },

  useQuick(event) {
    const text = event.currentTarget.dataset.text;
    this.ask(text);
  },

  send() {
    const text = String(this.data.input || '').trim();
    if (!text) {
      wx.showToast({ title: '先写一句想问的', icon: 'none' });
      return;
    }
    this.ask(text);
  },

  async ask(question) {
    if (this.data.sending) return;
    const userMsg = { id: `u${Date.now()}`, role: 'user', text: question, title: '', check: null };
    const messages = this.data.messages.concat([userMsg]);
    this.setData({ messages, input: '', sending: true });
    this.scrollBottom();
    try {
      const response = await api.ask(question, this.data.code, this.data.style);
      const botMsg = {
        id: `b${Date.now()}`,
        role: 'bot',
        title: response.title || '新手教练',
        text: response.answer || '这次没拿到回答，稍后再问一次。',
        modeLabel: response.mode === 'brief' ? '简洁' : (response.mode ? '详细' : ''),
        check: mapCheck(response.check),
      };
      this.setData({ messages: this.data.messages.concat([botMsg]), sending: false });
      this.scrollBottom();
    } catch (error) {
      const botMsg = {
        id: `e${Date.now()}`,
        role: 'bot',
        title: '没连上',
        text: error.message || '请求失败。请确认电脑后端已启动，并且手机和电脑在同一 Wi-Fi。',
        check: null,
      };
      this.setData({ messages: this.data.messages.concat([botMsg]), sending: false });
      this.scrollBottom();
    }
  },

  scrollBottom() {
    wx.nextTick(() => {
      wx.pageScrollTo({ scrollTop: 10000, duration: 200 });
    });
  },

  copyText(event) {
    const text = event.currentTarget.dataset.text;
    wx.setClipboardData({ data: text });
  },

  goCheck() {
    const code = this.data.code || '110022';
    wx.navigateTo({ url: `/pages/check/check?code=${code}` });
  },
});
