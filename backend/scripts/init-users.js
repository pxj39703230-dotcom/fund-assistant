const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'fund.db');
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
