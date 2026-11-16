'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const db = require('../config/database');
const { createLogger } = require('../utils/logger');

const log = createLogger('backup');

function backupDatabase() {
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(`数据库文件不存在: ${config.dbPath}`);
  }
  fs.mkdirSync(config.backupDir, { recursive: true });

  try {
    db.db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    log.warn(`WAL checkpoint 失败: ${error.message}`);
  }

  const stamp = localStamp();
  const target = path.join(config.backupDir, `fund-${stamp}.db`);
  fs.copyFileSync(config.dbPath, target);
  pruneOldBackups();
  const size = fs.statSync(target).size;
  log.info(`数据库已备份: ${target} (${(size / 1024).toFixed(1)} KB)`);
  return { path: target, size };
}

/** 备份文件名按配置时区生成，用 ISO 的 UTC 时间会让日期比本地差一天 */
function localStamp() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}`;
}

function pruneOldBackups() {
  const keep = Math.max(config.backupKeep, 1);
  const files = fs
    .readdirSync(config.backupDir)
    .filter((name) => /^fund-\d{4}-\d{2}-\d{2}.*\.db$/.test(name))
    .map((name) => ({ name, time: fs.statSync(path.join(config.backupDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  files.slice(keep).forEach((file) => {
    try {
      fs.unlinkSync(path.join(config.backupDir, file.name));
      log.debug(`清理旧备份: ${file.name}`);
    } catch (error) {
      log.warn(`删除旧备份失败 ${file.name}: ${error.message}`);
    }
  });
}

module.exports = { backupDatabase, pruneOldBackups };
