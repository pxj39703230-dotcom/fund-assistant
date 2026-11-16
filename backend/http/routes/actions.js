'use strict';

const express = require('express');
const actionsService = require('../../services/actionsService');
const { todayString } = require('../../utils/date');

const router = express.Router();

/**
 * GET /api/actions
 * 获取今天所有待办操作
 */
router.get('/', async (req, res, next) => {
  try {
    const actions = actionsService.getAllTodayPendingActions();
    res.json({ success: true, actions });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/actions/holding/:id
 * 获取某持仓的操作记录
 */
router.get('/holding/:id', async (req, res, next) => {
  try {
    const holdingId = parseInt(req.params.id, 10);
    const pending = actionsService.getTodayActions(holdingId);
    const executed = actionsService.getExecutedActions(holdingId, 10);
    res.json({ success: true, pending, executed });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/actions/:id/execute
 * 标记操作已执行
 */
router.post('/:id/execute', async (req, res, next) => {
  try {
    const actionId = parseInt(req.params.id, 10);
    const { note } = req.body;
    actionsService.markExecuted(actionId, note);
    res.json({ success: true, message: '已标记为已执行' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
