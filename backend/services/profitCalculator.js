'use strict';

const { diffDays } = require('../utils/date');
const { round2, round4, toPercent } = require('../utils/number');
const {
  DEFAULT_PURCHASE_RATE,
  DEFAULT_MANAGEMENT_RATE,
  DEFAULT_CUSTODY_RATE,
  DEFAULT_REDEMPTION_TIERS,
  resolveRedemptionTier,
  resolvePurchaseRule,
  normalizeTiers,
} = require('../domain/rates');

/**
 * 单笔持仓的收益计算（纯函数，不依赖数据库/网络，便于测试）。
 *
 * 三个口径：
 *  - bookProfit 账面盈亏：只按净值涨跌算，不扣任何费用（用于看"基金本身赚没赚"）
 *  - realProfit 真实盈亏：扣申购费后的市值 - 投入。管理费/托管费已内含在净值中，不重复扣
 *  - netProfit  净收益：现在全部赎回、扣掉赎回费后真正到手的钱 - 投入
 */
function calculatePosition(input) {
  const buyAmount = Number(input.buyAmount);
  const buyNetValue = Number(input.buyNetValue);
  const currentNav = Number(input.currentNav);
  const today = input.today;

  if (!Number.isFinite(buyAmount) || buyAmount <= 0) throw new Error('买入金额必须大于 0');
  if (!Number.isFinite(buyNetValue) || buyNetValue <= 0) throw new Error('买入净值必须大于 0');
  if (!Number.isFinite(currentNav) || currentNav <= 0) throw new Error('当前净值必须大于 0');

  const fees = input.fees || {};
  const holdDays = Math.max(0, diffDays(input.buyDate, today) || 0);

  // 1) 申购：国内场外基金按"内扣法"确认份额
  const rule = resolvePurchaseRule(buyAmount, fees.purchaseTiers, fees.purchaseRate ?? DEFAULT_PURCHASE_RATE);
  const purchaseFee = rule.fixedFee !== undefined
    ? Math.min(rule.fixedFee, buyAmount)
    : buyAmount - buyAmount / (1 + rule.rate);
  const purchaseRate = rule.rate !== undefined ? rule.rate : (buyAmount > 0 ? purchaseFee / buyAmount : 0);
  const netAmount = buyAmount - purchaseFee;
  const shares = netAmount / buyNetValue;
  const grossShares = buyAmount / buyNetValue; // 假设零申购费时的份额，仅用于"账面"口径

  // 2) 市值
  const currentValue = shares * currentNav;
  const grossValue = grossShares * currentNav;

  // 3) 赎回费：按持有自然日命中阶梯
  const redemptionTiers = normalizeTiers(fees.redemptionTiers || DEFAULT_REDEMPTION_TIERS);
  const tier = resolveRedemptionTier(holdDays, redemptionTiers);
  const redemptionFee = currentValue * tier.rate;

  // 4) 三种口径
  const bookProfit = grossValue - buyAmount;
  const realProfit = currentValue - buyAmount;
  const netProceeds = currentValue - redemptionFee;
  const netProfit = netProceeds - buyAmount;

  // 5) 已内含费用（净值里已经扣过，这里只做透明化展示，不参与收益扣减）
  const managementRate = toRate(fees.managementRate, DEFAULT_MANAGEMENT_RATE);
  const custodyRate = toRate(fees.custodyRate, DEFAULT_CUSTODY_RATE);
  const salesServiceRate = toRate(fees.salesServiceRate, 0);
  const includedManagement = currentValue * (managementRate / 365) * holdDays;
  const includedCustody = currentValue * (custodyRate / 365) * holdDays;
  const includedSales = currentValue * (salesServiceRate / 365) * holdDays;
  const includedTotal = includedManagement + includedCustody + includedSales;

  // 6) 止盈止损距离
  const targetProfit = toRate(input.targetProfit, 0.3);
  const stopLoss = toRate(input.stopLoss, 0.2);
  const realReturnRate = realProfit / buyAmount;
  const reachedTarget = realReturnRate >= targetProfit;
  const reachedStop = realReturnRate <= -stopLoss;

  return {
    holdDays,
    buyDate: input.buyDate,
    navDate: input.navDate || null,
    principal: round2(buyAmount),
    shares: round4(shares),
    grossShares: round4(grossShares),
    currentNav: round4(currentNav),
    currentValue: round2(currentValue),
    grossValue: round2(grossValue),
    netProceeds: round2(netProceeds),

    bookProfit: round2(bookProfit),
    bookRate: round4(bookProfit / buyAmount),
    realProfit: round2(realProfit),
    realRate: round4(realProfit / buyAmount),
    netProfit: round2(netProfit),
    netRate: round4(netProfit / buyAmount),

    fees: {
      purchaseRate: round4(purchaseRate),
      purchaseFee: round2(purchaseFee),
      redemptionRate: round4(tier.rate),
      redemptionFee: round2(redemptionFee),
      redemptionLabel: tier.label,
      cashTotal: round2(purchaseFee + redemptionFee),
    },

    includedCost: {
      managementRate: round4(managementRate),
      custodyRate: round4(custodyRate),
      salesServiceRate: round4(salesServiceRate),
      estimated: round2(includedTotal),
      note: '管理费、托管费由基金资产每日计提，已体现在公布净值中，不重复扣除',
    },

    redemption: {
      current: tier,
      next: findNextTier(holdDays, tier, redemptionTiers),
      optimization: buildRedemptionAdvice(tier, redemptionTiers, holdDays, currentValue),
    },

    risk: {
      targetProfit: round4(targetProfit),
      stopLoss: round4(stopLoss),
      reachedTarget,
      reachedStop,
      distanceToTarget: round4(targetProfit - realReturnRate),
      distanceToStop: round4(realReturnRate + stopLoss),
      targetValue: round2(buyAmount * (1 + targetProfit)),
      stopValue: round2(buyAmount * (1 - stopLoss)),
      // 让收益率进度条在 -止损 ~ +止盈 之间可视化
      positionRatio: clamp01((realReturnRate + stopLoss) / (stopLoss + targetProfit)),
    },
  };
}

