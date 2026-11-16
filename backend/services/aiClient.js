'use strict';

const axios = require('axios');
const aiConfigService = require('./aiConfigService');
const { HttpError } = require('../http/errors');

function friendlyError(error) {
  if (error instanceof HttpError) return error;
  const status = error.response?.status;
  const data = error.response?.data;
  const detail = typeof data === 'string' ? data.slice(0, 160) : data?.error?.message || data?.message || '';
  if (status === 401 || status === 403) {
    return new HttpError(400, `AI Key 无效或没有权限（HTTP ${status}）${detail ? `：${detail}` : ''}`);
  }
  if (status === 404) {
    return new HttpError(400, 'AI 接口地址不对（HTTP 404），兼容地址通常以 /v1 或 /api/v3 结尾');
  }
  if (status === 429) {
    return new HttpError(400, 'AI 平台限流或额度用完了（HTTP 429），稍后再试或换一个模型');
  }
  if (status) {
    return new HttpError(400, `AI 调用失败（HTTP ${status}）${detail ? `：${detail}` : ''}`);
  }
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
    return new HttpError(400, 'AI 接口超时，检查网络或换一个地址');
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return new HttpError(400, `连不上 AI 接口（${error.code}），检查地址和网络`);
  }
  return new HttpError(400, `AI 调用失败：${error.message}`);
}

async function chat({ messages, temperature = 0.3, maxTokens = 700, timeoutMs, maxChars = 4000 }) {
  const conf = aiConfigService.read();
  if (!conf.baseUrl || !conf.apiKey || !conf.model) {
    throw new HttpError(400, '还没有配置 AI：请在「AI 设置」里填接口地址、模型和 Key');
  }

  const started = Date.now();
  try {
    const response = await axios.post(
      aiConfigService.endpoint(conf.baseUrl),
      {
        model: conf.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      },
      {
        timeout: timeoutMs || conf.timeoutMs || 25000,
        headers: {
          Authorization: `Bearer ${conf.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') throw new HttpError(400, 'AI 返回内容为空');
    return {
      content: content.trim().slice(0, maxChars),
      model: conf.model,
      ms: Date.now() - started,
    };
  } catch (error) {
    throw friendlyError(error);
  }
}

module.exports = { chat, friendlyError };
