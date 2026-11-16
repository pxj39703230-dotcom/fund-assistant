const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '../../fund.db');

// 确保数据库文件存在的情况下才执行
try {
  const db = new Database(dbPath);

  // 创建 users 表（如果不存在）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 为 funds 表添加 user_id 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE funds ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
    console.log('✅ funds 表已添加 user_id 字段');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('ℹ️  user_id 字段已存在，跳过');
    } else {
      throw err;
    }
  }

  // 为 holdings 表添加 user_id 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE holdings ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
    console.log('✅ holdings 表已添加 user_id 字段');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('ℹ️  holdings 的 user_id 字段已存在，跳过');
    } else {
      throw err;
    }
  }

  // 插入两个账号（密码用 bcrypt 加密）
  const users = [
    { username: 'pxj', password: 'pxj123' },
    { username: 'sgw', password: 'sgw123' }
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)');

  users.forEach(u => {
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    const result = stmt.run(u.username, hashedPassword);
    if (result.changes > 0) {
      console.log(`✅ 账号 ${u.username} 已初始化`);
    } else {
      console.log(`ℹ️  账号 ${u.username} 已存在，跳过`);
    }
  });

  db.close();
  console.log('✅ 用户初始化完成');
} catch (err) {
  console.error('❌ 初始化失败:', err.message);
  // 不中断启动流程，让服务继续运行
  process.exit(0);
}

