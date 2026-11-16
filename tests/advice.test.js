'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { computeStats, inferStrategy, decide, buildPlan } = require('../backend/domain/advice');

function series(values) {
  const start = new Date(Date.UTC(2026, 0, 1));
  return values.map((nav, index) => {
    const d = new Date(start.getTime() + index * 86400000 * 1);
    return { date: d.toISOString().slice(0, 10), netValue: nav };
  });
}

function position(overrides = {}) {
  const profit = {
    realRate: 0.05,
    holdDays: 60,
    currentValue: 1050,
    shares: 100,
    principal: 1000,
    fees: { redemptionRate: 0.005 },
    redemption: { optimization: { worthWaiting: false, daysToWait: 0, savedAmount: 0, text: '已是最低档' } },
    ...(overrides.profit || {}),
  };
  return {
    id: 1,
    code: '110022',
    name: '测试基金',
    buyDate: '2026-06-01',
    buyAmount: 1000,
    priced: true,
    targetProfit: 0.3,
    stopLoss: 0.2,
    ...overrides,
    profit,
  };
}

test('computeStats：连续上涨 → 趋势偏强、无回撤', () => {
  const rows = series(Array.from({ length: 60 }, (_, i) => 1 + i * 0.01));
  const stats = computeStats(rows, { buyDate: rows[0].date });
  assert.strictEqual(stats.sampleDays, 60);
  assert.strictEqual(stats.trendScore, 3);
  assert.strictEqual(stats.trendLabel, '偏强');
  assert.ok(stats.aboveMa20 && stats.aboveMa50);
  assert.ok(Math.abs(stats.ddFromPeak) < 1e-9);
  assert.ok(stats.volatility >= 0);
});

test('computeStats：从高点回落 15% → 回撤被识别', () => {
  const values = Array.from({ length: 50 }, (_, i) => 1 + i * 0.01);
  values.push(1.2);
  values.push(1.02);
  const rows = series(values);
  const stats = computeStats(rows, { buyDate: rows[0].date });
  assert.ok(stats.ddFromPeak < -0.14, `dd=${stats.ddFromPeak}`);
  assert.ok(stats.maxDrawdown <= stats.ddFromPeak);
});

test('computeStats：空数据不炸', () => {
  const stats = computeStats([], {});
  assert.strictEqual(stats.sampleDays, 0);
  assert.strictEqual(stats.trendLabel, '数据不足');
});

test('inferStrategy：债券/指数=长线，消费=波段，高波动=波段', () => {
  assert.strictEqual(inferStrategy({ name: '某某纯债债券A' }).strategy, 'long');
  assert.strictEqual(inferStrategy({ name: '沪深300指数A' }).strategy, 'long');
  assert.strictEqual(inferStrategy({ name: '易方达消费行业股票' }).strategy, 'swing');
  assert.strictEqual(inferStrategy({ name: '某成长混合', volatility: 0.3 }).strategy, 'swing');
  assert.strictEqual(inferStrategy({ name: '某稳健混合', volatility: 0.1 }).strategy, 'long');
});

test('decide：跌破止损线 → 止损离场，紧迫度 3', () => {
  const p = position({
    profit: { realRate: -0.23, holdDays: 40, currentValue: 770, shares: 100, principal: 1000 },
  });
  const stats = computeStats(series(Array.from({ length: 60 }, (_, i) => 1.4 - i * 0.008)), { buyDate: '2026-01-01' });
  const adv = decide({ position: p, stats, strategy: 'long' });
  assert.strictEqual(adv.verdict, 'exit');
  assert.strictEqual(adv.urgency, 3);
  assert.match(adv.action, /卖一半/);
});

test('decide：触发止盈且长线趋势强 → 卖一半，留一半', () => {
  const p = position({
    profit: { realRate: 0.35, holdDays: 200, currentValue: 1350, shares: 100, principal: 1000 },
  });
  const stats = computeStats(series(Array.from({ length: 60 }, (_, i) => 1 + i * 0.01)), { buyDate: '2026-01-01' });
  const adv = decide({ position: p, stats, strategy: 'long' });
  assert.strictEqual(adv.verdict, 'take-profit');
  assert.match(adv.verdictLabel, /止盈一半/);
  assert.match(adv.action, /卖一半/);
});

