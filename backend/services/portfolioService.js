'use strict';

const db = require('../config/database');
const config = require('../config/env');
const fundDataService = require('./fundDataService');
const { calculatePosition, estimateTodayProfit } = require('./profitCalculator');
const { todayString, diffDays } = require('../utils/date');
const { round2, round4 } = require('../utils/number');
const { mapWithConcurrency, sleep } = require('../utils/asyncPool');
const { createLogger } = require('../utils/logger');
const jobService = require('./jobService');
const adviceService = require('./adviceService');
const reviewLinkService = require('./reviewLinkService');
const constitutionService = require('./constitutionService');
const { safeJson } = require('./fundDataService');

const log = createLogger('portfolio');

/** 防止手动点击 + 定时任务同时抓取，把上游打成限流 */
const syncState = { running: false };

function loadFees(code) {
  const fund = db.get('SELECT * FROM funds WHERE code = ?', [code]) || {};
  return {
    purchaseRate: fund.purchase_rate,
    purchaseTiers: safeJson(fund.purchase_tiers) || [],
    managementRate: fund.management_rate,
    custodyRate: fund.custody_rate,
    salesServiceRate: fund.sales_service_rate,
    redemptionTiers: safeJson(fund.redemption_tiers),
  };
}

async function ensureDetail(code) {
  if (fundDataService.isDetailFresh(code)) return;
  try {
    await fundDataService.getFundDetail(code);
  } catch (error) {
    log.debug(`${code} 费率详情获取失败，使用已有数据: ${error.message}`);
  }
}

/**
 * 组装完整组合视图：持仓 + 实时净值 + 收益 + 提醒。
 * 这是首页唯一的聚合入口，避免前端分别请求 holdings/summary 造成重复抓取。
 */
