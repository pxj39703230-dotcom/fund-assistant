const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../fund.db');

class DatabaseWrapper {
  constructor() {
    try {
      this.db = new Database(dbPath);
      console.log('✅ 数据库已连接:', dbPath);
      this.init();
    } catch (err) {
      console.error('❌ 数据库连接失败:', err.message);
      throw err;
    }
  }

  init() {
    console.log('🔧 初始化数据库表...');

    try {
      // 基金基本信息表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS funds (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT,
          category TEXT,
          company TEXT,
          manager_name TEXT,
          manager_years REAL,
          management_rate REAL DEFAULT 0.015,
          custody_rate REAL DEFAULT 0.0025,
          purchase_rate REAL DEFAULT 0.015,
          redemption_rates TEXT,
          turnover_rate REAL,
          scale REAL,
          last_net_value REAL,
          last_update DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 持仓表（已移除外键约束）
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS holdings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fund_code TEXT NOT NULL,
          buy_date DATE NOT NULL,
          buy_amount REAL NOT NULL,
          buy_net_value REAL NOT NULL,
          shares REAL NOT NULL,
          channel TEXT DEFAULT 'default',
          target_profit REAL DEFAULT 0.3,
          stop_loss REAL DEFAULT 0.2,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 历史净值表
      const year = new Date().getFullYear();
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fund_net_values_${year} (
          fund_code TEXT NOT NULL,
          date DATE NOT NULL,
          net_value REAL NOT NULL,
          accumulated_value REAL,
          growth_rate REAL,
          data_source TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (fund_code, date)
        )
      `);

      // 交易日历表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trading_holidays (
          date DATE PRIMARY KEY,
          name TEXT
        )
      `);

      // 定投计划表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS invest_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          salary_day INTEGER NOT NULL,
          invest_ratio REAL NOT NULL,
          min_amount REAL,
          max_amount REAL,
          strategy TEXT,
          auto_execute BOOLEAN DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 复盘记录表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date DATE NOT NULL,
          type TEXT NOT NULL,
          content TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('✅ 所有数据库表初始化完成');
    } catch (err) {
      console.error('❌ 初始化数据库表失败:', err.message);
      throw err;
    }
  }

  // 封装查询方法
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(sql);
        const info = stmt.run(...params);
        resolve({ id: info.lastInsertRowid, changes: info.changes });
      } catch (err) {
        reject(err);
      }
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(sql);
        const row = stmt.get(...params);
        resolve(row);
      } catch (err) {
        reject(err);
      }
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params);
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      try {
        this.db.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = new DatabaseWrapper();