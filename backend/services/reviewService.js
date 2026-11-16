'use strict';

const db = require('../config/database');
const fundDataService = require('./fundDataService');
const portfolioService = require('./portfolioService');
const jobService = require('./jobService');
const { todayString, addDays, diffDays } = require('../utils/date');
const { round2 } = require('../utils/number');
const { createLogger } = require('../utils/logger');

const log = createLogger('review');

const REVIEW_TYPES = { daily: '每日复盘', weekly: '周度复盘', monthly: '月度复盘' };

async function generate(type = 'daily') {
  if (type === 'weekly') return generatePeriod('weekly', 7);
  if (type === 'monthly') return generatePeriod('monthly', 30);
  return generateDaily();
}

async function generateDaily(today = todayString()) {
  const job = jobService.start('review:daily');
  try {
    const portfolio = await portfolioService.buildPortfolio({ today });
    if (portfolio.positions.length === 0) {
      jobService.finish(job, 'skipped', null, '暂无持仓');
      return { status: 'skipped', message: '暂无持仓，跳过复盘' };
    }

    const { summary, positions } = portfolio;
    const rank = positions
      .filter((p) => p.growthRate !== null)
      .slice()
      .sort((a, b) => b.growthRate - a.growthRate);

    const lines = [];
    lines.push(`${today} · 每日复盘`);
    lines.push('');
    lines.push('一、今日概况');
    lines.push(`组合市值 ${money(summary.value)} 元，今日盈亏 ${signed(summary.todayProfit)} 元（${pct(summary.value ? summary.todayProfit / summary.value : 0)}）。`);
    lines.push(`累计投入 ${money(summary.invest)} 元，真实盈亏 ${signed(summary.realProfit)} 元（${pct(summary.realRate)}），扣除赎回费后净收益 ${signed(summary.netProfit)} 元（${pct(summary.netRate)}）。`);
    lines.push('');
    lines.push('二、今日涨跌');
    const moved = rank.filter((p) => Math.abs(Number(p.growthRate)) > 0.0001);
    if (rank.length === 0) {
      lines.push('今日无有效涨跌幅数据（可能为非交易日或净值未更新）。');
    } else if (moved.length === 0) {
      lines.push('今日所有持仓净值与上一交易日持平（0.00%），无涨跌可排。');
    } else {
      const top = moved.filter((p) => p.growthRate > 0).slice(0, 3);
      const bottom = moved.filter((p) => p.growthRate < 0).slice(-3).reverse();
      if (top.length) {
        lines.push('涨幅前三：');
        top.forEach((p, i) => lines.push(`  ${i + 1}. ${p.name} ${signed(p.growthRate, '%', 2)}，当日 ${signed(p.todayProfit)} 元`));
      } else {
        lines.push('今日没有上涨的持仓。');
      }
      if (bottom.length) {
        lines.push('跌幅前三：');
        bottom.forEach((p, i) => lines.push(`  ${i + 1}. ${p.name} ${signed(p.growthRate, '%', 2)}，当日 ${signed(p.todayProfit)} 元`));
      } else {
        lines.push('今日没有下跌的持仓。');
      }
    }
    lines.push('');
    lines.push('三、持仓明细');
    positions.forEach((p) => {
      lines.push(
        `  ${p.name}（${p.code}）：持有 ${p.profit.holdDays} 天，市值 ${money(p.profit.currentValue)} 元，真实盈亏 ${signed(p.profit.realProfit)} 元（${pct(p.profit.realRate)}），赎回费率 ${pct(p.profit.fees.redemptionRate)}${p.profit.redemption.optimization.worthWaiting ? `，${p.profit.redemption.optimization.text}` : ''}`,
      );
    });
    lines.push('');
    lines.push('四、操作建议');
    buildAdvice(portfolio).forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));

    const plan = portfolio.advice && portfolio.advice.plan;
    if (plan) {
      lines.push('');
      lines.push('五、持仓决策');
      lines.push(`  ${plan.headline}`);
      for (const action of plan.actions || []) {
        lines.push(`  · ${action.name}：${action.verdictLabel} —— ${action.action}`);
      }
      for (const flag of plan.flags || []) {
        lines.push(`  ! ${flag.title}：${flag.text}`);
      }
    }
    lines.push('');
    lines.push('注：真实盈亏已扣申购费；管理费、托管费已内含在净值中；净收益按当前时点全部赎回测算。');

    const content = lines.join('\n');
    const data = {
      date: today,
      type: 'daily',
      summary,
      positions: positions.map((p) => ({
        code: p.code,
        name: p.name,
        growthRate: p.growthRate,
        todayProfit: p.todayProfit,
        realProfit: p.profit.realProfit,
        realRate: p.profit.realRate,
        holdDays: p.profit.holdDays,
        currentValue: p.profit.currentValue,
      })),
      advice: buildAdvice(portfolio),
      plan: plan
        ? {
            headline: plan.headline,
            tone: plan.tone,
            actions: plan.actions || [],
            flags: plan.flags || [],
          }
        : null,
    };

    saveReview(today, 'daily', content, data);
    log.info(`每日复盘已生成（${positions.length} 笔持仓）`);
    jobService.finish(job, 'success', { positions: positions.length });
    return { status: 'success', date: today, summary, advice: data.advice };
  } catch (error) {
    jobService.finish(job, 'failed', null, error.message);
    throw error;
  }
}

