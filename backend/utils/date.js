'use strict';

const config = require('../config/env');

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 统一使用"交易日/自然日"都需要的 YYYY-MM-DD 字符串，
 * 全部按配置时区（默认 Asia/Shanghai）计算，不依赖宿主机时区。
 */
function todayString(now = new Date()) {
  return DATE_FORMATTER.format(now);
}

function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const p = splitDate(value);
  if (!p || p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return false;
  // Date.UTC 会把 2 月 30 日、13 月自动进位，必须回读校验才叫真校验
  const probe = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return probe.getUTCFullYear() === p.y && probe.getUTCMonth() === p.m - 1 && probe.getUTCDate() === p.d;
}

function splitDate(dateString) {
  const parts = String(dateString).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  return { y, m, d };
}

// 用 UTC 天数序号做差，避免夏令时/时区导致的 ±1 天误差
function toDayIndex(dateString) {
  const p = splitDate(dateString);
  if (!p) return NaN;
  return Date.UTC(p.y, p.m - 1, p.d) / 86400000;
}

/** 两个 YYYY-MM-DD 之间的自然日差（to - from），可正可负 */
function diffDays(from, to) {
  const a = toDayIndex(from);
  const b = toDayIndex(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round(b - a);
}

function addDays(dateString, days) {
  const p = splitDate(dateString);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=周日 … 6=周六 */
function weekday(dateString) {
  const idx = toDayIndex(dateString);
  if (Number.isNaN(idx)) return NaN;
  const d = new Date(idx * 86400000);
  return d.getUTCDay();
}

function isWeekend(dateString) {
  const w = weekday(dateString);
  return w === 0 || w === 6;
}

/** 相对今天的中文描述，用于列表展示 */
function relativeDayLabel(dateString, today = todayString()) {
  const d = diffDays(dateString, today);
  if (Number.isNaN(d)) return dateString;
  if (d === 0) return '今天';
  if (d === 1) return '昨天';
  if (d > 1 && d < 7) return `${d}天前`;
  return dateString;
}

function dateTimeLabel(now = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: config.timezone,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

module.exports = {
  todayString,
  isDateString,
  diffDays,
  addDays,
  weekday,
  isWeekend,
  relativeDayLabel,
  dateTimeLabel,
  toDayIndex,
};
