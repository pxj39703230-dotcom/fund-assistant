'use strict';

const express = require('express');
const portfolioService = require('../../services/portfolioService');
const { asyncHandler } = require('../../http/errors');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 所有 portfolio 接口都需要登录
router.use(authMiddleware);

/** 首页聚合接口：一次请求拿到持仓、汇总、提醒，服务端只抓一轮净值 */
router.get('/', asyncHandler(async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await portfolioService.buildPortfolio({ refresh, userId: req.userId });
  res.json(data);
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await portfolioService.buildPortfolio({ refresh, userId: req.userId });
  res.json({ ...data.summary, meta: data.meta });
}));

router.get('/advice', asyncHandler(async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await portfolioService.buildPortfolio({ refresh, userId: req.userId });
  res.json({
    plan: data.advice.plan,
    market: data.market,
    items: data.positions.map((position) => ({
      id: position.id,
      code: position.code,
      name: position.name,
      realPct: Number((position.profit.realRate || 0) * 100),
      ...(position.advice || {}),
    })),
    meta: data.meta,
  });
}));

module.exports = router;
