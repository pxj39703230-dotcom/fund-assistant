'use strict';

const express = require('express');
const fundDataService = require('../../services/fundDataService');
const db = require('../../config/database');
const { asyncHandler, badRequest, notFound } = require('../../http/errors');
const fundCheckService = require('../../services/fundCheckService');
const { parseDays } = require('../../http/validate');
const { safeJson } = require('../../services/fundDataService');

const router = express.Router();

router.get('/:code', asyncHandler(async (req, res) => {
  const quote = await fundDataService.getQuote(req.params.code);
  const fund = db.get('SELECT name, type FROM funds WHERE code = ?', [quote.code]) || {};
  res.json({ ...quote, name: quote.name || fund.name || quote.code, type: fund.type || null });
}));

/** 新增持仓前的预览：名称 + 最新净值 + 费率，减少手填净值出错 */
router.get('/:code/preview', asyncHandler(async (req, res) => {
  const quote = await fundDataService.getQuote(req.params.code);
  let detail = null;
  try {
    detail = await fundDataService.getFundDetail(req.params.code);
  } catch (error) {
    detail = null;
  }
  res.json({
    code: quote.code,
    name: quote.name || detail?.name || quote.code,
    type: detail?.type || null,
    company: detail?.company || null,
    netValue: quote.netValue,
    navDate: quote.navDate,
    growthRate: quote.growthRate,
    isStale: Boolean(quote.isStale),
    source: quote.source,
    fees: detail
      ? {
          purchaseRate: detail.purchaseRate,
          managementRate: detail.managementRate,
          custodyRate: detail.custodyRate,
          salesServiceRate: detail.salesServiceRate,
          redemptionTiers: Array.isArray(detail.redemptionTiers) ? detail.redemptionTiers : safeJson(detail.redemptionTiers),
          detailUpdatedAt: detail.detailUpdatedAt,
        }
      : null,
  });
}));

router.get('/:code/check', asyncHandler(async (req, res) => {
  const code = req.params.code;
  if (!/^\d{6}$/.test(code)) throw badRequest('基金代码必须是 6 位数字');
  const amount = req.query.amount === undefined ? undefined : Number(req.query.amount);
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) throw badRequest('amount 要大于 0');
  const mode = req.query.mode === 'add' || req.query.mode === 'first' ? req.query.mode : undefined;
  const result = await fundCheckService.checkFundByCode(code, { amount, mode });
  res.json(result);
}));

router.get('/:code/detail', asyncHandler(async (req, res) => {
  const detail = await fundDataService.getFundDetail(req.params.code);
  res.json(detail);
}));

router.get('/:code/history', asyncHandler(async (req, res) => {
  const code = req.params.code;
  const days = parseDays(req.query.days, 30);
  const rows = await fundDataService.getHistory(code, days);
  if (!rows.length) throw notFound(`基金 ${code} 暂无历史净值`);
  res.json({ code, days, rows });
}));

module.exports = router;
