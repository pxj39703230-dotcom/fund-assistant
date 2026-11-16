'use strict';

const express = require('express');
const portfolioService = require('../../services/portfolioService');
const dashboardService = require('../../services/dashboardService');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const log = createLogger('dashboard-routes');

/**
 * GET /api/dashboard
 * 新手友好的首页总览
 */
router.get('/', async (req, res, next) => {
  try {
    // 先获取完整的portfolio数据
    const portfolioData = await portfolioService.buildPortfolio({
      today: req.query.today,
      refresh: Boolean(req.query.refresh)
    });

    // 转换为新手友好的dashboard格式
    const dashboard = await dashboardService.buildDashboard(portfolioData);

    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    log.error(`获取dashboard失败: ${error.message}`);
    next(error);
  }
});

/**
 * POST /api/dashboard/quick-action/:actionId
 * 一键操作：复制金额+准备跳转蚂蚁财富
 */
router.post('/quick-action/:actionId', async (req, res, next) => {
  try {
    const { actionId } = req.params;
    const db = require('../../config/database');

    const action = db.get('SELECT * FROM actions WHERE id = ?', [actionId]);
    if (!action) {
      return res.status(404).json({
        success: false,
        message: '操作不存在'
      });
    }

    // 获取持仓信息
    const holding = db.get('SELECT * FROM holdings WHERE id = ?', [action.holding_id]);
    if (!holding) {
      return res.status(404).json({
        success: false,
        message: '持仓不存在'
      });
    }

    // 估算金额（卖一半）
    const fund = db.get('SELECT last_net_value FROM funds WHERE code = ?', [holding.fund_code]);
    const currentValue = holding.shares * (fund?.last_net_value || holding.buy_net_value);
    const amount = Math.round(currentValue / 2 * 100) / 100; // 卖一半，保留2位小数

    // 生成蚂蚁财富的deep link（如果在移动端）
    // 注意：这是假设的链接格式，实际需要根据蚂蚁财富的URL Scheme调整
    const deeplink = `alipays://platformapi/startapp?appId=20000153&fundCode=${holding.fund_code}&action=redeem&amount=${amount}`;

    res.json({
      success: true,
      data: {
        actionId,
        fundCode: holding.fund_code,
        fundName: action.fund_name || holding.fund_code,
        amount,
        clipboardText: String(amount), // 要复制到剪贴板的文本
        deeplink,                       // 移动端跳转链接
        webUrl: `https://www.antfortune.com/` // Web端备用链接
      }
    });
  } catch (error) {
    log.error(`快捷操作失败: ${error.message}`);
    next(error);
  }
});

module.exports = router;