async function buildPortfolio(options = {}) {
  const today = options.today || todayString();
  const holdings = db.all('SELECT * FROM holdings ORDER BY buy_date ASC, id ASC');

  if (holdings.length === 0) {
    const summary = emptySummary();
    const advice = await adviceService.buildAdvice({ positions: [], summary, today });
    return {
      positions: [],
      summary,
      alerts: listAlerts(20),
      advice: { plan: advice.plan, market: advice.market },
      market: advice.market,
      meta: { today, updatedAt: null, staleCount: 0, unpricedCount: 0, quoteSources: [] },
      constitution: constitutionService.publicView(summary),
    };
  }

  const codes = [...new Set(holdings.map((h) => h.fund_code))];
  const fundMeta = new Map(
    codes.map((code) => [code, db.get('SELECT type, category FROM funds WHERE code = ?', [code]) || {}]),
  );
  const detailTasks = codes.map((code) => ensureDetail(code));
  await Promise.all(detailTasks);

  const quotes = new Map();
  const quoteErrors = new Map();

  const uniqueCodes = codes.map((code) => ({ code }));
  await mapWithConcurrency(uniqueCodes, Math.min(config.fetchConcurrency, 4), async ({ code }) => {
    try {
      const quote = await fundDataService.getQuote(code, { force: Boolean(options.refresh) });
      quotes.set(code, quote);
    } catch (error) {
      quoteErrors.set(code, error.message);
      log.warn(`${code} 净值获取失败: ${error.message}`);
    }
  });

  const positions = holdings.map((holding) => {
    const quote = quotes.get(holding.fund_code);
    const fallbackNav = Number(holding.buy_net_value);
    const currentNav = quote ? quote.netValue : fallbackNav;
    const fees = loadFees(holding.fund_code);
    const calc = calculatePosition({
      buyAmount: holding.buy_amount,
      buyNetValue: holding.buy_net_value,
      buyDate: holding.buy_date,
      currentNav,
      navDate: quote?.navDate,
      today,
      fees,
      targetProfit: holding.target_profit,
      stopLoss: holding.stop_loss,
    });

    const growthRate = quote && quote.growthRate !== null && quote.growthRate !== undefined ? Number(quote.growthRate) : null;
    const todayProfit = growthRate === null ? 0 : estimateTodayProfit(calc.currentValue, growthRate);

    return {
      id: holding.id,
      code: holding.fund_code,
      name: quote?.name || db.get('SELECT name FROM funds WHERE code = ?', [holding.fund_code])?.name || holding.fund_code,
      buyDate: holding.buy_date,
      buyAmount: round2(holding.buy_amount),
      buyNav: round4(holding.buy_net_value),
      shares: calc.shares,
      currentNav: calc.currentNav,
      navDate: quote?.navDate || null,
      growthRate,
      todayProfit,
      source: quote?.source || 'none',
      stale: Boolean(quote?.isStale),
      staleDays: quote?.isStale ? quote.staleDays ?? diffDays(quote.navDate, today) : 0,
      priced: Boolean(quote),
      error: quote ? null : (quoteErrors.get(holding.fund_code) || '无可用净值'),
      note: holding.note || '',
      strategy: holding.strategy || 'auto',
      fundType: fundMeta.get(holding.fund_code)?.type || fundMeta.get(holding.fund_code)?.category || '',
      targetProfit: Number(holding.target_profit),
      stopLoss: Number(holding.stop_loss),
      profit: calc,
    };
  });

  const summary = summarize(positions);
  const alerts = buildAlerts(positions, today);

  const advice = await adviceService.buildAdvice({ positions, summary, today });
  const adviceById = new Map(advice.items.map((item) => [item.id, item]));
  for (const position of positions) {
    position.advice = adviceById.get(position.id) || null;
  }

  // 需要立刻处理的建议，同样落库提醒（会触发推送）
  for (const position of positions) {
    if (!position.advice || position.advice.urgency < 3) continue;
    persistAlert({
      code: position.code,
      type: 'advice_action',
      level: 'critical',
      title: `${position.name}：${position.advice.verdictLabel}`,
      message: position.advice.action,
      tradeDate: position.navDate || today,
    });
  }

  const reviewCheck = reviewLinkService.buildCheck(advice.plan, today);

  return {
    positions,
    summary,
    alerts: listAlerts(20),
    advice: { plan: advice.plan, market: advice.market, reviewCheck },
    reviewCheck,
    market: advice.market,
    meta: {
      today,
      updatedAt: new Date().toISOString(),
      staleCount: positions.filter((p) => p.stale).length,
      unpricedCount: positions.filter((p) => !p.priced).length,
      quoteSources: [...new Set(positions.map((p) => p.source).filter((s) => s && s !== 'none'))],
    },
    constitution: constitutionService.publicView(summary),
  };
}

function summarize(positions) {
  if (positions.length === 0) return emptySummary();

  const totals = positions.reduce(
    (acc, p) => {
      acc.invest += p.buyAmount;
      acc.value += p.profit.currentValue;
      acc.netProceeds += p.profit.netProceeds;
      acc.bookProfit += p.profit.bookProfit;
      acc.realProfit += p.profit.realProfit;
      acc.netProfit += p.profit.netProfit;
      acc.purchaseFee += p.profit.fees.purchaseFee;
      acc.redemptionFee += p.profit.fees.redemptionFee;
      acc.todayProfit += p.todayProfit;
      return acc;
    },
    { invest: 0, value: 0, netProceeds: 0, bookProfit: 0, realProfit: 0, netProfit: 0, purchaseFee: 0, redemptionFee: 0, todayProfit: 0 },
  );

  const fundCodes = [...new Set(positions.map((p) => p.code))];
  const today = positions[0]?.profit?.navDate || todayString();

  const summary = {
    invest: round2(totals.invest),
    value: round2(totals.value),
    netProceeds: round2(totals.netProceeds),
    bookProfit: round2(totals.bookProfit),
    realProfit: round2(totals.realProfit),
    netProfit: round2(totals.netProfit),
    bookRate: totals.invest ? round4(totals.bookProfit / totals.invest) : 0,
    realRate: totals.invest ? round4(totals.realProfit / totals.invest) : 0,
    netRate: totals.invest ? round4(totals.netProfit / totals.invest) : 0,
    todayProfit: round2(totals.todayProfit),
    purchaseFee: round2(totals.purchaseFee),
    redemptionFeeIfSell: round2(totals.redemptionFee),
    holdingCount: positions.length,
    fundCount: fundCodes.length,
    pricedCount: positions.filter((p) => p.priced).length,
    staleCount: positions.filter((p) => p.stale).length,
    today,
    // 集中度提示用
    topWeight: round4(maxWeight(positions)),
    topFund: topFundName(positions),
  };

  return summary;
}