function buildRedemptionAdvice(currentTier, tiers, holdDays, currentValue) {
  const list = normalizeTiers(tiers);
  const index = indexOfTier(list, currentTier);
  const next = index >= 0 ? list[index + 1] : null;

  if (!next || next.rate >= currentTier.rate) {
    return {
      worthWaiting: false,
      daysToWait: 0,
      rateDrop: 0,
      savedAmount: 0,
      text: '已是最低赎回费率档，费率上无需等待',
    };
  }

  const daysToWait = currentTier.maxDays === null ? 0 : currentTier.maxDays + 1 - holdDays;
  const rateDrop = currentTier.rate - next.rate;
  const savedAmount = round2(currentValue * rateDrop);

  if (daysToWait <= 0) {
    return {
      worthWaiting: false,
      daysToWait: 0,
      rateDrop: round4(rateDrop),
      savedAmount,
      nextTier: next,
      text: '已可进入下一费率档，刷新后按新档计费',
    };
  }

  // 值得等的前提：省的钱够看、降幅够大、等待时间不超过 30 天（时间成本也是成本）
  const worthWaiting = savedAmount >= 1 && rateDrop >= 0.0005 && daysToWait <= 30;
  const fromPercent = toPercent(currentTier.rate);
  const toPercentValue = toPercent(next.rate);

  let text;
  if (worthWaiting) {
    text = `再持有 ${daysToWait} 天，赎回费率从 ${fromPercent}% 降到 ${toPercentValue}%，约省 ${savedAmount} 元`;
  } else if (daysToWait <= 30) {
    text = `再持有 ${daysToWait} 天费率可降到 ${toPercentValue}%，预计只省 ${savedAmount} 元，不必为此等待`;
  } else {
    text = `再持有 ${daysToWait} 天费率才降到 ${toPercentValue}%，预计省 ${savedAmount} 元，时间成本偏高，不必专门等待`;
  }

  return {
    worthWaiting,
    daysToWait,
    rateDrop: round4(rateDrop),
    savedAmount,
    nextTier: next,
    text,
  };
}

function findNextTier(holdDays, currentTier, tiers) {
  const list = normalizeTiers(tiers);
  const index = indexOfTier(list, currentTier);
  return index >= 0 && index + 1 < list.length ? list[index + 1] : null;
}

/** 因为 normalizeTiers 会生成新对象，不能直接用引用比较 */
function indexOfTier(list, tier) {
  if (!tier) return -1;
  return list.findIndex((item) => item.minDays === tier.minDays && Math.abs(item.rate - tier.rate) < 1e-9);
}

function toRate(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 用今日涨跌幅反推当日盈亏：市值 / (1+g) 是昨日市值 */
function estimateTodayProfit(currentValue, growthRatePercent) {
  const g = Number(growthRatePercent);
  if (!Number.isFinite(g) || g === 0) return 0;
  const previous = currentValue / (1 + g / 100);
  return round2(currentValue - previous);
}

module.exports = { calculatePosition, estimateTodayProfit, buildRedemptionAdvice };
