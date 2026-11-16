'use strict';

const db = require('../config/database');
const { todayString, addDays } = require('../utils/date');
const { round2 } = require('../utils/number');
const { createLogger } = require('../utils/logger');

const log = createLogger('dashboard');

/**
 * 新手友好的仪表盘服务
 * 提供总览、今日任务、简化持仓列表
 */

/**
 * 获取总资产和收益汇总
 */
function getSummary(positions) {
  if (!positions || positions.length === 0) {
    return {
      totalValue: 0,
      todayProfit: 0,
      todayPct: 0,
      totalProfit: 0,
      totalPct: 0,
      holdingCount: 0
    };
  }

  let totalValue = 0;
  let todayProfit = 0;
  let totalProfit = 0;
  let totalPrincipal = 0;

  for (const pos of positions) {
    if (!pos.profit) continue;
    
    totalValue += pos.profit.currentValue || 0;
    todayProfit += pos.todayProfit || 0;
    totalProfit += pos.profit.realProfit || 0;
    totalPrincipal += pos.profit.principal || 0;
  }

  const todayPct = totalValue > 0 ? (todayProfit / totalValue) * 100 : 0;
  const totalPct = totalPrincipal > 0 ? (totalProfit / totalPrincipal) * 100 : 0;

  return {
    totalValue: round2(totalValue),
    todayProfit: round2(todayProfit),
    todayPct: round2(todayPct),
    totalProfit: round2(totalProfit),
    totalPct: round2(totalPct),
    holdingCount: positions.length
  };
}

/**
 * 生成今日任务清单（白话版）
 */
function getTodayTasks(positions, actions) {
  const tasks = [];

  // 从actions表获取待执行操作
  if (actions && actions.length > 0) {
    for (const action of actions) {
      const pos = positions.find((p) => p.id === action.holding_id);
      if (!pos) continue;

      tasks.push({
        id: action.id,
        holdingId: action.holding_id,
        fundCode: pos.code,
        fundName: pos.name,
        type: mapVerdictToTaskType(action.verdict),
        urgency: mapVerdictToUrgency(action.verdict),
        reason: simplifyReason(action.verdict, pos),
        action: action.action,
        amount: estimateAmount(action.verdict, pos),
        createdAt: action.created_at
      });
    }
  }

  return tasks;
}

/**
 * 映射判决类型到任务类型
 */
function mapVerdictToTaskType(verdict) {
  const typeMap = {
    'exit': 'sell',
    'reduce': 'sell',
    'take-profit': 'sell',
    'wait-fee': 'wait',
    'hold': 'hold',
    'watch': 'watch'
  };
  return typeMap[verdict] || 'other';
}

/**
 * 映射判决到紧急程度
 */
function mapVerdictToUrgency(verdict) {
  const urgencyMap = {
    'exit': 'high',          // 止损
    'reduce': 'high',        // 减仓
    'take-profit': 'medium', // 止盈
    'wait-fee': 'low',       // 等费率
    'hold': 'low',
    'watch': 'low'
  };
  return urgencyMap[verdict] || 'low';
}

/**
 * 简化原因为白话
 */
function simplifyReason(verdict, position) {
  const reasonMap = {
    'exit': `已跌破止损线，亏了${Math.abs(position.profit?.realRate * 100 || 0).toFixed(1)}%`,
    'reduce': '趋势走弱，建议先减一半仓位',
    'take-profit': `已经赚了${(position.profit?.realRate * 100 || 0).toFixed(1)}%，先落袋为安`,
    'wait-fee': '还差几天手续费就降了，先不急着卖',
    'hold': '继续持有，暂时不用动',
    'watch': '观察中'
  };
  return reasonMap[verdict] || '需要关注';
}

/**
 * 估算操作金额（卖一半）
 */
function estimateAmount(verdict, position) {
  if (!['exit', 'reduce', 'take-profit'].includes(verdict)) {
    return null;
  }
  const currentValue = position.profit?.currentValue || 0;
  return round2(currentValue / 2);
}

/**
 * 生成简化的持仓列表
 */
