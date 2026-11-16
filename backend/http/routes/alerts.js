'use strict';

const express = require('express');
const portfolioService = require('../../services/portfolioService');
const { parseId } = require('../../http/validate');
const { badRequest } = require('../../http/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const unreadOnly = req.query.unread === '1';
  res.json(portfolioService.listAlerts(limit, { unreadOnly }));
});

router.post('/read', (req, res) => {
  const ids = req.body?.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(Number(id)))) ) {
    throw badRequest('ids 必须是数组');
  }
  res.json(portfolioService.markAlertsRead(ids ? ids.map(parseId) : []));
});

module.exports = router;
