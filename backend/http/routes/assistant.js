'use strict';

const express = require('express');
const assistantService = require('../../services/assistantService');
const { asyncHandler, badRequest } = require('../../http/errors');

const router = express.Router();

router.post('/ask', asyncHandler(async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) throw badRequest('问题不能为空');
  if (question.length > 500) throw badRequest('问题太长，请控制在 500 字以内');
  const code = req.body?.code ? String(req.body.code).trim() : null;
  if (code && !/^\d{6}$/.test(code)) throw badRequest('基金代码必须是 6 位数字');

  const style = req.body?.style === 'brief' ? 'brief' : 'coach';
  const result = await assistantService.ask({ question, code, style });
  res.json(result);
}));

module.exports = router;
