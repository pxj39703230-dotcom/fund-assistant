const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '../../fund.db');

try {
  const db = new Database(dbPath);

  // 只更新密码，不删除任何数据
  const users = [
    { username: 'pxj', password: 'pxj123' },
    { username: 'sgw', password: 'sgw123' }
  ];

  users.forEach(u => {
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    const result = db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hashedPassword, u.username);
    if (result.changes > 0) {
      console.log(`✅ 账号 ${u.username} 密码已重置`);
    } else {
      console.log(`⚠️  账号 ${u.username} 不存在`);
    }
  });

  db.close();
  console.log('✅ 密码重置完成');
} catch (err) {
  console.error('⚠️  密码重置失败:', err.message);
}
