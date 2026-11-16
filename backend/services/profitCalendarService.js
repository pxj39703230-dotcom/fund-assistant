'use strict';

const db = require('../config/database');
const { todayString, addDays, diffDays } = require('../utils/date');
const { round2 } = require('../utils/number');
const { createLogger } = require('../utils/logger');

const log = createLogger('profit-calendar');

/**
 * 收益日历服务
 * 提供每日收益快照和月度汇总
 */

/**
 * 保存每日快照（由scheduler每天晚上调用）
 */
function saveDailySnapshot(date, portfolioData) {
  const { summary, positions } = portfolioData;
  
  if (!summary) {
    log.warn(`${date} 没有summary数据，跳过快照`);
    return;
  }

  const totalValue = summary.totalValue || 0;
  const totalProfit = summary.totalProfit || 0;

  // 计算当日盈亏：需要对比昨天的总资产
  const yesterday = addDays(date, -1);
  const yesterdaySnapshot = db.get(
    'SELECT total_value FROM daily_snapshots WHERE date = ?',
    [yesterday]
  );

  let dayProfit = 0;
  if (yesterdaySnapshot) {
    dayProfit = totalValue - yesterdaySnapshot.total_value;
  }

  // 插入或更新快照
  db.run(
    `INSERT INTO daily_snapshots (date, total_value, total_profit, day_profit)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_value = excluded.total_value,
       total_profit = excluded.total_profit,
       day_profit = excluded.day_profit`,
    [date, totalValue, totalProfit, dayProfit]
  );

  log.info(`已保存 ${date} 的快照: 总资产=${totalValue}, 当日盈亏=${dayProfit}`);
}

/**
 * 获取指定月份的收益日历
 */
function getMonthCalendar(yearMonth) {
  // yearMonth格式: "2026-11"
  const [year, month] = yearMonth.split('-').map(Number);
  
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('月份格式错误，应为 YYYY-MM');
  }

  // 查询该月所有快照
  const startDate = `${yearMonth}-01`;
  const endDate = month === 12 
    ? `${year + 1}-01-01` 
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const snapshots = db.all(
    `SELECT date, day_profit, total_value
     FROM daily_snapshots
     WHERE date >= ? AND date < ?
     ORDER BY date ASC`,
    [startDate, endDate]
  );

  // 生成月度汇总
  const days = snapshots.map((s) => ({
    date: s.date,
    profit: round2(s.day_profit),
    totalValue: round2(s.total_value)
  }));

  const monthProfit = snapshots.reduce((sum, s) => sum + s.day_profit, 0);
  
  let bestDay = null;
  let worstDay = null;
  
  if (snapshots.length > 0) {
    const sorted = [...snapshots].sort((a, b) => b.day_profit - a.day_profit);
    bestDay = {
      date: sorted[0].date,
      profit: round2(sorted[0].day_profit)
    };
    worstDay = {
      date: sorted[sorted.length - 1].date,
      profit: round2(sorted[sorted.length - 1].day_profit)
    };
  }

  return {
    month: yearMonth,
    days,
    summary: {
      monthProfit: round2(monthProfit),
      bestDay,
      worstDay,
      tradingDays: snapshots.length
    }
  };
}

/**
 * 获取最近N天的收益趋势
 */
function getRecentTrend(days = 30) {
  const today = todayString();
  const startDate = addDays(today, -days);

  const snapshots = db.all(
    `SELECT date, day_profit, total_value
     FROM daily_snapshots
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC`,
    [startDate, today]
  );

  return snapshots.map((s) => ({
    date: s.date,
    profit: round2(s.day_profit),
    totalValue: round2(s.total_value)
  }));
}

/**
 * 初始化快照表（如果不存在）
 */
function ensureSnapshotTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      date DATE PRIMARY KEY,
      total_value REAL NOT NULL,
      total_profit REAL NOT NULL,
      day_profit REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  log.info('daily_snapshots 表已就绪');
}

module.exports = {
  saveDailySnapshot,
  getMonthCalendar,
  getRecentTrend,
  ensureSnapshotTable
};
