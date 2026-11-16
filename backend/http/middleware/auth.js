const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fund-assistant-secret-key-2026';

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
}

module.exports = authMiddleware;
