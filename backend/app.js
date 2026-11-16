'use strict';

const path = require('path');
const express = require('express');
const config = require('./config/env');
const db = require('./config/database');
const scheduler = require('./services/scheduler');
const { createLogger } = require('./utils/logger');
const { securityHeaders, requireToken } = require('./http/middleware');
const { HttpError } = require('./http/errors');

const log = createLogger('server');

const app = express();
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));

// 前端静态资源：html 不强缓存，css/js 短缓存，避免改了页面看不到效果
app.use(express.static(path.join(config.rootDir, 'frontend'), {
  index: 'index.html',
  etag: true,
  setHeaders(res, filePath) {
    // 本地单机服务：每次都让浏览器回源校验，改完代码刷新就生效
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// 健康检查接口（不需要 token，用于防止 Render 休眠）
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use('/api', requireToken);

app.use('/api/holdings', require('./http/routes/holdings'));
app.use('/api/portfolio', require('./http/routes/portfolio'));
app.use('/api/dashboard', require('./http/routes/dashboard'));
app.use('/api/profit-calendar', require('./http/routes/profitCalendar'));
app.use('/api/funds', require('./http/routes/funds'));
app.use('/api/assistant', require('./http/routes/assistant'));
app.use('/api/ai', require('./http/routes/ai'));
app.use('/api/analysis', require('./http/routes/analysis'));
app.use('/api/watchlist', require('./http/routes/watchlist'));
app.use('/api/constitution', require('./http/routes/constitution'));
app.use('/api/actions', require('./http/routes/actions'));
app.use('/api/reviews', require('./http/routes/reviews'));
app.use('/api/alerts', require('./http/routes/alerts'));
app.use('/api', require('./http/routes/system'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: `接口不存在: ${req.method} ${req.originalUrl}` } });
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('页面不存在');
});

// 统一错误出口：4xx 保留原始信息，5xx 不泄露内部细节
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof HttpError ? err.status : (err.status || 500);
  if (status >= 500) log.error(`${req.method} ${req.originalUrl} 失败:`, err.stack || err.message);
  else log.debug(`${req.method} ${req.originalUrl} 拒绝: ${err.message}`);
  res.status(status).json({
    error: {
      message: status >= 500 ? '服务器内部错误，请查看服务端日志' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
});

const server = app.listen(config.port, config.host, () => {
  log.info(`基金助手 v${require('../package.json').version} 已启动: http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') {
    log.info(`已监听所有网卡，同一局域网设备可用 http://<本机IP>:${config.port} 访问${config.apiToken ? '（已启用访问口令）' : '（未设 API_TOKEN，建议设置以防误操作）'}`);
  }
  scheduler.start();
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log.error(`端口 ${config.port} 已被占用，请修改 .env 里的 PORT`);
  } else {
    log.error('服务启动失败:', error.message);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`收到 ${signal}，正在关闭服务...`);
  scheduler.stop();
  server.close(() => {
    db.close();
    log.info('已安全退出');
    process.exit(0);
  });
  // 兜底：10 秒内没关干净就强制退出
  setTimeout(() => process.exit(0), 10000).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log.error('未处理的 Promise 拒绝:', reason));
process.on('uncaughtException', (error) => {
  log.error('未捕获异常:', error.stack || error.message);
});

module.exports = app;