function getSimpleHoldings(positions) {
  return positions.map((pos) => {
    const profitPct = (pos.profit?.realRate || 0) * 100;
    const isProfit = profitPct > 0;
    
    return {
      id: pos.id,
      code: pos.code,
      name: pos.name,
      value: round2(pos.profit?.currentValue || 0),
      profitPct: round2(profitPct),
      profitAmount: round2(pos.profit?.realProfit || 0),
      color: isProfit ? 'red' : 'green', // 中国股市习惯：红涨绿跌
      statusText: generateStatusText(pos),
      buyDate: pos.buyDate,
      holdDays: pos.profit?.holdDays || 0
    };
  });
}

/**
 * 生成状态文本（白话）
 */
function generateStatusText(position) {
  const advice = position.advice;
  if (!advice) return '数据加载中';

  const profitPct = (position.profit?.realRate || 0) * 100;
  
  // 根据verdict生成状态文本
  switch (advice.verdict) {
    case 'exit':
      return '⚠️ 已触发止损，建议卖出';
    case 'reduce':
      return '⚠️ 趋势走弱，建议减仓';
    case 'take-profit':
      if (profitPct > 40) {
        return '🎉 大赚！先锁定一半利润';
      }
      return '✅ 到止盈线了，先落袋为安';
    case 'wait-fee':
      return '⏳ 快到降费率的时间了';
    case 'hold':
      if (profitPct > 10) {
        return '💰 赚钱中，继续持有';
      } else if (profitPct > 0) {
        return '📈 小赚，继续观察';
      } else if (profitPct > -5) {
        return '📊 小亏，正常波动';
      }
      return '💧 亏损中，耐心等待';
    case 'watch':
      if (position.profit?.holdDays < 7) {
        return `🆕 刚买${position.profit.holdDays}天，先别动`;
      }
      return '👀 观察中';
    default:
      return '持有中';
  }
}

/**
 * 核心方法：构建新手友好的仪表盘
 */
async function buildDashboard(portfolioData) {
  const positions = portfolioData.positions || [];
  
  // 获取今日待办操作
  const pendingActions = db.all(
    `SELECT a.*, h.fund_code 
     FROM actions a 
     LEFT JOIN holdings h ON a.holding_id = h.id 
     WHERE a.date = ? AND a.executed = 0 
     ORDER BY a.created_at ASC`,
    [todayString()]
  );

  const summary = getSummary(positions);
  const todayTasks = getTodayTasks(positions, pendingActions);
  const holdings = getSimpleHoldings(positions);

  // 生成今日总结文本
  const todaySummary = generateTodaySummary(summary, todayTasks);

  return {
    summary,
    todaySummary,
    todayTasks,
    holdings,
    timestamp: new Date().toISOString()
  };
}

/**
 * 生成今日总结文本
 */
function generateTodaySummary(summary, tasks) {
  const hasTask = tasks.length > 0;
  const highUrgencyTasks = tasks.filter((t) => t.urgency === 'high');

  if (hasTask) {
    if (highUrgencyTasks.length > 0) {
      return {
        type: 'warning',
        icon: '⚠️',
        text: `有${highUrgencyTasks.length}笔紧急操作待处理`,
        action: '立即查看'
      };
    }
    return {
      type: 'info',
      icon: '📋',
      text: `有${tasks.length}笔操作待处理`,
      action: '查看详情'
    };
  }

  // 没有待办任务
  if (summary.todayProfit > 0) {
    return {
      type: 'success',
      icon: '✅',
      text: `全部搞定！今天赚了￥${summary.todayProfit.toFixed(2)} 🎉`,
      action: null
    };
  } else if (summary.todayProfit < 0) {
    return {
      type: 'neutral',
      icon: '✅',
      text: '全部搞定！今天小亏，正常波动',
      action: null
    };
  }

  return {
    type: 'success',
    icon: '✅',
    text: '全部搞定！今天不用操作',
    action: null
  };
}

module.exports = {
  buildDashboard,
  getSummary,
  getTodayTasks,
  getSimpleHoldings
};
