'use strict';

const express = require('express');
const reviewService = require('../../services/reviewService');
const { asyncHandler, badRequest } = require('../../http/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const { type, limit } = req.query;
  if (type && !reviewService.REVIEW_TYPES[type]) throw badRequest('复盘类型不合法');
  res.json(reviewService.listReviews(type, limit));
});

router.post('/:type', asyncHandler(async (req, res) => {
  const type = req.params.type;
  if (!reviewService.REVIEW_TYPES[type]) throw badRequest('复盘类型不合法（daily/weekly/monthly）');
  const result = await reviewService.generate(type);
  if (result.status === 'skipped') return res.json(result);
  res.json({ success: true, ...result });
}));

module.exports = router;
