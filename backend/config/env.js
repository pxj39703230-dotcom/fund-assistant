'use strict';

const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..', '..');

// .env 固定按项目根目录读取，避免从不同工作目录启动时读到不同的配置
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

function resolveFromRoot(value, fallback) {
  const target = value && value.trim() ? value.trim() : fallback;
  if (!target) return target;
  return path.isAbsolute(target) ? target : path.resolve(ROOT_DIR, target);
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toInt(value, defaultValue) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

const config = {
  rootDir: ROOT_DIR,
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: resolveFromRoot(process.env.DB_PATH, 'fund.db'),
  timezone: process.env.TZ_NAME || 'Asia/Shanghai',
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  // 局域网访问时的可选口令：留空则不校验
  apiToken: (process.env.API_TOKEN || '').trim(),
  serverChanKey: (process.env.SERVERCHAN_KEY || '').trim(),
  notifyDesktop: toBool(process.env.NOTIFY_DESKTOP, false),
  // 抓取
  fetchTimeoutMs: toInt(process.env.FETCH_TIMEOUT_MS, 8000),
  fetchRetries: toInt(process.env.FETCH_RETRIES, 2),
  quoteCacheMs: toInt(process.env.QUOTE_CACHE_MS, 10 * 60 * 1000),
  detailCacheDays: toInt(process.env.DETAIL_CACHE_DAYS, 7),
  fetchConcurrency: toInt(process.env.FETCH_CONCURRENCY, 3),
  // 可选大模型（OpenAI 兼容接口）：不填则只用本地规则回答
  aiBaseUrl: (process.env.AI_BASE_URL || '').trim(),
  aiApiKey: (process.env.AI_API_KEY || '').trim(),
  aiModel: (process.env.AI_MODEL || 'doubao-seed-1-6-250615').trim(),
  aiTimeoutMs: toInt(process.env.AI_TIMEOUT_MS, 25000),
  // 自动备份
  backupEnabled: toBool(process.env.BACKUP_ENABLED, true),
  backupDir: resolveFromRoot(process.env.BACKUP_DIR, 'backups'),
  backupKeep: toInt(process.env.BACKUP_KEEP, 14),
};

config.hasEnvFile = fs.existsSync(path.join(ROOT_DIR, '.env'));

module.exports = config;
