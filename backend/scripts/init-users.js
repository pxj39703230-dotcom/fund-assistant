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

  const stmt = db.prepare('INSERT OR REPLACE INTO users (username, password) VALUES (?, ?)');

  users.forEach(u => {
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    stmt.run(u.username, hashedPassword);
    console.log(`User ${u.username} ready`);
  });

  db.close();
  console.log('Init complete');
} catch (err) {
  console.error('Init failed:', err.message);
}
