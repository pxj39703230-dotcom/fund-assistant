'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const db = require('../config/database');
const config = require('../config/env');
const portfolioService = require('./portfolioService');
const reviewService = require('./reviewService');
const backupService = require('./backupService');
const notificationService = require('./notificationService');
const { todayString, addDays, isWeekend, dateTimeLabel } = require('../utils/date');
const { createLogger } = require('../utils/logger');
const jobService = require('./jobService');

const log = createLogger('scheduler');

class FundScheduler {
  constructor() {
    this.tasks = [];
    this.locks = new Set();
    this.started = false;
  }

  start() {
    if (this.started) return;
    this._seedHolidays();

    const tz = { timezone: config.timezone };

    this._add('18:00 收盘后拉取', '0 18 * * 1-5', () => this.runSync('evening'));
    this._add('20:00 净值复核', '0 20 * * 1-5', () => this.runSync('night-early'));
    this._add('22:00 净值兜底', '0 22 * * 1-5', () => this.runSync('night-late'));
    this._add('01:00 凌晨补抓', '0 1 * * *', () => this.runRetryMissing());
    this._add('22:30 每日复盘', '30 22 * * 1-5', () => this.runDailyReview());
    this._add('23:00 每日快照', '0 23 * * *', () => this.runDailySnapshot());
    this._add('周日 20:00 周度复盘', '0 20 * * 0', () => this.runWeeklyReview());
    this._add('月末 20:30 月度复盘', '30 20 28-31 * *', () => this.runMonthlyReviewIfLastDay());
    this._add('23:10 数据库备份', '10 23 * * *', () => this.runBackup());

    this.started = true;
    log.info(`定时任务已启动（时区 ${config.timezone}）：18:00 / 20:00 / 22:00 拉净值，01:00 补抓，22:30 复盘，23:00 快照，周日周复盘，月末月复盘，23:10 备份`);

    this._startupCatchUp();
  }

  stop() {
    this.tasks.forEach((task) => task.stop());
    this.tasks = [];
    this.started = false;
  }

  _add(label, expression, handler, options = {}) {
    if (!cron.validate(expression)) {
      log.error(`cron 表达式无效: ${expression}`);
      return;
    }
    const task = cron.schedule(expression, () => {
      Promise.resolve(handler()).catch((error) => log.error(`${label} 执行失败: ${error.message}`));
    }, { timezone: config.timezone, ...options });
    this.tasks.push({ label, task });
  }

