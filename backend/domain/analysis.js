'use strict';

const { round2, round4 } = require('../utils/number');

function monthKey(date) {
  return String(date || '').slice(0, 7);
}

/**
 * 定投回测：每月第一个有净值的交易日买入固定金额，忽略赎回费，申购费内扣。
 * 只做历史测算，不代表未来收益。
 */
function simulateDca(rows, options = {}) {
  const monthlyAmount = Number(options.monthlyAmount) || 0;
  const months = Math.min(Math.max(Number(options.months) || 24, 6), 60);
  const purchaseRate = Number(options.purchaseRate) || 0;

  const valid = (rows || [])
    .filter((row) => row && row.date && Number.isFinite(Number(row.netValue)) && Number(row.netValue) > 0)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (valid.length < 20 || monthlyAmount <= 0) {
    return { ok: false, reason: '历史净值不足，至少需要 20 个交易日才能测算' };
  }

  const groups = new Map();
  for (const row of valid) {
    const key = monthKey(row.date);
    if (!groups.has(key)) groups.set(key, row);
  }
  const allMonths = [...groups.keys()];
  const picked = allMonths.slice(-months);

  let invested = 0;
  let shares = 0;
  const monthly = [];
  for (const key of picked) {
    const row = groups.get(key);
    const netValue = Number(row.netValue);
    const buyShares = monthlyAmount / (1 + purchaseRate) / netValue;
    invested += monthlyAmount;
    shares += buyShares;
    monthly.push({
      date: row.date,
      netValue,
      shares: round4(buyShares),
      invested: round2(invested),
      valueAtBuy: round2(shares * netValue),
      rateAtBuy: round4(shares * netValue / invested - 1),
    });
  }

  const lastNav = Number(valid[valid.length - 1].netValue);
  const firstNav = Number(groups.get(picked[0]).netValue);
  const finalValue = shares * lastNav;
  const profit = finalValue - invested;
  const profitRate = invested ? profit / invested : 0;

  const lumpShares = invested / (1 + purchaseRate) / firstNav;
  const lumpValue = lumpShares * lastNav;
  const lumpRate = invested ? lumpValue / invested - 1 : 0;

  // 定投组合的单位净值曲线（按已投入金额归一），用于算回撤
  let peak = 0;
  let maxDrawdown = 0;
  let cursor = 0;
  let heldShares = 0;
  let heldInvested = 0;
  const buyByMonth = new Map(monthly.map((item) => [monthKey(item.date), item]));
  for (const row of valid) {
    const key = monthKey(row.date);
    if (buyByMonth.has(key)) {
      const buy = buyByMonth.get(key);
      heldShares += buy.shares;
      heldInvested += monthlyAmount;
    }
    if (heldInvested <= 0) continue;
    const unit = (heldShares * Number(row.netValue)) / heldInvested;
    peak = Math.max(peak, unit);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, unit / peak - 1);
  }

  const positiveMonths = monthly.filter((item) => lastNav > item.netValue).length;
  const best = monthly.slice().sort((a, b) => b.netValue - a.netValue)[0];
  const worst = monthly.slice().sort((a, b) => a.netValue - b.netValue)[0];

  return {
    ok: true,
    code: options.code || null,
    name: options.name || options.code || '',
    monthlyAmount,
    months: picked.length,
    fromDate: picked[0] ? groups.get(picked[0]).date : null,
    toDate: valid[valid.length - 1].date,
    latestNav: lastNav,
    purchases: monthly.length,
    invested: round2(invested),
    finalValue: round2(finalValue),
    profit: round2(profit),
    profitRate: round4(profitRate),
    lumpSum: {
      value: round2(lumpValue),
      profit: round2(lumpValue - invested),
      rate: round4(lumpRate),
    },
    dcaEdge: round4(profitRate - lumpRate),
    maxDrawdown: round4(maxDrawdown),
    positiveMonths,
    negativeMonths: monthly.length - positiveMonths,
    bestBuy: best ? { date: best.date, netValue: best.netValue } : null,
    worstBuy: worst ? { date: worst.date, netValue: worst.netValue } : null,
    monthly,
  };
}

/**
 * 组合与沪深300同期对比：逐笔按买入日找指数起点，再按买入金额加权。
 */
