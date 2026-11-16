'use strict';

/**
 * 场外基金默认费率假设。
 * 说明：管理费/托管费/销售服务费是从基金资产中每日计提、已经内含在公布净值里的，
 * 不能再从投资者收益里扣一次——这是旧版本最大的口径错误。
 */

const DEFAULT_REDEMPTION_TIERS = [
  { minDays: 0, maxDays: 6, rate: 0.015, label: '小于7天' },
  { minDays: 7, maxDays: 364, rate: 0.005, label: '7天(含)-365天' },
  { minDays: 365, maxDays: 729, rate: 0.0025, label: '365天(含)-730天' },
  { minDays: 730, maxDays: null, rate: 0, label: '730天及以上' },
];

const DEFAULT_PURCHASE_RATE = 0.0015; // 天天基金一折后的常见费率，仅在拿不到详情时兜底
const DEFAULT_MANAGEMENT_RATE = 0.012; // 仅用于"已内含费用"的参考估算
const DEFAULT_CUSTODY_RATE = 0.002;

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return DEFAULT_REDEMPTION_TIERS;
  return tiers
    .map((tier) => ({
      minDays: Number(tier.minDays) || 0,
      maxDays: tier.maxDays === null || tier.maxDays === undefined ? null : Number(tier.maxDays),
      rate: Number(tier.rate) || 0,
      label: tier.label || '',
    }))
    .sort((a, b) => a.minDays - b.minDays);
}

/** 按持有自然日命中赎回费率档位；超出最高档时用最后一档 */
function resolveRedemptionTier(holdDays, tiers) {
  const list = normalizeTiers(tiers);
  const days = Math.max(0, Math.floor(Number(holdDays) || 0));
  const hit = list.find((tier) => days >= tier.minDays && (tier.maxDays === null || days <= tier.maxDays));
  return hit || list[list.length - 1];
}

/** 申购费率档位：按买入金额匹配，返回 { rate } 或 { fixedFee } */
function resolvePurchaseRule(amount, tiers, fallbackRate) {
  const list = Array.isArray(tiers) ? tiers : [];
  for (const tier of list) {
    const min = Number(tier.minAmount) || 0;
    const max = tier.maxAmount === null || tier.maxAmount === undefined ? null : Number(tier.maxAmount);
    if (amount >= min && (max === null || amount < max)) {
      if (Number.isFinite(Number(tier.fixedFee)) && tier.fixedFee) return { fixedFee: Number(tier.fixedFee) };
      if (Number.isFinite(Number(tier.rate))) return { rate: Number(tier.rate) };
    }
  }
  return { rate: Number.isFinite(Number(fallbackRate)) ? Number(fallbackRate) : DEFAULT_PURCHASE_RATE };
}

module.exports = {
  DEFAULT_REDEMPTION_TIERS,
  DEFAULT_PURCHASE_RATE,
  DEFAULT_MANAGEMENT_RATE,
  DEFAULT_CUSTODY_RATE,
  normalizeTiers,
  resolveRedemptionTier,
  resolvePurchaseRule,
};
