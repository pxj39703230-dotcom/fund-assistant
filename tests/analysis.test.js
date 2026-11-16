'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { simulateDca, compareBenchmark, attribute, comparePlans } = require('../backend/domain/analysis');

function monthlyNav(startNav, endNav, months = 12) {
  const rows = [];
  for (let m = 0; m < months; m += 1) {
    for (let d = 1; d <= 5; d += 1) {
      const year = 2025 + Math.floor(m / 12);
      const month = (m % 12) + 1;
      const nav = startNav + (endNav - startNav) * ((m * 5 + d) / (months * 5));
      rows.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, netValue: Number(nav.toFixed(4)) });
    }
  }
  return rows;
}

test('定投：固定金额、申购费内扣、逐月记录', () => {
  const rows = monthlyNav(1, 1.2, 12);
  const result = simulateDca(rows, { monthlyAmount: 500, months: 12, purchaseRate: 0.0015 });
  assert.equal(result.ok, true);
  assert.equal(result.purchases, 12);
  assert.equal(result.months, 12);
  assert.equal(result.invested, 6000);
  assert.equal(result.monthly.length, 12);
  assert.ok(result.finalValue > 0);
  assert.ok(result.profitRate > 0);
  assert.equal(result.maxDrawdown, 0);
});

test('定投：单边上涨时一次性买入更赚', () => {
  const result = simulateDca(monthlyNav(1, 1.4, 12), { monthlyAmount: 1000, months: 12 });
  assert.ok(result.lumpSum.rate > result.profitRate);
  assert.ok(result.dcaEdge < 0);
});

test('定投：历史数据不足直接拒绝', () => {
  const result = simulateDca(monthlyNav(1, 1.1, 2), { monthlyAmount: 500, months: 12 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /历史净值不足/);
});

test('沪深300 对比：按买入金额加权，逐笔有超额', () => {
  const indexRows = [
    { date: '2026-01-02', close: 100 },
    { date: '2026-06-30', close: 110 },
  ];
  const positions = [
    { code: '000001', name: 'A', buyDate: '2026-01-02', buyAmount: 1000, profit: { realRate: 0.2 } },
    { code: '000002', name: 'B', buyDate: '2026-01-02', buyAmount: 2000, profit: { realRate: -0.05 } },
  ];
  const result = compareBenchmark(positions, indexRows, { realRate: 0.0333 });
  assert.equal(result.indexReturn, 0.1);
  assert.equal(result.perPosition.length, 2);
  assert.equal(result.perPosition[0].indexReturn, 0.1);
  assert.ok(Math.abs(result.excess - (0.0333 - 0.1)) < 1e-9);
});

test('沪深300 对比：买入日还没收盘按 0，不回退到最早一根', () => {
  const indexRows = [
    { date: '2026-01-02', close: 100 },
    { date: '2026-06-30', close: 110 },
  ];
  const result = compareBenchmark(
    [{ code: '000001', name: 'A', buyDate: '2026-07-01', buyAmount: 1000, profit: { realRate: 0.02 } }],
    indexRows,
    { realRate: 0.02 },
  );
  assert.equal(result.indexReturn, 0);
  assert.equal(result.perPosition[0].indexReturn, 0);
});

test('归因：拆账面盈亏、费用、净收益与占投入', () => {
  const positions = [
    { code: '000001', name: 'A', buyAmount: 1000, profit: { bookProfit: 50, realProfit: 49.9, netProfit: 44.9, netRate: 0.0449, fees: { purchaseFee: 0.1, redemptionFee: 5 } } },
    { code: '000002', name: 'B', buyAmount: 500, profit: { bookProfit: -20, realProfit: -20.1, netProfit: -27.6, netRate: -0.0552, fees: { purchaseFee: 0.1, redemptionFee: 7.5 } } },
  ];
  const result = attribute(positions, { invest: 1500, netRate: -0.01 }, null);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].code, '000001');
  assert.equal(result.rows[0].weight, 0.6667);
  assert.equal(result.rows[1].weight, 0.3333);
  assert.equal(result.totalNetProfit, 17.3);
  assert.equal(result.totalPurchaseFee, 0.2);
  assert.equal(result.totalRedemptionFee, 12.5);
});

test('复盘对比：结论变化、新增、移出操作区', () => {
  const previous = {
    headline: '昨天要先卖一笔',
    actions: [
      { code: '110022', name: '消费', verdict: 'sell', verdictLabel: '该卖', action: '卖一半' },
      { code: '023313', name: '量化', verdict: 'hold', verdictLabel: '持有', action: '拿着' },
      { code: '000003', name: '旧基金', verdict: 'watch', verdictLabel: '观察', action: '别动' },
    ],
    flags: [{ title: '仓位偏重' }],
  };
  const today = {
    headline: '今天不用动',
    actions: [
      { code: '110022', name: '消费', verdict: 'hold', verdictLabel: '持有', action: '拿着' },
      { code: '023313', name: '量化', verdict: 'hold', verdictLabel: '持有', action: '拿着' },
      { code: '000004', name: '新基金', verdict: 'buy', verdictLabel: '可买', action: '先体检' },
    ],
    flags: [{ title: '数据滞后' }],
  };
  const result = comparePlans(previous, today, '2026-11-12');
  assert.equal(result.changed, true);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.find((item) => item.code === '110022').status, 'changed');
  assert.equal(result.items.find((item) => item.code === '000004').status, 'new');
  assert.equal(result.items.find((item) => item.code === '000003').status, 'cleared');
  assert.deepEqual(result.newFlags, ['数据滞后']);
  assert.deepEqual(result.goneFlags, ['仓位偏重']);
  assert.match(result.headline, /不一样/);
});

test('复盘对比：结论一致时明确说没过期', () => {
  const plan = {
    headline: '继续持有',
    actions: [{ code: '110022', name: '消费', verdict: 'hold', verdictLabel: '持有', action: '拿着' }],
    flags: [],
  };
  const result = comparePlans(plan, JSON.parse(JSON.stringify(plan)), '2026-11-12');
  assert.equal(result.changed, false);
  assert.equal(result.items[0].status, 'same');
  assert.match(result.headline, /没过期/);
});