function compareBenchmark(positions = [], indexRows = [], summary = {}) {
  const rows = (indexRows || [])
    .filter((row) => row && row.date && Number.isFinite(Number(row.close)))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!rows.length || !positions.length) return null;

  const latest = rows[rows.length - 1];
  let weight = 0;
  let weightedIndex = 0;
  const perPosition = [];

  for (const position of positions) {
    const buyDate = position.buyDate;
    // 买入日还没收盘（或早于第一根 K 线）时按最新收盘算 0，绝不回退到最早一根
    const start = rows.find((row) => row.date >= buyDate) || rows[rows.length - 1];
    if (!start || start.close <= 0) continue;
    const indexReturn = latest.close / Number(start.close) - 1;
    const realRate = Number(position.profit?.realRate) || 0;
    const amount = Number(position.buyAmount) || 0;
    weight += amount;
    weightedIndex += amount * indexReturn;
    perPosition.push({
      code: position.code,
      name: position.name,
      buyDate,
      realRate: round4(realRate),
      indexReturn: round4(indexReturn),
      excess: round4(realRate - indexReturn),
      amount: round2(amount),
      excessAmount: round2(amount * (realRate - indexReturn)),
    });
  }

  if (!perPosition.length || weight <= 0) return null;
  const indexReturn = weightedIndex / weight;
  const portfolioReturn = Number(summary.realRate) || 0;
  return {
    indexName: '沪深300',
    fromDate: perPosition.map((item) => item.buyDate).sort()[0],
    toDate: latest.date,
    indexClose: Number(latest.close),
    indexReturn: round4(indexReturn),
    portfolioReturn: round4(portfolioReturn),
    excess: round4(portfolioReturn - indexReturn),
    perPosition,
  };
}

function attribute(positions = [], summary = {}, benchmark = null) {
  const benchMap = new Map((benchmark?.perPosition || []).map((item) => [item.code, item]));
  const rows = positions.map((position) => {
    const profit = position.profit || {};
    const fees = profit.fees || {};
    const netProfit = Number(profit.netProfit) || 0;
    const bench = benchMap.get(position.code);
    return {
      code: position.code,
      name: position.name,
      amount: Number(position.buyAmount) || 0,
      bookProfit: Number(profit.bookProfit) || 0,
      purchaseFee: Number(fees.purchaseFee) || 0,
      redemptionFee: Number(fees.redemptionFee) || 0,
      realProfit: Number(profit.realProfit) || 0,
      netProfit,
      netRate: Number(profit.netRate) || 0,
      contribution: summary.netProfit ? netProfit / summary.netProfit : 0,
      indexReturn: bench ? bench.indexReturn : null,
      excess: bench ? bench.excess : null,
      excessAmount: bench ? bench.excessAmount : null,
    };
  });

  rows.sort((a, b) => b.netProfit - a.netProfit);
  const totalNet = rows.reduce((sum, item) => sum + item.netProfit, 0);
  const totalInvest = rows.reduce((sum, item) => sum + item.amount, 0);
  const sumBy = (key) => rows.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
  return {
    totalInvest: round2(totalInvest),
    totalBookProfit: round2(sumBy('bookProfit')),
    totalPurchaseFee: round2(sumBy('purchaseFee')),
    totalRedemptionFee: round2(sumBy('redemptionFee')),
    totalNetProfit: round2(totalNet),
    totalNetRate: round4(summary.netRate || 0),
    rows: rows.map((item) => ({
      ...item,
      contribution: round4(item.contribution),
      weight: round4(summary.invest ? item.amount / summary.invest : 0),
    })),
  };
}

/**
 * 复盘结论 vs 今天结论：只比较"该不该动手"，不假设用户已经执行。
 */
function comparePlans(previousPlan, todayPlan, reviewDate) {
  if (!previousPlan || !todayPlan) return null;
  const prevActions = new Map();
  for (const item of previousPlan.actions || []) prevActions.set(item.code || item.name, item);
  const todayActions = new Map();
  for (const item of todayPlan.actions || []) todayActions.set(item.code || item.name, item);

  const keys = [...new Set([...prevActions.keys(), ...todayActions.keys()])];
  const items = [];
  for (const key of keys) {
    const before = prevActions.get(key);
    const after = todayActions.get(key);
    if (!before && after) {
      items.push({
        code: after.code,
        name: after.name,
        status: 'new',
        before: null,
        after: after.verdictLabel,
        action: after.action,
      });
      continue;
    }
    if (before && !after) {
      items.push({
        code: before.code,
        name: before.name,
        status: 'cleared',
        before: before.verdictLabel,
        after: null,
        action: '今天已不在操作区，按最新结论执行',
      });
      continue;
    }
    const sameVerdict = before.verdict === after.verdict;
    items.push({
      code: after.code,
      name: after.name,
      status: sameVerdict ? 'same' : 'changed',
      before: before.verdictLabel,
      after: after.verdictLabel,
      action: after.action,
    });
  }

  const prevFlags = new Set((previousPlan.flags || []).map((flag) => flag.title));
  const todayFlags = (todayPlan.flags || []).map((flag) => flag.title);
  const newFlags = todayFlags.filter((title) => !prevFlags.has(title));
  const goneFlags = [...prevFlags].filter((title) => !todayFlags.includes(title));

  const changed = items.some((item) => item.status === 'changed' || item.status === 'new' || item.status === 'cleared');
  let headline;
  if (changed) {
    headline = '情况和复盘时不一样了，今天以新结论为准';
  } else if (items.length) {
    headline = '复盘结论没过期，今天继续按它执行';
  } else {
    headline = '复盘和今天都没有要动手的事，保持原样';
  }

  return {
    reviewDate,
    headline,
    changed,
    items,
    newFlags,
    goneFlags,
    previousHeadline: previousPlan.headline,
    todayHeadline: todayPlan.headline,
  };
}

module.exports = { simulateDca, compareBenchmark, attribute, comparePlans };
