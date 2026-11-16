'use strict';

const db = require('../config/database');
const config = require('../config/env');
const fundDataService = require('./fundDataService');
const marketService = require('./marketService');
const actionsService = require('./actionsService');
const { computeStats, decide, inferStrategy, buildPlan } = require('../domain/advice');
const { mapWithConcurrency } = require('../utils/asyncPool');
const { createLogger } = require('../utils/logger');

const log = createLogger('advice');

const HISTORY_DAYS = 90;

/**
 * 把"持仓 + 净值历史 + 大盘"翻译成可执行建议。
 * 单笔建议挂在 position.advice 上，组合结论挂在 portfolio.advice.plan 上。
 */
async function buildAdvice({ positions, summary, today }) {
  if (!positions || positions.length === 0) {
    return {
      plan: buildPlan({ positions: [], summary, market: {} }),
      items: [],
      market: await safeMarket([], {}),
    };
  }

  const codes = [...new Set(positions.map((p) => p.code))];
  const histories = new Map();
  await mapWithConcurrency(codes.map((code) => ({ code })), Math.min(config.fetchConcurrency, 3), async ({ code }) => {
    try {
      histories.set(code, await fundDataService.getHistory(code, HISTORY_DAYS));
    } catch (error) {
      histories.set(code, []);
      log.warn(`${code} 历史净值获取失败: ${error.message}`);
    }
  });

  const market = await safeMarket(codes, { today });
  const items = positions.map((position) => {
    const rows = histories.get(position.code) || [];
    const stats = computeStats(rows, { buyDate: position.buyDate });
    const stored = String(position.strategy || 'auto');
    const inferred = inferStrategy({ type: position.fundType, name: position.name, volatility: stats.volatility });
    const strategy = stored === 'long' || stored === 'swing' ? stored : inferred.strategy;
    const strategyReason = stored === 'long' || stored === 'swing'
      ? '按你设定的策略判断'
      : inferred.reason;

    // 获取大盘环境数据
    const marketChange = market.indices?.[0]?.changePct || 0; // 上证指数
    const hasPendingAction = actionsService.hasPendingAction(position.id, 'any', today);

    const advice = decide({ 
      position, 
      stats, 
      strategy, 
      strategyReason, 
      today,
      marketChange, // 传入大盘涨跌幅
      hasPendingAction, // 传入是否已有待办
    });
    
    // 如果决策是紧急操作（urgency >= 3），记录到 actions 表
    if (advice.urgency >= 3 && !hasPendingAction) {
      actionsService.recordAction(position.id, advice.verdict, advice.action);
    }
    
    // 如果是止盈且策略是长线+趋势强，自动上调止盈线
    if (advice.verdict === 'take-profit' && strategy === 'long' && stats.trendScore >= 2) {
      const newTarget = Number(position.targetProfit) * 1.1;
      db.run(
        `UPDATE holdings SET target_profit = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
        [newTarget, position.id]
      );
      log.info(`持仓 ${position.id}(${position.code}) 止盈线上调: ${(position.targetProfit * 100).toFixed(1)}% → ${(newTarget * 100).toFixed(1)}%`);
    }

    const estimate = market.estimates?.[position.code] || null;

    return {
      id: position.id,
      code: position.code,
      name: position.name,
      realPct: Number((position.profit?.realRate || 0) * 100),
      estimate: estimate && estimate.estimateNav
        ? { nav: estimate.estimateNav, pct: estimate.estimatePct, time: estimate.estimateTime }
        : null,
      ...advice,
    };
  });

  const plan = buildPlan({ positions, summary, market, adviceList: items });
  return { plan, items, market, statsByCode: Object.fromEntries(items.map((item) => [item.code, item.stats])) };
}

async function safeMarket(codes, options) {
  try {
    return await marketService.getSnapshot(codes, options);
  } catch (error) {
    log.warn(`行情快照失败: ${error.message}`);
    return { indices: [], estimates: {}, state: 'unknown', stateLabel: '行情不可用', asOf: null };
  }
}

/** 给复盘正文引用的"今日建议"摘要 */
function planLines(advice) {
  if (!advice || !advice.plan) return [];
  const lines = [`结论：${advice.plan.headline}`];
  if (advice.plan.subline) lines.push(`说明：${advice.plan.subline}`);
  for (const action of advice.plan.actions) {
    lines.push(`${action.name}（${action.code}）：${action.verdictLabel} —— ${action.action}`);
  }
  for (const flag of advice.plan.flags) {
    lines.push(`提示：${flag.title} —— ${flag.text}`);
  }
  return lines;
}

function holdingsWithStrategy() {
  return db.all('SELECT id, fund_code, strategy FROM holdings');
}

module.exports = { buildAdvice, planLines, holdingsWithStrategy };
