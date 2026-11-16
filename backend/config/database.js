'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./env');
const { createLogger } = require('../utils/logger');

const log = createLogger('db');

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS funds (
    code TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    category TEXT,
    company TEXT,
    manager_name TEXT,
    management_rate REAL,
    custody_rate REAL,
    sales_service_rate REAL,
    purchase_rate REAL,
    purchase_tiers TEXT,
    redemption_tiers TEXT,
    scale REAL,
    established_date TEXT,
    last_net_value REAL,
    last_net_date TEXT,
    detail_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_code TEXT NOT NULL,
    buy_date TEXT NOT NULL,
    buy_amount REAL NOT NULL,
    buy_net_value REAL NOT NULL,
    shares REAL,
    channel TEXT DEFAULT 'default',
    target_profit REAL DEFAULT 0.3,
    stop_loss REAL DEFAULT 0.2,
    note TEXT,
    confirmed INTEGER DEFAULT 0,
    actual_shares REAL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS fund_net_values (
    fund_code TEXT NOT NULL,
    date TEXT NOT NULL,
    net_value REAL NOT NULL,
    accumulated_value REAL,
    growth_rate REAL,
    data_source TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (fund_code, date)
  );

  CREATE TABLE IF NOT EXISTS trading_holidays (
    date TEXT PRIMARY KEY,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT,
    data TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT,
    target_nav REAL,
    reason TEXT,
    score INTEGER,
    grade TEXT,
    status TEXT NOT NULL DEFAULT 'cooling',
    cool_until TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key TEXT NOT NULL UNIQUE,
    fund_code TEXT,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT,
    payload TEXT,
    trade_date TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    stats TEXT,
    message TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS actions (
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

  CREATE TABLE IF NOT EXISTS daily_snapshots (
    date TEXT PRIMARY KEY,
    total_value REAL NOT NULL,
    total_profit REAL NOT NULL,
    day_profit REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`;

const INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_holdings_code ON holdings(fund_code);
  CREATE INDEX IF NOT EXISTS idx_holdings_buy_date ON holdings(buy_date);
  CREATE INDEX IF NOT EXISTS idx_nav_date ON fund_net_values(date);
  CREATE INDEX IF NOT EXISTS idx_alerts_date ON alerts(trade_date, created_at);
  CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date, type);
  CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status, cool_until);
  CREATE INDEX IF NOT EXISTS idx_jobs_name ON job_runs(name, started_at);
  CREATE INDEX IF NOT EXISTS idx_actions_holding ON actions(holding_id, date);
  CREATE INDEX IF NOT EXISTS idx_actions_date ON actions(date, executed);
`;

const EXTRA_COLUMNS = {
  funds: {
    sales_service_rate: 'REAL',
    purchase_tiers: 'TEXT',
    redemption_tiers: 'TEXT',
    scale: 'REAL',
    established_date: 'TEXT',
    last_net_date: 'TEXT',
    detail_updated_at: 'TEXT',
    updated_at: 'TEXT',
  },
  holdings: {
    note: 'TEXT',
    strategy: "TEXT DEFAULT 'auto'",
    confirmed: 'INTEGER DEFAULT 0',
    actual_shares: 'REAL',
    updated_at: 'TEXT',
  },
  reviews: {
    data: 'TEXT',
  },
  fund_net_values: {
    retry_count: 'INTEGER DEFAULT 0',
  },
};

class DatabaseWrapper {
  constructor() {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this._statements = new Map();

    this.init();
  }

  init() {
    this.db.exec(BASE_SCHEMA);
    this._migrateLegacyNavTables();
    for (const [table, columns] of Object.entries(EXTRA_COLUMNS)) {
      this._ensureColumns(table, columns);
    }
    this.db.exec(INDEXES);
    this._migrateDetailCache();
    log.info(`数据库就绪: ${config.dbPath}`);
  }

  /**
   * 旧版本的费率解析是错的（管理费/托管费被当成 1.5%/0.25%，申购费永远 1.5%），
   * 但它的 detail_updated_at 写的是当天，新代码会误判为"新鲜"直接沿用。
   * 升级时重置一次详情缓存，让费率按新解析器重新抓。
   */
  _migrateDetailCache() {
    const version = '2';
    if (this.getSetting('detail_cache_version') === version) return;
    const changes = this.db
      .prepare('UPDATE funds SET detail_updated_at = NULL WHERE detail_updated_at IS NOT NULL')
      .run().changes;
    this.setSetting('detail_cache_version', version);
    if (changes > 0) log.info(`已重置 ${changes} 只基金的详情缓存，将按新规则重新抓取费率`);
  }

  /** 旧版本按年份分表（fund_net_values_2026），统一合并到单表，避免跨年丢数据 */
  _migrateLegacyNavTables() {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fund_net_values_%'")
      .all()
      .map((row) => row.name)
      .filter((name) => /^fund_net_values_\d{4}$/.test(name));

    for (const table of tables) {
      try {
        const sourceCount = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
        const insert = this.db.prepare(`
          INSERT OR IGNORE INTO fund_net_values (fund_code, date, net_value, accumulated_value, growth_rate, data_source, created_at)
          SELECT fund_code, date, net_value, accumulated_value, growth_rate, data_source, created_at FROM ${table}
        `);
        const merged = this.db.transaction(() => insert.run().changes)();
        if (merged >= sourceCount) {
          this.db.exec(`DROP TABLE ${table}`);
          log.info(`已合并历史净值表 ${table}（${merged} 行）`);
        } else {
          log.warn(`历史净值表 ${table} 合并不完整（${merged}/${sourceCount}），已保留原表`);
        }
      } catch (error) {
        log.warn(`合并历史净值表 ${table} 失败: ${error.message}`);
      }
    }
  }

  _ensureColumns(table, columns) {
    const existing = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (existing.has(name)) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      log.debug(`迁移：${table}.${name} 已添加`);
    }
  }

  /** 缓存 prepared statement，better-sqlite3 里它是主要性能来源 */
  prepare(sql) {
    let stmt = this._statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this._statements.set(sql, stmt);
    }
    return stmt;
  }

  run(sql, params = []) {
    const info = this.prepare(sql).run(...params);
    return { id: info.lastInsertRowid, changes: info.changes };
  }

  get(sql, params = []) {
    return this.prepare(sql).get(...params);
  }

  all(sql, params = []) {
    return this.prepare(sql).all(...params);
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }

  getSetting(key, fallback = null) {
    const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : fallback;
  }

  setSetting(key, value) {
    this.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, String(value)],
    );
  }

  close() {
    try {
      this._statements.clear();
      this.db.close();
    } catch (error) {
      log.warn(`关闭数据库失败: ${error.message}`);
    }
  }
}

module.exports = new DatabaseWrapper();
