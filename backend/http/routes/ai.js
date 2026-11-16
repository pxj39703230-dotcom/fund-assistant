'use strict';

const express = require('express');
const aiConfigService = require('../../services/aiConfigService');
const aiClient = require('../../services/aiClient');
const { asyncHandler } = require('../../http/errors');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(aiConfigService.publicView());
});

router.put('/', (req, res) => {
  res.json(aiConfigService.save(req.body || {}));
});

router.post('/test', asyncHandler(async (req, res) => {
  const result = await aiClient.chat({
    messages: [
      { role: 'system', content: '你是连通性测试助手，只回复用户要求的内容。' },
      { role: 'user', content: '只回复两个字：可用' },
    ],
    temperature: 0,
    maxTokens: 30,
    timeoutMs: 15000,
    maxChars: 100,
  });
  res.json({ ok: true, model: result.model, ms: result.ms, reply: result.content });
}));

module.exports = router;
