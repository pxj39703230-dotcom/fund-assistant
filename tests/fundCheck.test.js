'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { checkFund, RULES } = require('../backend/domain/fundCheck');

function stats(overrides = {}) {
  return {
    sampleDays: 90,
    r20: 0.05,
    ma20: 1.05,
    ma50: 1.0,
    trendScore: 2,
    trendLabel: '偏强',
    ddFromPeak: -0.05,
    maxDrawdown: -0.12,
    volatility: 0.18,
    peakNav: 1.1,
    peakDate: '2026-09-01',
    ...overrides,
  };
}

test('体检：趋势强、回撤小、波动低 → 可以分批买', () => {
  const result = checkFund({
    code: '110022',
    name: '测试基金',
    stats: stats(),
    fees: { purchaseRate: 0.0015, redemptionShort: 0.015 },
    portfolio: { value: 1000, fundCount: 2, topWeight: 0.2 },
  });
  assert.strictEqual(result.grade, 'buy');
  assert.ok(result.score >= 72, `score=${result.score}`);
  assert.ok(result.plan.firstAmount >= 100);
  assert.match(result.headline, /分 2-3 次/);
});

test('体检：趋势转弱 + 深回撤 + 高波动 → 现在不建议买', () => {
  const result = checkFund({
    code: '161725',
    name: '某行业主题',
    stats: stats({ trendScore: -2, r20: -0.08, ddFromPeak: -0.24, volatility: 0.34 }),
    fees: { purchaseRate: 0.0015, redemptionShort: 0.015 },
  });
  assert.strictEqual(result.grade, 'avoid');
  assert.ok(result.score < 55);
  assert.ok(result.risks.some((item) => item.includes('趋势')));
});

test('体检：趋势一般 → 先小仓位试水', () => {
  const result = checkFund({
    code: '023313',
    name: '某混合',
    stats: stats({ trendScore: 1, r20: 0.01, ddFromPeak: -0.1, volatility: 0.2 }),
  });
  assert.ok(['try', 'buy'].includes(result.grade));
  if (result.grade === 'try') assert.match(result.headline, /小钱/);
});

test('体检：样本不足 → 不给结论', () => {
  const result = checkFund({ code: '110022', name: '新基金', stats: stats({ sampleDays: 5 }) });
  assert.strictEqual(result.grade, 'unknown');
  assert.strictEqual(result.plan, null);
  assert.match(result.headline, /样本不足/);
});

test('体检：买入计划有止损、止盈和分批约束', () => {
  const result = checkFund({
    code: '110022',
    name: '测试基金',
    stats: stats({ volatility: 0.3, trendScore: 3 }),
    portfolio: { value: 10000 },
  });
  assert.ok(result.plan.stopLoss >= 0.1 && result.plan.stopLoss <= 0.15);
  assert.ok(result.plan.targetProfit >= 0.2);
  assert.ok(result.plan.firstAmount <= 1000);
  assert.strictEqual(result.plan.batches, 3);
});

test('体检：组合集中度会被点名', () => {
  const result = checkFund({
    code: '110022',
    name: '测试基金',
    stats: stats(),
    portfolio: { value: 1000, fundCount: 2, topWeight: 0.6, topFund: '某基金' },
  });
  assert.ok(result.risks.some((item) => item.includes('集中')));
});
