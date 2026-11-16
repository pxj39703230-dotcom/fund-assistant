'use strict';

const db = require('../config/database');
const fundDataService = require('./fundDataService');
const { createLogger } = require('../utils/logger');

const log = createLogger('watchlist');
const COOLING_HOURS = 24;
const STATUSES = new Set(['cooling', 'ready', 'bought', 'dropped']);

function parseLocalTime(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursLeft(coolUntil, now = new Date()) {
  const target = parseLocalTime(coolUntil);
  if (!target) return 0;
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 3600000));
}

function normalizeInput(input = {}) {
  const code = String(input.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    const error = new Error('基金代码必须是 6 位数字');
    error.status = 400;
    throw error;
  }
  const targetNav = input.targetNav === '' || input.targetNav == null ? null : Number(input.targetNav);
  if (targetNav !== null && (!Number.isFinite(targetNav) || targetNav <= 0)) {
    const error = new Error('目标净值要填大于 0 的数字，不填也可以');
    error.status = 400;
    throw error;
  }
  const reason = String(input.reason || '').trim().slice(0, 200);
  const score = input.score === '' || input.score == null ? null : Number(input.score);
  return {
    code,
    name: String(input.name || code).trim().slice(0, 60) || code,
    targetNav,
    reason: reason || '没写理由，先放一晚再说',
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    grade: String(input.grade || '').trim().slice(0, 20) || null,
  };
}

function decorate(row, now = new Date()) {
  const left = hoursLeft(row.cool_until, now);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    targetNav: row.target_nav == null ? null : Number(row.target_nav),
    reason: row.reason,
    score: row.score == null ? null : Number(row.score),
    grade: row.grade,
    status: row.status,
    coolingHours: left,
    isReady: row.status === 'ready' || (row.status === 'cooling' && left === 0),
    createdAt: row.created_at,
    coolUntil: row.cool_until,
    updatedAt: row.updated_at,
  };
}

function refreshCooling() {
  db.run(
    `UPDATE watchlist SET status = 'ready', updated_at = datetime('now', 'localtime')
     WHERE status = 'cooling' AND cool_until <= datetime('now', 'localtime')`,
  );
}

function list() {
  refreshCooling();
  const rows = db.all(
    `SELECT * FROM watchlist WHERE status IN ('cooling', 'ready') ORDER BY
     CASE status WHEN 'cooling' THEN 0 ELSE 1 END, cool_until ASC, id DESC`,
  );
  return rows.map((row) => decorate(row));
}

async function add(input = {}) {
  const clean = normalizeInput(input);
  const active = db.get(
    `SELECT * FROM watchlist WHERE code = ? AND status IN ('cooling', 'ready') ORDER BY id DESC LIMIT 1`,
    [clean.code],
  );
  if (active) {
    const error = new Error(`${clean.code} 已经在想买清单里，先等冷静期结束，别重复加`);
    error.status = 409;
    throw error;
  }

  let name = clean.name;
  if (!name || name === clean.code) {
    try {
      const quote = await fundDataService.getQuote(clean.code);
      name = quote?.name || clean.code;
    } catch (error) {
      log.warn(`${clean.code} 名称获取失败: ${error.message}`);
    }
  }
  if (!name || name === clean.code) {
    try {
      const detail = await fundDataService.getFundDetail(clean.code);
      name = detail?.name || clean.code;
    } catch (error) {
      log.warn(`${clean.code} 详情名称获取失败: ${error.message}`);
    }
  }

  const info = db.run(
    `INSERT INTO watchlist (code, name, target_nav, reason, score, grade, status, cool_until, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'cooling', datetime('now', 'localtime', '+${COOLING_HOURS} hours'), datetime('now', 'localtime'))`,
    [clean.code, name, clean.targetNav, clean.reason, clean.score, clean.grade],
  );
  const row = db.get('SELECT * FROM watchlist WHERE id = ?', [info.id]);
  return decorate(row);
}

function setStatus(id, status) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    const error = new Error('清单条目 ID 不正确');
    error.status = 400;
    throw error;
  }
  if (!STATUSES.has(status) || status === 'cooling') {
    const error = new Error('状态只能是 ready / bought / dropped');
    error.status = 400;
    throw error;
  }
  const info = db.run(
    `UPDATE watchlist SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    [status, Number(id)],
  );
  if (!info.changes) {
    const error = new Error('这条想买记录不存在');
    error.status = 404;
    throw error;
  }
  return decorate(db.get('SELECT * FROM watchlist WHERE id = ?', [Number(id)]));
}

function remove(id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    const error = new Error('清单条目 ID 不正确');
    error.status = 400;
    throw error;
  }
  const info = db.run('DELETE FROM watchlist WHERE id = ?', [Number(id)]);
  if (!info.changes) {
    const error = new Error('这条想买记录不存在');
    error.status = 404;
    throw error;
  }
  return { removed: true };
}

module.exports = { list, add, setStatus, remove, normalizeInput, decorate, hoursLeft, COOLING_HOURS };