async function generatePeriod(type, days) {
  const today = todayString();
  const fromDate = addDays(today, -days);
  const job = jobService.start(`review:${type}`);

  try {
    const portfolio = await portfolioService.buildPortfolio({ today });
    if (portfolio.positions.length === 0) {
      jobService.finish(job, 'skipped', null, '暂无持仓');
      return { status: 'skipped', message: '暂无持仓，跳过复盘' };
    }

    const codes = [...new Set(portfolio.positions.map((p) => p.code))];
    const changes = [];

    for (const code of codes) {
      try {
        const history = await fundDataService.getHistory(code, Math.min(days + 10, 50));
        if (history.length < 2) continue;
        const end = history[history.length - 1];
        const start = history.filter((row) => diffDays(row.date, fromDate) <= 0).pop() || history[0];
        const periodRate = start.netValue > 0 ? (end.netValue - start.netValue) / start.netValue : 0;
        const positions = portfolio.positions.filter((p) => p.code === code);
        const shares = positions.reduce((sum, p) => sum + p.profit.shares, 0);
        changes.push({
          code,
          name: positions[0].name,
          fromDate: start.date,
          toDate: end.date,
          fromNav: start.netValue,
          toNav: end.netValue,
          periodRate,
          shares,
          periodProfit: round2(shares * (end.netValue - start.netValue)),
        });
      } catch (error) {
        log.debug(`${code} 区间净值获取失败: ${error.message}`);
      }
    }

    const periodProfit = round2(changes.reduce((sum, c) => sum + c.periodProfit, 0));
    const sorted = changes.slice().sort((a, b) => b.periodRate - a.periodRate);

    const lines = [];
    lines.push(`${today} · ${REVIEW_TYPES[type]}（${fromDate} ~ ${today}）`);
    lines.push('');
    lines.push('一、区间表现');
    lines.push(`组合市值变化 ${signed(periodProfit)} 元，同期真实盈亏 ${signed(portfolio.summary.realProfit)} 元（${pct(portfolio.summary.realRate)}）。`);
    lines.push('');
    lines.push('二、基金区间涨跌');
    if (sorted.length === 0) {
      lines.push('区间净值数据不足，无法统计。');
    } else {
      sorted.forEach((c, i) => {
        lines.push(`  ${i + 1}. ${c.name}（${c.code}） ${pct(c.periodRate)}，净值 ${c.fromNav}（${c.fromDate}） → ${c.toNav}（${c.toDate}），区间盈亏 ${signed(c.periodProfit)} 元`);
      });
    }
    lines.push('');
    lines.push('三、操作建议');
    buildAdvice(portfolio, { periodProfit }).forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));

    const content = lines.join('\n');
    const data = { date: today, type, fromDate, toDate: today, summary: portfolio.summary, changes, periodProfit };
    saveReview(today, type, content, data);

    jobService.finish(job, 'success', { funds: changes.length, periodProfit });
    return { status: 'success', date: today, type, periodProfit };
  } catch (error) {
    jobService.finish(job, 'failed', null, error.message);
    throw error;
  }
}