function maxWeight(positions) {
  const total = positions.reduce((sum, p) => sum + p.profit.currentValue, 0);
  if (total <= 0) return 0;
  return Math.max(...positions.map((p) => p.profit.currentValue / total));
}

function topFundName(positions) {
  const total = positions.reduce((sum, p) => sum + p.profit.currentValue, 0);
  if (total <= 0) return null;
  const top = positions.slice().sort((a, b) => b.profit.currentValue - a.profit.currentValue)[0];
  return top ? top.name : null;
}

function emptySummary() {
  return {
    invest: 0,
    value: 0,
    netProceeds: 0,
    bookProfit: 0,
    realProfit: 0,
    netProfit: 0,
    bookRate: 0,
    realRate: 0,
    netRate: 0,
    todayProfit: 0,
    purchaseFee: 0,
    redemptionFeeIfSell: 0,
    holdingCount: 0,
    fundCount: 0,
    pricedCount: 0,
    staleCount: 0,
    today: todayString(),
    topWeight: 0,
    topFund: null,
  };
}

/**
 * 生成并落库提醒。用 dedupe_key 保证同一天同一原因只提醒一次，
 * 三次定时抓取不会重复刷屏。
 */
function buildAlerts(positions, today) {
  const created = [];

  for (const position of positions) {
    const tradeDate = position.navDate || today;

    if (!position.priced) {
      created.push({
        code: position.code,
        type: 'no_quote',
        level: 'warn',
        title: `${position.name} 净值获取失败`,
        message: position.error,
        tradeDate,
      });
      continue;
    }

    if (position.stale) {
      created.push({
        code: position.code,
        type: 'stale',
        level: 'warn',
        title: `${position.name} 使用历史净值`,
        message: `最新净值停留在 ${position.navDate}，已滞后 ${position.staleDays} 天，收益按历史净值估算`,
        tradeDate,
      });
    }

    if (position.growthRate !== null && Math.abs(position.growthRate) >= 3) {
      created.push({
        code: position.code,
        type: 'volatility',
        level: 'info',
        title: `${position.name} 单日${position.growthRate > 0 ? '大涨' : '大跌'} ${Math.abs(position.growthRate).toFixed(2)}%`,
        message: `今日盈亏约 ${position.todayProfit >= 0 ? '+' : ''}${position.todayProfit} 元`,
        tradeDate,
      });
    }

    if (position.profit.risk.reachedTarget) {
      created.push({
        code: position.code,
        type: 'target_reached',
        level: 'critical',
        title: `${position.name} 触及止盈线`,
        message: `真实收益率 ${(position.profit.realRate * 100).toFixed(2)}%，目标 ${(position.targetProfit * 100).toFixed(0)}%。${position.profit.redemption.optimization.text}`,
        tradeDate,
      });
    }

    if (position.profit.risk.reachedStop) {
      created.push({
        code: position.code,
        type: 'stop_loss',
        level: 'critical',
        title: `${position.name} 触及止损线`,
        message: `真实收益率 ${(position.profit.realRate * 100).toFixed(2)}%，止损线 -${(position.stopLoss * 100).toFixed(0)}%`,
        tradeDate,
      });
    }

    const opt = position.profit.redemption.optimization;
    if (opt.worthWaiting && opt.daysToWait > 0 && opt.daysToWait <= 10) {
      created.push({
        code: position.code,
        type: 'fee_window',
        level: 'info',
        title: `${position.name} 即将降费`,
        message: opt.text,
        tradeDate,
      });
    }
  }

  const summary = summarize(positions);
  if (summary.topWeight >= 0.4 && positions.length >= 2) {
    created.push({
      code: null,
      type: 'concentration',
      level: 'warn',
      title: '持仓集中度偏高',
      message: `${summary.topFund} 占总市值 ${(summary.topWeight * 100).toFixed(1)}%，单一标的波动会明显放大组合回撤`,
      tradeDate: today,
    });
  }

  for (const alert of created) {
    persistAlert(alert);
  }
  return created;
}

