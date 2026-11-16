'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test-actions.db');

describe('操作记录服务', () => {
  let db;
  let actionsService;

  before(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    
    db.exec(`
      CREATE TABLE holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fund_code TEXT NOT NULL,
        buy_date TEXT NOT NULL,
        buy_amount REAL NOT NULL
      );

      CREATE TABLE actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        holding_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        verdict TEXT NOT NULL,
        action TEXT NOT NULL,
        executed INTEGER DEFAULT 0,
        note TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT
      );

      INSERT INTO holdings (id, fund_code, buy_date, buy_amount)
      VALUES (1, '110022', '2026-11-01', 10000);
    `);

    // Mock db module
    const dbMock = {
      get: (sql, params) => db.prepare(sql).get(...(params || [])),
      all: (sql, params) => db.prepare(sql).all(...(params || [])),
      run: (sql, params) => {
        const info = db.prepare(sql).run(...(params || []));
        return { id: info.lastInsertRowid, changes: info.changes };
      },
    };

    // Mock dependencies
    require.cache[require.resolve('../backend/config/database')] = {
      exports: dbMock,
    };

    require.cache[require.resolve('../backend/utils/date')] = {
      exports: {
        todayString: () => '2026-11-16',
      },
    };

    require.cache[require.resolve('../backend/utils/logger')] = {
      exports: {
        createLogger: () => ({
          info: () => {},
          debug: () => {},
          warn: () => {},
          error: () => {},
        }),
      },
    };

    actionsService = require('../backend/services/actionsService');
  });

  after(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('记录待办操作', () => {
    const actionId = actionsService.recordAction(1, 'stop-loss', '今天卖一半，明天卖剩下');
    assert.ok(actionId > 0);

    const actions = actionsService.getTodayActions(1);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].verdict, 'stop-loss');
    assert.equal(actions[0].executed, 0);
  });

  it('重复记录不会创建多条', () => {
    actionsService.recordAction(1, 'stop-loss', '今天卖一半，明天卖剩下');
    const actions = actionsService.getTodayActions(1);
    assert.equal(actions.length, 1);
  });

  it('标记操作已执行', () => {
    const actions = actionsService.getTodayActions(1);
    const actionId = actions[0].id;
    
    actionsService.markExecuted(actionId, '已在支付宝卖出');
    
    const pending = actionsService.getTodayActions(1);
    assert.equal(pending.length, 0);

    const executed = actionsService.getExecutedActions(1, 5);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].executed, 1);
    assert.equal(executed[0].note, '已在支付宝卖出');
  });

  it('检查是否有待办操作', () => {
    const has1 = actionsService.hasPendingAction(1, 'stop-loss');
    assert.equal(has1, false); // 已执行

    actionsService.recordAction(1, 'reduce', '减仓一半');
    const has2 = actionsService.hasPendingAction(1, 'reduce');
    assert.equal(has2, true);
  });

  it('获取所有待办操作', () => {
    const all = actionsService.getAllTodayPendingActions();
    assert.ok(all.length >= 1);
    assert.equal(all[0].fund_code, '110022');
  });
});
