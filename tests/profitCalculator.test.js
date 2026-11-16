'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePosition } = require('../backend/services/profitCalculator');
const { DEFAULT_REDEMPTION_TIERS } = require('../backend/domain/rates');

const FEES = {
  purchaseRate: 0.0015,
  managementRate: 0.012,
  custodyRate: 0.002,
  redemptionTiers: DEFAULT_REDEMPTION_TIERS,
};

function calculate(overrides = {}) {
  return calculatePosition({
    buyAmount: 10000,
    buyNetValue: 2.5,
    buyDate: '2026-06-01',
    currentNav: 2.927,
    today: '2026-11-13',
    fees: FEES,
    targetProfit: 0.3,
    stopLoss: 0.2,
    ...overrides,
  });
}

test('申购费按内扣法计算，份额与市值正确', () => {
  const result = calculate();
  assert.equal(result.holdDays, 165);
  assert.equal(result.fees.purchaseFee, 14.98);
  assert.equal(result.shares, 3994.009);
  assert.equal(result.currentValue, 11690.46);
});

test('三种口径互相自洽：真实盈亏扣申购费，净收益再扣赎回费', () => {
  const result = calculate();
  // 账面口径：假设零申购费时的份额 × 净值 - 投入
  assert.equal(result.grossShares, 4000);
  assert.equal(result.grossValue, 11708);
  assert.equal(result.bookProfit, 1708);
  // 真实口径：扣掉申购费后的市值 - 投入
  assert.equal(result.realProfit, 1690.46);
  assert.equal(result.fees.redemptionRate, 0.005);
  assert.equal(result.fees.redemptionFee, 58.45);
  assert.equal(result.netProfit, 1632.01);
  assert.equal(result.netProfit, Math.round((result.realProfit - result.fees.redemptionFee) * 100) / 100);
});

test('管理费/托管费不重复扣除，只作为已内含费用展示', () => {
  const result = calculate();
  assert.ok(result.includedCost.estimated > 0);
  // 真实盈亏 = 市值 - 投入，不能出现"再减一次管理费"
  assert.equal(result.realProfit, Math.round((result.currentValue - 10000) * 100) / 100);
});

test('赎回费率阶梯边界：第 6/7 天、第 364/365 天、第 729/730 天', () => {
  const cases = [
    [0, 0.015, '小于7天'],
    [6, 0.015, '小于7天'],
    [7, 0.005, '7天(含)-365天'],
    [364, 0.005, '7天(含)-365天'],
    [365, 0.0025, '365天(含)-730天'],
    [729, 0.0025, '365天(含)-730天'],
    [730, 0, '730天及以上'],
    [900, 0, '730天及以上'],
  ];

  for (const [days, rate, label] of cases) {
    const result = calculate({ buyDate: daysBefore('2026-11-13', days) });
    assert.equal(result.holdDays, days, `持有天数 ${days}`);
    assert.equal(result.fees.redemptionRate, rate, `${days} 天的费率`);
    assert.equal(result.fees.redemptionLabel, label, `${days} 天的档位文案`);
  }
});

test('等待降费按"当前档上界 + 1"计算，而不是下一档上界', () => {
  // 持有 5 天仍在"小于7天"档，再等 2 天进入 7 天档
  const five = calculate({ buyDate: daysBefore('2026-11-13', 5) });
  assert.equal(five.redemption.optimization.daysToWait, 2);
  assert.equal(five.redemption.optimization.worthWaiting, true);
  assert.equal(five.redemption.optimization.nextTier.minDays, 7);

  // 持有 6 天时只差 1 天
  const six = calculate({ buyDate: daysBefore('2026-11-13', 6) });
  assert.equal(six.redemption.optimization.daysToWait, 1);
});

test('跨档收益差不值得等待时给出明确结论，不制造焦虑', () => {
  // 364 天 -> 365 天只降 0.25%，省的钱少但要等 1 天：仍算值得
  const near = calculate({ buyDate: daysBefore('2026-11-13', 364) });
  assert.equal(near.redemption.optimization.daysToWait, 1);

  // 730 天以后已是最低档
  const cleared = calculate({ buyDate: daysBefore('2026-11-13', 730), currentNav: 2.0 });
  assert.equal(cleared.redemption.optimization.daysToWait, 0);
  assert.equal(cleared.redemption.optimization.worthWaiting, false);
  assert.match(cleared.redemption.optimization.text, /已是最低赎回费率档/);
});

test('止盈止损判定与距离', () => {
  const hitTarget = calculate({ targetProfit: 0.1 });
  assert.equal(hitTarget.risk.reachedTarget, true);
  assert.equal(hitTarget.risk.reachedStop, false);

  const hitStop = calculate({ currentNav: 1.8, stopLoss: 0.2 });
  assert.equal(hitStop.risk.reachedStop, true);
});

test('非法输入直接拒绝，不产生 NaN', () => {
  assert.throws(() => calculate({ buyAmount: 0 }), /买入金额必须大于 0/);
  assert.throws(() => calculate({ buyNetValue: 0 }), /买入净值必须大于 0/);
  assert.throws(() => calculate({ currentNav: Number.NaN }), /当前净值必须大于 0/);
});

function daysBefore(today, days) {
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}
