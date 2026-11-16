'use strict';

const db = require('../config/database');
const env = require('../config/env');
const { badRequest } = require('../http/errors');

const KEYS = {
  baseUrl: 'ai_base_url',
  apiKey: 'ai_api_key',
  model: 'ai_model',
  provider: 'ai_provider',
};

function fromDb(key, fallback) {
  const value = db.getSetting(key);
  // null = 从未设置，沿用 .env；'' = 用户明确清空
  return value === null || value === undefined ? fallback : value;
}

function normalizeBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function endpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  if (!base) return '';
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `****${value.slice(-4)}`;
}

function read() {
  const baseUrl = normalizeBase(fromDb(KEYS.baseUrl, env.aiBaseUrl));
  const apiKey = String(fromDb(KEYS.apiKey, env.aiApiKey) || '').trim();
  const model = String(fromDb(KEYS.model, env.aiModel) || '').trim();
  const provider = String(fromDb(KEYS.provider, '') || '').trim();
  const baseSource = db.getSetting(KEYS.baseUrl) === null ? 'env' : 'db';
  const keySource = db.getSetting(KEYS.apiKey) === null ? 'env' : 'db';
  return { baseUrl, apiKey, model, provider, baseSource, keySource, timeoutMs: env.aiTimeoutMs };
}

function isReady(conf = read()) {
  return Boolean(conf.baseUrl && conf.apiKey && conf.model);
}

function publicView() {
  const conf = read();
  return {
    baseUrl: conf.baseUrl,
    model: conf.model,
    provider: conf.provider,
    hasKey: Boolean(conf.apiKey),
    keyMasked: maskKey(conf.apiKey),
    ready: isReady(conf),
    baseSource: conf.baseSource,
    keySource: conf.keySource,
    timeoutMs: conf.timeoutMs,
  };
}

function save(input = {}) {
  const hasBase = Object.prototype.hasOwnProperty.call(input, 'baseUrl');
  const hasModel = Object.prototype.hasOwnProperty.call(input, 'model');
  const hasKey = Object.prototype.hasOwnProperty.call(input, 'apiKey');
  const clearKey = Boolean(input.clearKey);

  if (hasBase) {
    const baseUrl = normalizeBase(input.baseUrl);
    if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
      throw badRequest('接口地址要以 http:// 或 https:// 开头');
    }
    db.setSetting(KEYS.baseUrl, baseUrl);
  }

  if (hasModel) {
    const model = String(input.model || '').trim();
    if (!model) throw badRequest('模型名不能为空');
    if (model.length > 80) throw badRequest('模型名太长');
    db.setSetting(KEYS.model, model);
  }

  if (input.provider !== undefined) {
    db.setSetting(KEYS.provider, String(input.provider || '').trim().slice(0, 40));
  }

  if (clearKey) {
    db.setSetting(KEYS.apiKey, '');
  } else if (hasKey) {
    const apiKey = String(input.apiKey || '').trim();
    if (apiKey.length > 200) throw badRequest('API Key 太长');
    if (apiKey) db.setSetting(KEYS.apiKey, apiKey);
    // 空字符串表示“不修改”，避免用户只改模型时误清 Key
  }

  return publicView();
}

module.exports = { read, publicView, save, isReady, endpoint, maskKey, KEYS };
