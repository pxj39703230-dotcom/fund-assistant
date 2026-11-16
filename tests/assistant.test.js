'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildRuleAnswer, extractAmount } = require('../backend/services/assistantService');

function portfolio(overrides = {}) {
  return {
    summary: { fundCount: 2, value: 1000, topWeight: 0.99, topFund: '国泰聚鑫' },
    positions: [
      {
        code: '110022',
        name: '易方达消费行业股票',
        profit: { realRate: 0.05, holdDays: 3, fees: { redemptionRate: 0.015 }, redemption: { optimization: { text: '再持有 4 天降到 0.75%' } } },
        advice: {
          urgency: 0,
          verdictLabel: '刚买入 3 天，先别动',
          action: '第 7 天再看',
          triggers: [{ label: '跌破就减仓', value: 2.003 }, { label: '20 日均线', value: 2.87 }],
        },
      },
    ],
    advice: { plan: { headline: '今天什么都不用做', flags: [{ title: '仓位集中', text: '单只占 99%' }] } },
    market: { stateLabel: '开盘前', indices: [{ name: '上证指数', price: 3655.83, pct: -0.67 }] },
  };
}

test('问买：带代码且已体检 → 返回体检结论', () => {
  const check = { name: '易方达消费行业股票', text: '纪律分 66/100', score: 66, grade: 'try' };
  const result = buildRuleAnswer({ question: '110022 能不能买', code: '110022', portfolio: portfolio(), check });
  assert.strictEqual(result.intent, 'check');
  assert.ok(result.answer.includes('纪律分'));
  assert.strictEqual(result.check, check);
});

test('问买：没给代码 → 先要代码，不瞎猜', () => {
  const result = buildRuleAnswer({ question: '我想买基金，有什么建议', portfolio: portfolio() });
  assert.strictEqual(result.intent, 'ask-code');
  assert.match(result.answer, /6 位基金代码/);
});

test('问卖 → 逐笔给结论和要盯的线', () => {
  const result = buildRuleAnswer({ question: '现在该卖吗', portfolio: portfolio() });
  assert.strictEqual(result.intent, 'sell');
  assert.match(result.answer, /刚买入 3 天/);
  assert.match(result.answer, /20 日均线/);
});

test('问仓位 → 给出集中度提示', () => {
  const result = buildRuleAnswer({ question: '我的仓位有问题吗', portfolio: portfolio() });
  assert.strictEqual(result.intent, 'position');
  assert.match(result.answer, /仓位集中|99.00%/);
});

test('问大盘 → 指数与交易状态', () => {
  const result = buildRuleAnswer({ question: '今天大盘怎么样', portfolio: portfolio() });
  assert.strictEqual(result.intent, 'market');
  assert.match(result.answer, /上证指数/);
  assert.match(result.answer, /开盘前/);
});

test('问费率 → 说明当前费档', () => {
  const result = buildRuleAnswer({ question: '赎回费怎么算', portfolio: portfolio() });
  assert.strictEqual(result.intent, 'fee');
  assert.match(result.answer, /1.50%/);
});

test('空组合问卖 → 引导先添加持仓', () => {
  const result = buildRuleAnswer({
    question: '现在该卖吗',
    portfolio: { positions: [], summary: {}, advice: { plan: {} } },
  });
  assert.strictEqual(result.intent, 'sell');
  assert.match(result.answer, /还没有持仓/);
});

test('没听懂 → 给出可问的句式', () => {
  const result = buildRuleAnswer({ question: '今天天气不错', portfolio: portfolio() });
  assert.strictEqual(result.intent, 'fallback');
  assert.match(result.answer, /110022 能不能买/);
});

test('问买：宪法不通过时结论必须先拦，不按体检等级放行', () => {
  const check = {
    name: '易方达消费行业股票',
    score: 66,
    grade: 'try',
    gradeLabel: '能买，但先小仓位',
    headline: '能买，但位置或波动一般',
    reasons: ['趋势偏强'],
    risks: [],
    plan: { firstAmount: 500, stopLoss: 0.1, lines: ['先买 500 元'] },
    constitution: {
      enabled: true,
      passed: false,
      blocked: true,
      headline: '宪法不通过：单只不超过 30%。买入后这只占 33.4%',
      rules: [{ key: 'weight', label: '单只不超过 30%', applicable: true, passed: false, detail: '买入后这只占 33.4%，超过上限' }],
    },
  };
  const result = buildRuleAnswer({ question: '110022 能不能买', code: '110022', portfolio: portfolio(), check });
  assert.match(result.answer, /按你的投资宪法，这笔先别买/);
  assert.match(result.answer, /宪法：不通过/);
  assert.match(result.answer, /单只不超过 30%/);
});

test('从问题里读出用户真正想买的金额，别拿默认 100 元糊弄', () => {
  assert.equal(extractAmount('110022 买 500 元行不行'), 500);
  assert.equal(extractAmount('110022 买1万块'), 10000);
  assert.equal(extractAmount('110022 能不能买'), null);
});
