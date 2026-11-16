'use strict';

const express = require('express');
const constitutionService = require('../../services/constitutionService');
const fundCheckService = require('../../services/fundCheckService');
const { badRequest } = require('../../http/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const rules = constitutionService.read();
  res.json({ rules, updatedAt: constitutionService.updatedAt() });
});

router.put('/', (req, res) => {
  const rules = constitutionService.save(req.body || {});
  res.json({ rules, updatedAt: constitutionService.updatedAt() });
});

router.post('/check', async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw badRequest('基金代码必须是 6 位数字');
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('准备买入金额要大于 0');
    if (amount > 1000000) throw badRequest('金额过大，先确认是不是多输了几个 0');
    const check = await fundCheckService.checkFundByCode(code, { amount, mode: req.body?.mode });
    res.json({ check, constitution: check.constitution });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
