const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '../../fund.db');

try {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.exec(`ALTER TABLE funds ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
    console.log('funds user_id added');
  } catch (err) {
    if (!err.message.includes('duplicate column name')) throw err;
  }

  try {
    db.exec(`ALTER TABLE holdings ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
    console.log('holdings user_id added');
  } catch (err) {
    if (!err.message.includes('duplicate column name')) throw err;
  }

  const users = [
    { username: 'pxj', password: 'pxj123' },
    { username: 'sgw', password: 'sgw123' }
  ];

  // 先删除旧用户，确保密码更新
  const deleteStmt = db.prepare('DELETE FROM users WHERE username = ?');
  users.forEach(u => {
    deleteStmt.run(u.username);
  });

  // 插入新用户
  const insertStmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  users.forEach(u => {
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    insertStmt.run(u.username, hashedPassword);
    console.log(`✅ 账号 ${u.username} 已初始化（密码：${u.password}）`);
  });

  db.close();
  console.log('Init complete');
} catch (err) {
  console.error('Init failed:', err.message);
}
