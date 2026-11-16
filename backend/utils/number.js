'use strict';

/** 金额四舍五入到分，避免浮点误差累积到展示层 */
function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 净值保留 4 位（场外基金净值通常 4 位小数） */
function round4(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function toNumber(value, fallback = 0) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').replace('%', '')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 0.1532 -> 15.32 */
function toPercent(rate, digits = 2) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return 0;
  return Number((n * 100).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = { round2, round4, toNumber, toPercent, clamp };