  /** 节假日表：来自 config/market-holidays.json，可手工追加 */
  _seedHolidays() {
    const file = path.join(__dirname, '../config/market-holidays.json');
    if (!fs.existsSync(file)) return;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      let inserted = 0;
      for (const [year, ranges] of Object.entries(json.years || {})) {
        if (!Array.isArray(ranges)) continue;
        for (const range of ranges) {
          let cursor = range.from;
          while (cursor && cursor <= range.to) {
            const exists = db.get('SELECT date FROM trading_holidays WHERE date = ?', [cursor]);
            if (!exists) {
              db.run('INSERT OR IGNORE INTO trading_holidays (date, name) VALUES (?, ?)', [cursor, `${range.name} ${year}`]);
              inserted += 1;
            }
            cursor = addDays(cursor, 1);
          }
        }
      }
      if (inserted) log.info(`交易日历已更新：新增 ${inserted} 个休市日`);
    } catch (error) {
      log.warn(`交易日历读取失败: ${error.message}`);
    }
  }

  isTradingDay(date = todayString()) {
    if (isWeekend(date)) return false;
    return !db.get('SELECT date FROM trading_holidays WHERE date = ?', [date]);
  }

  async _exclusive(name, fn) {
    if (this.locks.has(name)) {
      log.info(`${name} 正在执行中，本次跳过`);
      return { status: 'skipped', reason: 'running' };
    }
    this.locks.add(name);
    try {
      return await fn();
    } finally {
      this.locks.delete(name);
    }
  }

  async runSync(reason) {
    if (!this.isTradingDay()) {
      log.info(`${todayString()} 非交易日，跳过净值同步`);
      return { status: 'skipped', reason: 'holiday' };
    }
    return this._exclusive('sync', async () => {
      const result = await portfolioService.syncAll(reason);
      await this._notifyCritical();
      return result;
    });
  }

  async _notifyCritical() {
    const alerts = portfolioService.listAlerts(10, { unreadOnly: true });
    const critical = alerts.filter((a) => a.level === 'critical');
    if (!critical.length) return;
    await notificationService.send({
      title: `基金提醒：${critical[0].title}`,
      message: critical.map((a) => `- ${a.title}\n  ${a.message || ''}`).join('\n'),
      level: 'critical',
    });
    // 已推送过的关键提醒标记已读，避免下次重复推送
    portfolioService.markAlertsRead(critical.map((a) => a.id));
  }

  async runDailyReview() {
    if (!this.isTradingDay()) {
      log.info('非交易日，跳过每日复盘');
      return { status: 'skipped' };
    }
    return this._exclusive('review', () => reviewService.generateDaily());
  }

  async runWeeklyReview() {
    return this._exclusive('review', () => reviewService.generate('weekly'));
  }

  async runMonthlyReviewIfLastDay() {
    const tomorrow = addDays(todayString(), 1);
    if (tomorrow.slice(8, 10) !== '01') return { status: 'skipped' };
    return this._exclusive('review', () => reviewService.generate('monthly'));
  }

  async runBackup() {
    if (!config.backupEnabled) return { status: 'skipped' };
    try {
      const result = backupService.backupDatabase();
      const job = jobService.start('backup');
      jobService.finish(job, 'success', result);
      return result;
    } catch (error) {
      log.error(`自动备份失败: ${error.message}`);
      const job = jobService.start('backup');
      jobService.finish(job, 'failed', null, error.message);
      return { status: 'failed', message: error.message };
    }
  }

  /**
   * 凌晨补抓：针对昨天三次定时任务都失败的净值，重试一次
   */
  async runRetryMissing() {
    const yesterday = addDays(todayString(), -1);
    if (!this.isTradingDay(yesterday)) {
      log.info(`${yesterday} 非交易日，跳过补抓`);
      return { status: 'skipped', reason: 'holiday' };
    }

    return this._exclusive('retry', async () => {
      const fundDataService = require('./fundDataService');
      const holdings = db.all('SELECT DISTINCT fund_code FROM holdings');
      const codes = holdings.map((h) => h.fund_code);
      
      if (codes.length === 0) {
        return { status: 'skipped', reason: 'no holdings' };
      }

      let retried = 0;
      let succeeded = 0;
      let failed = 0;

      for (const code of codes) {
        // 检查昨天的净值是否存在
        const existing = db.get(
          'SELECT * FROM fund_net_values WHERE fund_code = ? AND date = ?',
          [code, yesterday]
        );

        if (!existing) {
          retried += 1;
          try {
            const history = await fundDataService.getHistory(code, 5);
            const target = history.find((row) => row.date === yesterday);
            if (target) {
              db.run(
                `INSERT OR REPLACE INTO fund_net_values 
                (fund_code, date, net_value, accumulated_value, growth_rate, data_source, retry_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))`,
                [code, yesterday, target.netValue, target.accumulatedValue, target.growthRate, target.source]
              );
              succeeded += 1;
              log.info(`补抓成功: ${code} ${yesterday} ${target.netValue}`);
            } else {
              failed += 1;
              // 超过3次重试标记为失败
              db.run(
                `INSERT OR REPLACE INTO fund_net_values 
                (fund_code, date, net_value, accumulated_value, growth_rate, data_source, retry_count, created_at)
                VALUES (?, ?, 0, 0, 0, 'failed', 3, datetime('now', 'localtime'))`,
                [code, yesterday]
              );
              log.warn(`补抓失败（数据源无数据）: ${code} ${yesterday}`);
            }
          } catch (error) {
            failed += 1;
            log.error(`补抓异常: ${code} ${yesterday} - ${error.message}`);
          }
        } else if (existing.retry_count < 3 && existing.data_source === 'failed') {
          // 之前标记为失败的，重试一次
          retried += 1;
          try {
            const history = await fundDataService.getHistory(code, 5);
            const target = history.find((row) => row.date === yesterday);
            if (target) {
              db.run(
                `UPDATE fund_net_values SET 
                net_value = ?, accumulated_value = ?, growth_rate = ?, 
                data_source = ?, retry_count = retry_count + 1
                WHERE fund_code = ? AND date = ?`,
                [target.netValue, target.accumulatedValue, target.growthRate, target.source, code, yesterday]
              );
              succeeded += 1;
              log.info(`补抓修复: ${code} ${yesterday} ${target.netValue}`);
            } else {
              failed += 1;
              db.run(
                'UPDATE fund_net_values SET retry_count = retry_count + 1 WHERE fund_code = ? AND date = ?',
                [code, yesterday]
              );
            }
          } catch (error) {
            failed += 1;
            log.error(`补抓重试异常: ${code} ${yesterday} - ${error.message}`);
          }
        }
      }

      const result = { retried, succeeded, failed, date: yesterday };
      const job = jobService.start('retry-missing');
      jobService.finish(job, succeeded > 0 || retried === 0 ? 'success' : 'partial', result);
      
      if (retried > 0) {
        log.info(`补抓完成: ${yesterday}, 重试 ${retried} 只, 成功 ${succeeded}, 失败 ${failed}`);
      }
      
      return result;
    });
  }

  /**
   * 启动补跑：如果服务在收盘后启动、当天的净值还没入库，自动补一次。
   * 避免"晚上才开机就一整天没数据"。
   */
  _startupCatchUp() {
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hour12: false }).format(now));
    if (!this.isTradingDay() || hour < 18) return;

    const holdings = db.get('SELECT COUNT(*) AS n FROM holdings').n;
    if (!holdings) return;

    const yesterday = addDays(todayString(), -1);
    const latest = db.get('SELECT MAX(last_net_date) AS d FROM funds WHERE last_net_date >= ?', [yesterday]).d;
    if (latest && latest >= todayString()) return;

    log.info('检测到今日净值尚未入库，60 秒后自动补跑一次同步');
    setTimeout(() => {
      this.runSync('startup-catchup').catch((error) => log.error(`补跑失败: ${error.message}`));
    }, 60 * 1000).unref?.();
  }

  /**
   * 每日快照：保存当天的资产和收益情况
   */
  async runDailySnapshot() {
    const today = todayString();
    
    return this._exclusive('snapshot', async () => {
      const portfolioService = require('./portfolioService');
      const profitCalendarService = require('./profitCalendarService');

      try {
        const portfolioData = await portfolioService.buildPortfolio({ today });
        profitCalendarService.saveDailySnapshot(today, portfolioData);
        
        return { status: 'success', date: today };
      } catch (error) {
        log.error(`每日快照失败: ${error.message}`);
        return { status: 'failed', date: today, error: error.message };
      }
    });
  }
}

module.exports = new FundScheduler();