/** 规则化建议：只基于已算出来的事实，不做涨跌预测 */
function buildAdvice(portfolio, extra = {}) {
  const advice = [];
  const { summary, positions } = portfolio;

  const hitTarget = positions.filter((p) => p.profit.risk.reachedTarget);
  if (hitTarget.length) {
    advice.push(`${hitTarget.map((p) => p.name).join('、')} 已达止盈线，可考虑分批止盈而不是一次性清仓（先卖一部分锁定收益，剩余仓位把止盈线上移）。`);
  }

  const hitStop = positions.filter((p) => p.profit.risk.reachedStop);
  if (hitStop.length) {
    advice.push(`${hitStop.map((p) => p.name).join('、')} 已触及止损线，若最初的投资逻辑已改变，应按纪律减仓；若只是市场整体回调，可复核后再决定。`);
  }

  const feeWindow = positions.filter((p) => p.profit.redemption.optimization.worthWaiting && p.profit.redemption.optimization.daysToWait <= 15);
  if (feeWindow.length) {
    advice.push(`${feeWindow.map((p) => `${p.name}（再持有 ${p.profit.redemption.optimization.daysToWait} 天）`).join('、')} 即将进入更低赎回费率档，短期没有明确卖出理由的话，等过这几天再动手更划算。`);
  }

  if (summary.topWeight >= 0.4 && positions.length >= 2) {
    advice.push(`持仓集中度偏高：${summary.topFund} 占总市值 ${(summary.topWeight * 100).toFixed(1)}%，建议后续新增资金优先分散到其他相关性低的品种。`);
  }

  if (summary.staleCount > 0) {
    advice.push(`有 ${summary.staleCount} 笔持仓的净值未能更新（用了本地历史净值），请先确认数据源或在交易时段手动同步，再据此做决策。`);
  }

  const avgGrowth = positions
    .filter((p) => p.growthRate !== null)
    .reduce((sum, p, _, arr) => sum + p.growthRate / arr.length, 0);
  if (Number.isFinite(avgGrowth) && Math.abs(avgGrowth) >= 2) {
    advice.push(avgGrowth > 0
      ? '今日整体上涨，属于普涨行情，不建议因为单日涨幅追高加仓，按既定定投节奏执行即可。'
      : '今日整体下跌，先区分是市场普跌还是单只基金的问题：普跌不必恐慌，单只明显跑输再考虑换仓。');
  }

  if (extra.periodProfit !== undefined && Number.isFinite(extra.periodProfit)) {
    advice.push(`区间内组合市值变化 ${signed(extra.periodProfit)} 元，与同期真实盈亏对比较，差额主要来自申购费和份额确认时点，属正常。`);
  }

  if (advice.length === 0) {
    advice.push('组合运行平稳，无触线、无降费窗口，保持现有节奏即可，不需要操作。');
  }

  return advice.slice(0, 6);
}

function saveReview(date, type, content, data) {
  db.run('DELETE FROM reviews WHERE date = ? AND type = ?', [date, type]);
  db.run('INSERT INTO reviews (date, type, content, data) VALUES (?, ?, ?, ?)', [date, type, content, JSON.stringify(data)]);
}

function listReviews(type, limit = 10) {
  const params = [];
  let sql = 'SELECT * FROM reviews';
  if (type) {
    sql += ' WHERE type = ?';
    params.push(type);
  }
  sql += ' ORDER BY date DESC, id DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 10, 1), 100));
  return db.all(sql, params).map((row) => ({
    id: row.id,
    date: row.date,
    type: row.type,
    typeName: REVIEW_TYPES[row.type] || row.type,
    content: row.content,
    data: row.data ? safeParse(row.data) : null,
    createdAt: row.created_at,
  }));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

function signed(n, unit = '', digits = 2) {
  const value = Number(n || 0);
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${unit}`;
}

function pct(rate) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`;
}

module.exports = { generate, generateDaily, generatePeriod, listReviews, REVIEW_TYPES };
