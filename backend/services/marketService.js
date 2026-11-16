'use strict';

const axios = require('axios');
const db = require('../config/database');
const config = require('../config/env');
const { todayString, isWeekend, dateTimeLabel } = require('../utils/date');
const { createLogger } = require('../utils/logger');

const log = createLogger('market');

const http = axios.create({
  timeout: Math.min(config.fetchTimeoutMs, 6000),
  validateStatus: (status) => status >= 200 && status < 500,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Referer: 'https://finance.qq.com/',
  },
  responseType: 'arraybuffer',
});

const INDEXES = [
  { code: 'sh000001', name: '上证指数' },
  { code: 'sz399001', name: '深证成指' },
  { code: 'sz399006', name: '创业板指' },
];

const CACHE_MS = 60 * 1000;
let cache = { at: 0, value: null };

function decodeGbk(buffer) {
  try {
    return new TextDecoder('gbk').decode(Buffer.from(buffer));
  } catch (error) {
    return Buffer.from(buffer).toString('utf8');
  }
}

/** 交易时段状态：A 股 9:30-11:30 / 13:00-15:00 */
function marketState(today = todayString()) {
  if (isWeekend(today)) return { state: 'holiday', label: '周末休市' };
  const holiday = db.get('SELECT date FROM trading_holidays WHERE date = ?', [today]);
  if (holiday) return { state: 'holiday', label: '休市' };

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  const minutes = hour * 60 + minute;

  if (minutes < 9 * 60 + 30) return { state: 'pre', label: '开盘前' };
  if (minutes <= 11 * 60 + 30) return { state: 'trading', label: '交易中' };
  if (minutes < 13 * 60) return { state: 'break', label: '午间休市' };
  if (minutes <= 15 * 60) return { state: 'trading', label: '交易中' };
  return { state: 'closed', label: '已收盘' };
}

async function fetchIndices() {
  const url = `https://qt.gtimg.cn/q=${INDEXES.map((item) => item.code).join(',')}`;
  const response = await http.get(url);
  const text = decodeGbk(response.data);

  return text
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('v_'))
    .map((line) => {
      const body = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
      const fields = body.split('~');
      const price = Number(fields[3]);
      const prevClose = Number(fields[4]);
      const change = Number(fields[31]);
      let pct = Number(fields[32]);
      if (!Number.isFinite(pct) && prevClose > 0) pct = (price / prevClose - 1) * 100;
      return {
        code: fields[2],
        name: fields[1],
        price: Number.isFinite(price) ? price : null,
        prevClose: Number.isFinite(prevClose) ? prevClose : null,
        change: Number.isFinite(change) ? change : null,
        pct: Number.isFinite(pct) ? pct : null,
        time: fields[30] || null,
      };
    })
    .filter((item) => item.price);
}

/** 盘中估值（东财手机端接口，交易时段才有 GSZ，收盘后为 null） */
async function fetchEstimates(codes) {
  const list = [...new Set(codes)].filter((code) => /^\d{6}$/.test(String(code)));
  if (list.length === 0) return {};
  const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';
  const response = await http.get(url, {
    responseType: 'json',
    headers: { 'User-Agent': 'EMProjJijin/6.2.8 (iPhone; iOS 16.0)', Referer: 'https://fund.eastmoney.com/' },
    params: {
      pageIndex: 1,
      pageSize: Math.min(list.length, 40),
      plat: 'Android',
      appType: 'ttjj',
      product: 'EFund',
      Version: 1,
      deviceid: 'fund-assistant',
      Fcodes: list.join(','),
    },
  });

  const rows = response.data?.Datas || [];
  const map = {};
  for (const row of rows) {
    if (!row || !row.FCODE) continue;
    const estimate = Number(row.GSZ);
    map[row.FCODE] = {
      code: row.FCODE,
      name: row.SHORTNAME,
      nav: Number(row.NAV) || null,
      navDate: row.PDATE || null,
      navGrowth: Number.isFinite(Number(row.NAVCHGRT)) ? Number(row.NAVCHGRT) : null,
      estimateNav: Number.isFinite(estimate) && estimate > 0 ? estimate : null,
      estimatePct: Number.isFinite(Number(row.GSZZL)) && row.GSZZL !== null ? Number(row.GSZZL) : null,
      estimateTime: row.GZTIME || response.data?.Expansion?.GZTIME || null,
    };
  }
  return map;
}

/**
 * 看盘快照：指数 + 持仓估值 + 交易时段。
 * 60 秒缓存，前端轮询也不会把上游打成限流。
 */
async function getSnapshot(codes = [], options = {}) {
  const fresh = options.force || Date.now() - cache.at > CACHE_MS;
  const state = marketState();
  if (!fresh && cache.value) return { ...cache.value, state };

  const [indicesResult, estimatesResult] = await Promise.allSettled([fetchIndices(), fetchEstimates(codes)]);
  const indices = indicesResult.status === 'fulfilled' ? indicesResult.value : [];
  const estimates = estimatesResult.status === 'fulfilled' ? estimatesResult.value : {};

  if (indicesResult.status === 'rejected') log.warn(`指数获取失败: ${indicesResult.reason.message}`);
  if (estimatesResult.status === 'rejected') log.debug(`估值获取失败: ${estimatesResult.reason.message}`);

  const value = {
    indices,
    estimates,
    state: state.state,
    stateLabel: state.label,
    asOf: new Date().toISOString(),
    readableAt: dateTimeLabel(),
    indexError: indices.length === 0 ? '指数行情暂时取不到' : null,
  };
  if (indices.length) cache = { at: Date.now(), value };
  return value;
}

function clearCache() {
  cache = { at: 0, value: null };
}

module.exports = { getSnapshot, clearCache, marketState };
