const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/fund.db');

const JWT_SECRET = process.env.JWT_SECRET || 'fund-assistant-secret-key-2026';

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }
  
  const db = new Database(dbPath);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  db.close();
  
  if (!user) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  
  // 生成 token，有效期 7 天
  const token = jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  res.json({ token, username: user.username });
});

module.exports = router;
