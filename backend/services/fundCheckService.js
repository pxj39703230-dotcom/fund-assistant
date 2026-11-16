'use strict';

const fundDataService = require('./fundDataService');
const marketService = require('./marketService');
const portfolioService = require('./portfolioService');
const { computeStats, inferStrategy } = require('../domain/advice');
const { checkFund } = require('../domain/fundCheck');
const constitutionService = require('./constitutionService');
const { createLogger } = require('../utils/logger');

const log = createLogger('fundcheck');
const HISTORY_DAYS = 90;

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

function tierShortRate(tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return 0;
  const sorted = [...tiers].sort((a, b) => (a.minDays ?? 0) - (b.minDays ?? 0));
  const first = sorted[0];
  return Number(first.rate ?? first.value ?? 0);
}

async function checkFundByCode(code, options = {}) {
  const cacheKey = [code, options.amount || '', options.mode || ''].join(':');
  const cached = cache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.data;
  }

  const quote = await fundDataService.getQuote(code);
  const detail = await fundDataService.getFundDetail(code).catch((error) => {
    log.warn(`${code} 费率获取失败: ${error.message}`);
    return null;
  });
  const rows = await fundDataService.getHistory(code, HISTORY_DAYS).catch((error) => {
    log.warn(`${code} 历史净值获取失败: ${error.message}`);
    return [];
  });

  const name = quote?.name || detail?.name || code;
  const stats = computeStats(rows, { buyDate: quote?.navDate });
  const inferred = inferStrategy({
    type: detail?.type,
    name,
    volatility: stats.volatility,
  });

  let summary = {};
  let positions = [];
  try {
    const portfolio = await portfolioService.buildPortfolio({});
    summary = portfolio.summary || {};
    positions = portfolio.positions || [];
  } catch (error) {
    log.warn(`组合汇总获取失败: ${error.message}`);
  }

  const result = checkFund({
    code,
    name,
    type: detail?.type || null,
    stats,
    strategy: inferred.strategy,
    portfolio: summary,
    fees: {
      purchaseRate: Number(detail?.purchaseRate || 0),
      redemptionShort: tierShortRate(detail?.redemptionTiers),
      redemptionTiers: detail?.redemptionTiers || [],
    },
  });

  const fundValue = positions
    .filter((pos) => pos.code === code)
    .reduce((sum, pos) => sum + Number(pos.profit?.currentValue || 0), 0);
  const amount = Number(options.amount) > 0 ? Number(options.amount) : Number(result.plan?.firstAmount || 0);
  const mode = options.mode === 'add' || options.mode === 'first'
    ? options.mode
    : (positions.some((pos) => pos.code === code) ? 'add' : 'first');
  const constitution = constitutionService.evaluateForBuy({
    check: result,
    amount,
    mode,
    portfolio: summary,
    fundValue,
    dataReady: Boolean(result.plan && result.score !== null && Object.prototype.hasOwnProperty.call(summary, 'fundCount')),
  });

  let estimate = null;
  try {
    const snapshot = await marketService.getSnapshot([code]);
    const raw = snapshot.estimates?.[code];
    if (raw && raw.estimateNav) {
      estimate = { nav: raw.estimateNav, pct: raw.estimatePct, time: raw.estimateTime };
    }
  } catch (error) {
    log.warn(`盘中估值获取失败: ${error.message}`);
  }

  const data = {
    ...result,
    nav: quote?.netValue ?? null,
    navDate: quote?.navDate ?? null,
    growthRate: quote?.growthRate ?? null,
    source: quote?.source ?? null,
    estimate,
    constitution,
    checkedAt: new Date().toISOString(),
    reason: inferred.reason,
  };

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

function clearCache() {
  cache.clear();
}

module.exports = { checkFundByCode, clearCache };
