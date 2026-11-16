'use strict';

const express = require('express');
const watchlistService = require('../../services/watchlistService');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ items: watchlistService.list(), coolingHours: watchlistService.COOLING_HOURS });
});

router.post('/', async (req, res, next) => {
  try {
    const item = await watchlistService.add(req.body || {});
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const item = watchlistService.setStatus(req.params.id, String(req.body?.status || ''));
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    res.json(watchlistService.remove(req.params.id));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
