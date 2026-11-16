const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'fund.db');
const dbDir = path.dirname(dbPath);

// 确保目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('✅ 已创建数据库目录:', dbDir);
}

const db = new Database(dbPath);

// 创建 users 表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 创建 holdings 表
db.exec('DROP TABLE IF EXISTS holdings');
db.exec(`
  CREATE TABLE holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_code TEXT NOT NULL,
    fund_name TEXT,
    shares REAL NOT NULL,
    cost_price REAL NOT NULL,
    purchase_date TEXT,
    user_id INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('✅ 数据表初始化完成');



// 初始化两个账号
async function initUsers() {
  const users = [
    { username: 'pxj', password: 'pxj123' },
    { username: 'sgw', password: 'sgw123' }
  ];

  const stmt = db.prepare('INSERT OR REPLACE INTO users (username, password) VALUES (?, ?)');

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    stmt.run(user.username, hashedPassword);
    console.log(`✅ 已成功初始化账号: ${user.username}`);
  }
}

initUsers().catch(err => {
  console.error('❌ 初始化用户失败:', err);
});
