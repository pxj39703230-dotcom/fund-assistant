'use strict';

const https = require('https');
const config = require('../config/env');
const { createLogger } = require('../utils/logger');

const log = createLogger('notify');

/**
 * 通知通道：
 *  - 控制台始终输出
 *  - Server酱（微信）需要在 .env 里填 SERVERCHAN_KEY
 *  - 桌面通知可选，node-notifier 在部分 Windows 环境不可用，失败不影响主流程
 */
async function send({ title, message, level = 'info' }) {
  log.info(`[${level}] ${title} - ${message || ''}`);

  if (config.serverChanKey) {
    try {
      await pushServerChan(title, message);
    } catch (error) {
      log.warn(`Server酱推送失败: ${error.message}`);
    }
  }

  if (config.notifyDesktop) {
    try {
      // 延迟加载，避免在无桌面环境时报错
      const notifier = require('node-notifier');
      notifier.notify({ title, message, wait: false });
    } catch (error) {
      log.debug(`桌面通知不可用: ${error.message}`);
    }
  }
}

function pushServerChan(title, message) {
  const key = config.serverChanKey;
  const url = key.startsWith('sctp')
    ? `https://${key}.push.ft07.com/send`
    : `https://sctapi.ftqq.com/${key}.send`;
  const body = new URLSearchParams({ title, desp: message || '' }).toString();

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 6000,
      },
      (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${response.statusCode}`));
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('请求超时')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

module.exports = { send };
