'use strict';

const express = require('express');
const db = require('../../config/database');
const config = require('../../config/env');
const version = require('../../../package.json').version;
const portfolioService = require('../../services/portfolioService');
const jobService = require('../../services/jobService');
const backupService = require('../../services/backupService');
const fundDataService = require('../../services/fundDataService');
const marketService = require('../../services/marketService');
const scheduler = require('../../services/scheduler');
const { todayString } = require('../../utils/date');
const { lanUrls } = require('../../utils/network');
const { asyncHandler } = require('../../http/errors');
const { createLogger } = require('../../utils/logger');

const log = createLogger('api:system');
const router = express.Router();

router.get('/health', (req, res) => {
  let dbOk = true;
  try {
    db.get('SELECT 1 AS ok');
  } catch (error) {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    version,
    timezone: config.timezone,
    today: todayString(),
    tradingDay: scheduler.isTradingDay(),
    db: dbOk ? 'ok' : 'error',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

router.get('/meta', (req, res) => {
  const holdings = db.get('SELECT COUNT(*) AS n FROM holdings').n;
  const funds = db.get('SELECT COUNT(*) AS n FROM funds').n;
  res.json({
    version,
    timezone: config.timezone,
    today: todayString(),
    tradingDay: scheduler.isTradingDay(),
    tokenRequired: Boolean(config.apiToken),
    holdings,
    funds,
    lastSyncAt: db.getSetting('last_sync_at', null),
    quoteCacheMinutes: Math.round(config.quoteCacheMs / 60000),
    detailCacheDays: config.detailCacheDays,
    port: config.port,
    lanUrls: lanUrls(config.port),
    notes: {
      managementFee: '管理费/托管费已内含于公布净值，收益计算不重复扣除',
      netProfit: '净收益按当前时点全部赎回、扣赎回费后测算',
      holdDays: '持有天数按自然日计算，实际以基金确认日为准',
    },
  });
});

router.post('/sync', (req, res) => {
  portfolioService
    .syncAll('manual')
    .then((result) => log.info(`手动同步完成: ${JSON.stringify(result)}`))
    .catch((error) => log.error(`手动同步失败: ${error.message}`));
  res.status(202).json({ status: 'accepted', message: '同步任务已启动，可轮询 /api/jobs/latest?name=sync 查看结果' });
});

router.get('/jobs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  res.json(jobService.recent(limit));
});

router.get('/jobs/latest', (req, res) => {
  const name = req.query.name ? String(req.query.name) : null;
  res.json(jobService.latest(name));
});

router.get('/market', asyncHandler(async (req, res) => {
  const codes = db.all('SELECT DISTINCT fund_code FROM holdings').map((row) => row.fund_code);
  const snapshot = await marketService.getSnapshot(codes, { force: req.query.refresh === '1' });
  res.json(snapshot);
}));

router.post('/backup', (req, res) => {
  const result = backupService.backupDatabase();
  res.json({ success: true, ...result });
});

router.post('/cache/clear', (req, res) => {
  fundDataService.clearCache();
  res.json({ success: true, message: '行情缓存已清空' });
});

module.exports = router;
