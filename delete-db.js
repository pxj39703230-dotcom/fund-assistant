const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'fund.db');

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('✅ 数据库已删除');
} else {
  console.log('ℹ️  数据库不存在');
}
