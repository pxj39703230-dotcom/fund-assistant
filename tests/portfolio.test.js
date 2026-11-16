'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `fund-assistant-test-${Date.now()}-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.BACKUP_ENABLED = 'false';

const db = require('../backend/config/database');
const { summarize, buildAlerts, listAlerts } = require('../backend/services/portfolioService');

test.after(() => {
  db.close();
  try {
    fs.unlinkSync(tmpDb);
  } catch (error) {
    /* ignore */
  }
});

function position(overrides = {}) {
  return {
    id: overrides.id || 1,
    code: overrides.code || '110022',
    name: overrides.name || '易方达消费行业',
    buyAmount: overrides.buyAmount || 10000,
    navDate: '2026-11-12',
    growthRate: overrides.growthRate ?? 0,
    todayProfit: overrides.todayProfit ?? 0,
    stale: Boolean(overrides.stale),
    staleDays: overrides.staleDays || 0,
    priced: overrides.priced ?? true,
    error: overrides.error || null,
    targetProfit: 0.3,
    stopLoss: 0.2,
    profit: {
      currentValue: overrides.currentValue || 11690.46,
      netProceeds: overrides.netProceeds || 11632.01,
      bookProfit: overrides.bookProfit || 1708,
      realProfit: overrides.realProfit || 1690.46,
      netProfit: overrides.netProfit || 1632.01,
      bookRate: 0.1708,
      realRate: overrides.realRate ?? 0.169,
      netRate: 0.1632,
      fees: {
        purchaseFee: 14.98,
        redemptionFee: 58.45,
        redemptionRate: 0.005,
        redemptionLabel: '7天(含)-365天',
      },
      redemption: {
        optimization: { worthWaiting: false, daysToWait: 0, savedAmount: 0, text: '已是最低赎回费率档' },
      },
      risk: {
        reachedTarget: Boolean(overrides.reachedTarget),
        reachedStop: Boolean(overrides.reachedStop),
        positionRatio: 0.5,
      },
    },
  };
}

test('组合汇总与单笔相加一致，比例按投入计算', () => {
    const positions = [
    position({ id: 1, code: '110022', buyAmount: 10000, currentValue: 11690.46 }),
    position({
      id: 2,
      code: '000001',
      name: '华夏成长',
      buyAmount: 5000,
      currentValue: 4800,
      netProceeds: 4788,
      bookProfit: -200,
      realProfit: -214.98,
      netProfit: -226.98,
      realRate: -0.043,
      todayProfit: -12.5,
    }),
  ];

  const summary = summarize(positions);
  assert.equal(summary.invest, 15000);
  assert.equal(summary.value, 16490.46);
  assert.equal(summary.realProfit, 1475.48);
  assert.equal(summary.netProfit, 1405.03);
  assert.equal(summary.purchaseFee, 29.96);
  assert.equal(summary.redemptionFeeIfSell, 116.9);
  assert.equal(summary.holdingCount, 2);
  assert.equal(summary.fundCount, 2);
  assert.equal(summary.todayProfit, -12.5);
  assert.equal(summary.realRate, Math.round((1475.48 / 15000) * 10000) / 10000);
});

test('空组合不会产生 NaN', () => {
  const summary = summarize([]);
  assert.equal(summary.holdingCount, 0);
  assert.equal(summary.realRate, 0);
  assert.equal(summary.netProfit, 0);
});

test('提醒落库去重：同一天同一原因只留一条', () => {
  const positions = [position({ id: 3, code: '161725', name: '招商中证白酒', reachedTarget: true })];
  buildAlerts(positions, '2026-11-13');
  buildAlerts(positions, '2026-11-13');

  const alerts = listAlerts(50);
  const targetAlerts = alerts.filter((alert) => alert.type === 'target_reached');
  assert.equal(targetAlerts.length, 1);
  assert.equal(targetAlerts[0].code, '161725');
  assert.equal(targetAlerts[0].isRead, false);
});

test('净值缺失与使用历史净值都会生成对应提醒', () => {
  db.run('DELETE FROM alerts');
  const positions = [
    position({ id: 4, code: '110022', priced: false, error: '上游 404', reachedTarget: false }),
    position({ id: 5, code: '000001', stale: true, staleDays: 3 }),
  ];
  buildAlerts(positions, '2026-11-14');

  const types = listAlerts(50).map((alert) => alert.type);
  assert.ok(types.includes('no_quote'));
  assert.ok(types.includes('stale'));
});