function persistAlert(alert) {
  const dedupeKey = [alert.tradeDate || todayString(), alert.code || 'portfolio', alert.type].join('|');
  db.run(
    `INSERT OR IGNORE INTO alerts (dedupe_key, fund_code, type, level, title, message, payload, trade_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dedupeKey,
      alert.code,
      alert.type,
      alert.level,
      alert.title,
      alert.message,
      JSON.stringify({ code: alert.code, type: alert.type }),
      alert.tradeDate || todayString(),
    ],
  );
}

function listAlerts(limit = 20, options = {}) {
  const where = options.unreadOnly ? 'WHERE is_read = 0' : '';
  return db
    .all(`SELECT * FROM alerts ${where} ORDER BY id DESC LIMIT ?`, [limit])
    .map((row) => ({
      id: row.id,
      code: row.fund_code,
      type: row.type,
      level: row.level,
      title: row.title,
      message: row.message,
      tradeDate: row.trade_date,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
    }));
}

function markAlertsRead(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    db.run('UPDATE alerts SET is_read = 1 WHERE is_read = 0');
    return { updated: true };
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = db.run(`UPDATE alerts SET is_read = 1 WHERE id IN (${placeholders})`, ids);
  return { updated: info.changes };
}

/** 手动/定时同步：强制刷新净值，并记录可查询的任务状态 */
async function syncAll(reason = 'manual') {
  if (syncState.running) {
    return { status: 'running', message: '已有同步任务在执行' };
  }

  syncState.running = true;
  const job = jobService.start('sync');
  const startedAt = Date.now();
  const stats = { total: 0, succeeded: 0, failed: 0, stale: 0, errors: [] };
  let jobFinished = false;

  try {
    const codes = db.all('SELECT DISTINCT fund_code FROM holdings').map((row) => row.fund_code);
    stats.total = codes.length;

    if (codes.length === 0) {
      jobService.finish(job, 'skipped', { total: 0, reason }, '暂无持仓');
      jobFinished = true;
      return { status: 'skipped', total: 0, succeeded: 0, failed: 0 };
    }

    log.info(`开始同步 ${codes.length} 只基金（${reason}）`);

    await mapWithConcurrency(codes, Math.min(config.fetchConcurrency, 3), async (code) => {
      try {
        const quote = await fundDataService.getQuote(code, { force: true });
        if (quote.isStale) stats.stale += 1;
        else stats.succeeded += 1;
      } catch (error) {
        stats.failed += 1;
        stats.errors.push({ code, message: error.message });
        log.warn(`${code} 同步失败: ${error.message}`);
      }
      await sleep(400);
    });

    try {
      await buildPortfolio({ today: todayString() });
    } catch (error) {
      log.warn(`同步后刷新提醒失败: ${error.message}`);
    }

    db.setSetting('last_sync_at', new Date().toISOString());
    jobService.finish(
      job,
      stats.failed === 0 ? 'success' : 'partial',
      { ...stats, reason, durationMs: Date.now() - startedAt },
      stats.errors.map((e) => `${e.code}: ${e.message}`).join('; '),
    );
    jobFinished = true;
    log.info(`同步完成（${reason}）：成功 ${stats.succeeded}，失败 ${stats.failed}，使用历史数据 ${stats.stale}`);
    return { status: stats.failed === 0 ? 'success' : 'partial', ...stats };
  } catch (error) {
    if (!jobFinished) jobService.finish(job, 'failed', stats, error.message);
    log.error(`同步任务异常（${reason}）: ${error.message}`);
    return { status: 'failed', ...stats, message: error.message };
  } finally {
    syncState.running = false;
  }
}

module.exports = {
  buildPortfolio,
  summarize,
  buildAlerts,
  syncAll,
  listAlerts,
  markAlertsRead,
  persistAlert,
  loadFees,
};
