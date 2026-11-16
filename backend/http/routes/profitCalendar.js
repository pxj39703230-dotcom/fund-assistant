'use strict';

const express = require('express');
const profitCalendarService = require('../../services/profitCalendarService');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const log = createLogger('profit-calendar-routes');

/**
 * GET /api/profit-calendar?month=2026-11
 * 获取指定月份的收益日历
 */
router.get('/', (req, res, next) => {
  try {
    const { month } = req.query;
    
    if (!month) {
      // 默认返回当前月
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return res.json({
        success: true,
        data: profitCalendarService.getMonthCalendar(currentMonth)
      });
    }

    const calendar = profitCalendarService.getMonthCalendar(month);
    res.json({
      success: true,
      data: calendar
    });
  } catch (error) {
    log.error(`获取收益日历失败: ${error.message}`);
    next(error);
  }
});

/**
 * GET /api/profit-calendar/trend?days=30
 * 获取最近N天的收益趋势
 */
router.get('/trend', (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    
    if (days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        message: '天数范围应在1-365之间'
      });
    }

    const trend = profitCalendarService.getRecentTrend(days);
    res.json({
      success: true,
      data: {
        days,
        trend
      }
    });
  } catch (error) {
    log.error(`获取收益趋势失败: ${error.message}`);
    next(error);
  }
});

module.exports = router;
