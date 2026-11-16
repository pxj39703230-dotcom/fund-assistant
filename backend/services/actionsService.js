'use strict';

/**
 * 操作记录服务：记录程序的建议操作和用户的实际执行
 * 解决问题：程序今天说"该卖一半"，明天不知道你卖没卖，还会继续说
 */

const db = require('../config/database');
const { todayString } = require('../utils/date');
const { createLogger } = require('../utils/logger');

const log = createLogger('actions');

/**
 * 记录一个待办操作
 * @param {number} holdingId 持仓ID
 * @param {string} verdict 决策结论 'stop-loss' / 'take-profit' / 'reduce' / 'exit'
 * @param {string} action 具体动作 '今天卖一半，明天卖剩下' / '分批止盈' / '减仓一半'
 */
function recordAction(holdingId, verdict, action) {
  const date = todayString();
  const dedupe = `${holdingId}-${date}-${verdict}`;
  
  const existing = db.get(
    'SELECT id FROM actions WHERE holding_id = ? AND date = ? AND verdict = ?',
    [holdingId, date, verdict]
  );
  
  if (existing) {
    log.debug(`操作已记录: holding=${holdingId}, verdict=${verdict}`);
    return existing.id;
  }
  
  const result = db.run(
    `INSERT INTO actions (holding_id, date, verdict, action, executed, created_at)
     VALUES (?, ?, ?, ?, 0, datetime('now', 'localtime'))`,
    [holdingId, date, verdict, action]
  );
  
  log.info(`记录待办操作: holding=${holdingId}, verdict=${verdict}, action=${action}`);
  return result.id;
}

/**
 * 标记操作已执行
 * @param {number} actionId 操作ID
 * @param {string} note 执行备注
 */
function markExecuted(actionId, note = null) {
  db.run(
    `UPDATE actions SET executed = 1, note = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`,
    [note, actionId]
  );
  log.info(`操作已标记执行: id=${actionId}, note=${note || '无'}`);
}

/**
 * 获取持仓今天的待办操作
 * @param {number} holdingId 持仓ID
 * @param {string} date 日期，默认今天
 */
function getTodayActions(holdingId, date = null) {
  const targetDate = date || todayString();
  return db.all(
    `SELECT * FROM actions 
     WHERE holding_id = ? AND date = ? AND executed = 0
     ORDER BY created_at DESC`,
    [holdingId, targetDate]
  );
}

/**
 * 获取持仓最近的已执行操作
 * @param {number} holdingId 持仓ID
 * @param {number} limit 返回数量
 */
function getExecutedActions(holdingId, limit = 5) {
  return db.all(
    `SELECT * FROM actions 
     WHERE holding_id = ? AND executed = 1
     ORDER BY date DESC, created_at DESC
     LIMIT ?`,
    [holdingId, limit]
  );
}

/**
 * 检查持仓今天是否已有某个verdict的待办
 * @param {number} holdingId 持仓ID
 * @param {string} verdict 决策结论
 * @param {string} date 日期，默认今天
 */
function hasPendingAction(holdingId, verdict, date = null) {
  const targetDate = date || todayString();
  const row = db.get(
    `SELECT COUNT(*) as count FROM actions 
     WHERE holding_id = ? AND date = ? AND verdict = ? AND executed = 0`,
    [holdingId, targetDate, verdict]
  );
  return row && row.count > 0;
}

/**
 * 获取所有今天的待办操作（跨持仓）
 * @param {string} date 日期，默认今天
 */
function getAllTodayPendingActions(date = null) {
  const targetDate = date || todayString();
  return db.all(
    `SELECT a.*, h.fund_code 
     FROM actions a
     LEFT JOIN holdings h ON a.holding_id = h.id
     WHERE a.date = ? AND a.executed = 0
     ORDER BY a.created_at ASC`,
    [targetDate]
  );
}

/**
 * 清理旧的待办操作（超过30天未执行的自动标记为过期）
 */
function cleanupOldActions() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffDate = cutoff.toISOString().split('T')[0];
  
  const result = db.run(
    `UPDATE actions SET note = '超过30天未执行，已自动标记过期'
     WHERE executed = 0 AND date < ?`,
    [cutoffDate]
  );
  
  if (result.changes > 0) {
    log.info(`清理了 ${result.changes} 条超过30天的待办操作`);
  }
  return result.changes;
}

module.exports = {
  recordAction,
  markExecuted,
  getTodayActions,
  getExecutedActions,
  hasPendingAction,
  getAllTodayPendingActions,
  cleanupOldActions,
};
