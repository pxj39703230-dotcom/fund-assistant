'use strict';

const express = require('express');
const db = require('../../config/database');
const fundDataService = require('../../services/fundDataService');
const portfolioService = require('../../services/portfolioService');
const { asyncHandler, badRequest, notFound } = require('../../http/errors');
const { parseHoldingPayload, parseHoldingPatch, parseId } = require('../../http/validate');
const { todayString } = require('../../utils/date');
const { round4 } = require('../../utils/number');
const { createLogger } = require('../../utils/logger');
const authMiddleware = require('../middleware/auth');

const log = createLogger('api:holdings');
const router = express.Router();

// 所有持仓接口都需要登录
router.use(authMiddleware);

function sharesFor(amount, nav, rate) {
  const net = amount / (1 + (Number(rate) || 0));
  return round4(net / nav);
}

/** 列表：只读本地库，不触发网络请求，供编辑表单/调试使用 - 只返回当前用户的持仓 */
router.get('/', (req, res) => {
  const rows = db.all(`
    SELECT h.id, h.fund_code AS fundCode, f.name AS fundName, h.buy_date AS buyDate,
           h.buy_amount AS buyAmount, h.buy_net_value AS buyNetValue, h.shares,
           h.target_profit AS targetProfit, h.stop_loss AS stopLoss, h.note, h.strategy, h.channel, h.created_at AS createdAt
    FROM holdings h LEFT JOIN funds f ON f.code = h.fund_code
    WHERE h.user_id = ?
    ORDER BY h.buy_date ASC, h.id ASC
  `, [req.userId]);
  res.json(rows);
});

router.post('/', asyncHandler(async (req, res) => {
  const payload = parseHoldingPayload(req.body);
  const fund = db.get('SELECT purchase_rate FROM funds WHERE code = ?', [payload.fundCode]);
  const rate = fund?.purchase_rate ?? 0.0015;
  const shares = sharesFor(payload.buyAmount, payload.buyNetValue, rate);

  const info = db.run(
    `INSERT INTO holdings (fund_code, buy_date, buy_amount, buy_net_value, shares, target_profit, stop_loss, note, strategy, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.fundCode, payload.buyDate, payload.buyAmount, payload.buyNetValue, shares, payload.targetProfit, payload.stopLoss, payload.note, payload.strategy, req.userId],
  );

  // 费率详情不阻塞新增，后台补齐后回填份额（申购费率会影响实际份额）
  fundDataService
    .getFundDetail(payload.fundCode, { force: false })
    .then((detail) => {
      if (!detail) return;
      const freshRate = detail.purchaseRate;
      if (Number.isFinite(Number(freshRate))) {
        db.run('UPDATE holdings SET shares = ? WHERE id = ? AND user_id = ?', [sharesFor(payload.buyAmount, payload.buyNetValue, freshRate), info.id, req.userId]);
      }
    })
    .catch((error) => log.debug(`新增后获取 ${payload.fundCode} 费率失败: ${error.message}`));

  res.status(201).json({
    success: true,
    id: info.id,
    shares,
    message: '持仓已添加',
    rateSource: fund ? '已缓存费率' : '默认费率（详情获取后会自动校正）',
  });
}));

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const patch = parseHoldingPatch(req.body);

  const sets = [];
  const params = [];
  if (patch.targetProfit !== undefined) {
    sets.push('target_profit = ?');
    params.push(patch.targetProfit);
  }
  if (patch.stopLoss !== undefined) {
    sets.push('stop_loss = ?');
    params.push(patch.stopLoss);
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    params.push(patch.note);
  }
  if (patch.strategy !== undefined) {
    sets.push('strategy = ?');
    params.push(patch.strategy);
  }
  sets.push("updated_at = datetime('now', 'localtime')");
  params.push(id);
  params.push(req.userId);

  const info = db.run(`UPDATE holdings SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  if (info.changes === 0) throw notFound('持仓不存在或无权限');
  res.json({ success: true, message: '持仓已更新' });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const info = db.run('DELETE FROM holdings WHERE id = ? AND user_id = ?', [id, req.userId]);
  if (info.changes === 0) throw notFound('持仓不存在或无权限');
  res.json({ success: true, message: '持仓已删除' });
});

/** 重新计算份额（费率更新或历史数据修正后使用） - 只处理当前用户的持仓 */
router.post('/recalc', asyncHandler(async (req, res) => {
  const holdings = db.all('SELECT id, fund_code, buy_amount, buy_net_value FROM holdings WHERE user_id = ?', [req.userId]);
  let updated = 0;
  for (const holding of holdings) {
    const fund = db.get('SELECT purchase_rate FROM funds WHERE code = ?', [holding.fund_code]);
    const rate = fund?.purchase_rate ?? 0.0015;
    const shares = sharesFor(holding.buy_amount, holding.buy_net_value, rate);
    if (Math.abs(shares - Number(holding.shares || 0)) > 1e-6) {
      db.run('UPDATE holdings SET shares = ? WHERE id = ? AND user_id = ?', [shares, holding.id, req.userId]);
      updated += 1;
    }
  }
  res.json({ success: true, updated, total: holdings.length, today: todayString() });
}));

module.exports = router;
