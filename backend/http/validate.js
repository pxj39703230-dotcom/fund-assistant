'use strict';

const { badRequest } = require('./errors');
const { isDateString, todayString, diffDays } = require('../utils/date');

function requireString(value, field, { min = 1, max = 200, pattern = null } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${field} 不能为空`);
  if (trimmed.length > max) throw badRequest(`${field} 长度不能超过 ${max}`);
  if (pattern && !pattern.test(trimmed)) throw badRequest(`${field} 格式不正确`);
  return trimmed;
}

function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw badRequest(`${field} 必须是数字`);
  if (n < min) throw badRequest(`${field} 不能小于 ${min}`);
  if (n > max) throw badRequest(`${field} 不能大于 ${max}`);
  return n;
}

function requireDate(value, field, { allowFuture = false } = {}) {
  if (!isDateString(value)) throw badRequest(`${field} 必须是 YYYY-MM-DD 格式`);
  if (!allowFuture && diffDays(value, todayString()) < 0) throw badRequest(`${field} 不能是未来日期`);
  if (diffDays('2000-01-01', value) < 0) throw badRequest(`${field} 过早，请检查年份`);
  return value;
}

/** 新增持仓入参校验：把前端传来的宽松数据收成明确类型 */
function parseHoldingPayload(body = {}) {
  const fundCode = requireString(body.fundCode, '基金代码', { min: 6, max: 6, pattern: /^\d{6}$/ });
  const buyDate = requireDate(body.buyDate, '买入日期');
  const buyAmount = requireNumber(body.buyAmount, '买入金额', { min: 0.01, max: 100000000 });
  const buyNetValue = requireNumber(body.buyNetValue, '买入净值', { min: 0.0001, max: 1000 });
  const targetProfit = body.targetProfit === undefined || body.targetProfit === ''
    ? 0.3
    : requireNumber(body.targetProfit, '止盈线', { min: 0, max: 2 });
  const stopLoss = body.stopLoss === undefined || body.stopLoss === ''
    ? 0.2
    : requireNumber(body.stopLoss, '止损线', { min: 0, max: 1 });
  const note = body.note ? requireString(body.note, '备注', { max: 200 }) : '';
  const strategy = body.strategy === undefined || body.strategy === '' ? 'auto' : requireStrategy(body.strategy);

  return { fundCode, buyDate, buyAmount, buyNetValue, targetProfit, stopLoss, note, strategy };
}

function parseHoldingPatch(body = {}) {
  const patch = {};
  if (body.targetProfit !== undefined && body.targetProfit !== '') {
    patch.targetProfit = requireNumber(body.targetProfit, '止盈线', { min: 0, max: 2 });
  }
  if (body.stopLoss !== undefined && body.stopLoss !== '') {
    patch.stopLoss = requireNumber(body.stopLoss, '止损线', { min: 0, max: 1 });
  }
  if (body.note !== undefined) {
    patch.note = body.note === '' ? '' : requireString(body.note, '备注', { max: 200 });
  }
  if (body.strategy !== undefined && body.strategy !== '') {
    patch.strategy = requireStrategy(body.strategy);
  }
  if (Object.keys(patch).length === 0) throw badRequest('没有需要更新的字段');
  return patch;
}

/** 持有策略：auto 自动判断 / long 长线 / swing 波段 */
function requireStrategy(value) {
  const text = String(value);
  if (!['auto', 'long', 'swing'].includes(text)) throw badRequest('策略只能是 auto、long 或 swing');
  return text;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID 不合法');
  return id;
}

function parseDays(value, fallback = 30) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 5), 50);
}

module.exports = { requireString, requireNumber, requireDate, requireStrategy, parseHoldingPayload, parseHoldingPatch, parseId, parseDays };