test('decide：刚买入 3 天（赎回费 1.5%）→ 先别动', () => {
  const p = position({
    buyDate: '2026-11-10',
    profit: { realRate: -0.01, holdDays: 3, currentValue: 990, shares: 100, principal: 1000, fees: { redemptionRate: 0.015 } },
  });
  const stats = computeStats(series(Array.from({ length: 60 }, (_, i) => 1 + i * 0.005)), { buyDate: '2026-11-10' });
  const adv = decide({ position: p, stats, strategy: 'long' });
  assert.strictEqual(adv.verdict, 'watch');
  assert.match(adv.verdictLabel, /先别动/);
});

test('decide：样本不足 → 观察', () => {
  const p = position({ profit: { realRate: 0.02, holdDays: 5, currentValue: 1020, shares: 100, principal: 1000 } });
  const adv = decide({ position: p, stats: computeStats(series([1, 1.01, 1.02, 1.01, 1.03]), {}), strategy: 'long' });
  assert.strictEqual(adv.verdict, 'watch');
});

test('decide：波段仓位跌破均线 → 减仓一半', () => {
  const p = position({
    profit: { realRate: 0.02, holdDays: 45, currentValue: 1020, shares: 100, principal: 1000 },
  });
  const values = Array.from({ length: 50 }, (_, i) => 1.4 - i * 0.004);
  values.push(1.14);
  const stats = computeStats(series(values), { buyDate: '2026-01-01' });
  const adv = decide({ position: p, stats, strategy: 'swing' });
  assert.ok(['trim', 'reduce-risk'].includes(adv.verdict), adv.verdict);
});

test('decide：正常持有 → 什么都不用做', () => {
  const p = position({});
  const stats = computeStats(series(Array.from({ length: 60 }, (_, i) => 1 + i * 0.002)), { buyDate: '2026-01-01' });
  const adv = decide({ position: p, stats, strategy: 'long' });
  assert.strictEqual(adv.verdict, 'hold');
  assert.strictEqual(adv.urgency, 0);
});

test('buildPlan：都是 hold → 今天什么都不用做', () => {
  const adviceList = [
    { code: '110022', name: 'A', verdict: 'hold', verdictLabel: '什么都不用做', tone: 'good', urgency: 0, headline: '长线仓位', action: '不需要操作' },
    { code: '161725', name: 'B', verdict: 'hold', verdictLabel: '什么都不用做', tone: 'good', urgency: 0, headline: '长线仓位', action: '不需要操作' },
  ];
  const plan = buildPlan({ positions: [{}, {}], summary: { topWeight: 0.6, topFund: 'A' }, market: {}, adviceList });
  assert.match(plan.headline, /今天什么都不用做/);
  assert.strictEqual(plan.actions.length, 0);
});

test('buildPlan：有紧迫动作 → 汇总成待办', () => {
  const adviceList = [
    { code: '110022', name: 'A', verdict: 'exit', verdictLabel: '止损离场', tone: 'danger', urgency: 3, headline: '跌破止损', action: '今天卖一半' },
    { code: '161725', name: 'B', verdict: 'hold', verdictLabel: '持有', tone: 'good', urgency: 0, headline: '持有', action: '不动' },
  ];
  const plan = buildPlan({ positions: [{}, {}], summary: {}, market: {}, adviceList });
  assert.match(plan.headline, /需要处理/);
  assert.strictEqual(plan.actions.length, 1);
  assert.strictEqual(plan.stats.risk, 1);
});

test('buildPlan：空仓给出引导', () => {
  const plan = buildPlan({ positions: [], summary: {}, market: {}, adviceList: [] });
  assert.match(plan.headline, /还没有持仓/);
});
