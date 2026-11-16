'use strict';

/**
 * 手动备份数据库：
 *   npm run backup
 * 后端服务运行时也可以备份（会先做 WAL checkpoint）。
 */

const path = require('node:path');

process.chdir(path.join(__dirname, '..'));

const config = require('../backend/config/env');
const { backupDatabase } = require('../backend/services/backupService');
const db = require('../backend/config/database');

// 这里不调用 createLogger 的格式化输出，直接把结果打到控制台，方便脚本使用
const result = backupDatabase();
console.log(`已备份: ${result.path}`);
console.log(`大小: ${(result.size / 1024).toFixed(1)} KB`);
console.log(`数据库: ${config.dbPath}`);

db.close();
