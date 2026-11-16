'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRedemptionTier, resolvePurchaseRule, normalizeTiers, DEFAULT_REDEMPTION_TIERS } = require('../backend/domain/rates');

test('默认赎回阶梯覆盖 2 年内的全部天数', () => {
  for (let days = 0; days <= 740; days += 1) {
    const tier = resolveRedemptionTier(days, DEFAULT_REDEMPTION_TIERS);
    assert.ok(tier, `${days} 天没有命中任何档位`);
    assert.ok(days >= tier.minDays);
    assert.ok(tier.maxDays === null || days <= tier.maxDays);
  }
});

test('没有费率数据时回退默认阶梯和默认申购费率', () => {
  assert.equal(resolveRedemptionTier(3, []).rate, 0.015);
  assert.equal(resolveRedemptionTier(3, null).rate, 0.015);
  assert.equal(resolvePurchaseRule(1000, null, undefined).rate, 0.0015);
});

test('申购费按金额匹配：低于门槛按比例，高于门槛按每笔固定费', () => {
  const tiers = [
    { minAmount: 0, maxAmount: 100, rate: 0.015 },
    { minAmount: 100, maxAmount: 500, rate: 0.0015 },
    { minAmount: 500, maxAmount: null, fixedFee: 5 },
  ];

  assert.equal(resolvePurchaseRule(50, tiers, 0.0015).rate, 0.015);
  assert.equal(resolvePurchaseRule(300, tiers, 0.0015).rate, 0.0015);
  assert.equal(resolvePurchaseRule(1000, tiers, 0.0015).fixedFee, 5);
});

test('阶梯排序与脏数据清洗', () => {
  const messy = [
    { minDays: 730, maxDays: null, rate: '0' },
    { minDays: 0, maxDays: '6', rate: '0.015' },
    { minDays: 7, maxDays: 364, rate: '0.005' },
  ];
  const normalized = normalizeTiers(messy);
  assert.deepEqual(normalized.map((tier) => tier.minDays), [0, 7, 730]);
  assert.equal(normalized[0].rate, 0.015);
  assert.equal(normalized[2].maxDays, null);
});
