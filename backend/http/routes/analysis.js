'use strict';

const express = require('express');
const analysisService = require('../../services/analysisService');
const { asyncHandler, badRequest } = require('../../http/errors');

const router = express.Router();

router.get('/overview', asyncHandler(async (req, res) => {
  res.json(await analysisService.getOverview());
}));

router.get('/dca', asyncHandler(async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw badRequest('基金代码必须是 6 位数字');
  const months = req.query.months ? Number(req.query.months) : 24;
  const amount = req.query.amount ? Number(req.query.amount) : 500;
  if (!Number.isFinite(months) || months < 6 || months > 36) throw badRequest('测算月数需在 6-36 之间');
  if (!Number.isFinite(amount) || amount < 100 || amount > 100000) throw badRequest('每月金额需在 100-100000 之间');
  res.json(await analysisService.getDca({ code, months, amount }));
}));

module.exports = router;
