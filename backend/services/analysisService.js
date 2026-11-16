'use strict';

const axios = require('axios');
const db = require('../config/database');
const config = require('../config/env');
const fundDataService = require('./fundDataService');
const portfolioService = require('./portfolioService');
const { simulateDca, compareBenchmark, attribute } = require('../domain/analysis');
const { createLogger } = require('../utils/logger');

const log = createLogger('analysis');
const INDEX_LIMIT = 420;
const CACHE_MS = 10 * 60 * 1000;

const http = axios.create({
  timeout: Math.min(config.fetchTimeoutMs, 8000),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Referer: 'https://quote.eastmoney.com/',
  },
});

let indexCache = { at: 0, rows: null, name: '沪深300' };
const dcaCache = new Map();

async function getIndexRows(limit = INDEX_LIMIT) {
  if (indexCache.rows && Date.now() - indexCache.at < CACHE_MS) return indexCache;
  const response = await http.get('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
    params: {
      secid: '1.000300',
      fields1: 'f1,f2,f3,f4,f5',
      fields2: 'f51,f52,f53,f54,f55',
      klt: 101,
      fqt: 1,
      end: '20500101',
      lmt: limit,
    },
  });
  const data = response.data?.data;
  const rows = (data?.klines || [])
    .map((line) => {
      const [date, , close] = line.split(',');
      return { date, close: Number(close) };
    })
    .filter((row) => row.date && Number.isFinite(row.close));

  if (!rows.length) throw new Error('沪深300 历史行情获取失败');
  indexCache = { at: Date.now(), rows, name: data.name || '沪深300' };
  return indexCache;
}

function getFundMeta(code) {
  const fund = db.get('SELECT name, purchase_rate FROM funds WHERE code = ?', [code]) || {};
  return {
    name: fund.name || code,
    purchaseRate: Number(fund.purchase_rate) || 0,
  };
}

async function getDca({ code, months = 24, amount = 500 } = {}) {
  const code6 = String(code || '').trim();
  if (!/^\d{6}$/.test(code6)) throw new Error('基金代码必须是 6 位数字');
  const monthsNum = Math.min(Math.max(Number(months) || 24, 6), 36);
  const amountNum = Math.min(Math.max(Number(amount) || 500, 100), 100000);
  const cacheKey = `${code6}:${monthsNum}:${amountNum}`;
  const cached = dcaCache.get(cacheKey);
  if (cached && cached.at > Date.now() - CACHE_MS) return cached.value;

  const meta = getFundMeta(code6);
  const days = monthsNum * 22 + 20;
  const rows = await fundDataService.getHistory(code6, days);
  const result = simulateDca(rows, {
    code: code6,
    name: meta.name,
    monthlyAmount: amountNum,
    months: monthsNum,
    purchaseRate: meta.purchaseRate,
  });
  if (result.ok) dcaCache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}

async function getOverview() {
  const [portfolio, index] = await Promise.all([
    portfolioService.buildPortfolio({}),
    getIndexRows().catch((error) => {
      log.warn(`沪深300 行情失败: ${error.message}`);
      return null;
    }),
  ]);

  if (!index) {
    return { benchmark: null, attribution: null, reason: '暂时拿不到沪深300历史行情' };
  }
  const benchmark = compareBenchmark(portfolio.positions, index.rows, portfolio.summary);
  const attribution = attribute(portfolio.positions, portfolio.summary, benchmark);
  return {
    benchmark,
    attribution,
    meta: { today: portfolio.meta.today, indexName: index.name, indexDate: index.rows[index.rows.length - 1].date },
  };
}

module.exports = { getIndexRows, getDca, getOverview };
