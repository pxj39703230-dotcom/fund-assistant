'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { coachPrompt, loadCoachSkill, SKILL_PATH } = require('../backend/services/skillService');

test('新手教练 Skill 文件存在且包含关键约束', () => {
  assert.ok(fs.existsSync(SKILL_PATH));
  const text = loadCoachSkill();
  assert.ok(text.includes('新手教练'));
  assert.ok(text.includes('不预测涨跌'));
  assert.ok(text.includes('投资宪法'));
  assert.ok(text.includes('先看结论') || text.includes('一句话结论'));
});

test('详细模式提示词要求完整结构', () => {
  const prompt = coachPrompt('coach');
  assert.ok(prompt.includes('500-800 字'));
  assert.ok(prompt.includes('改口条件'));
});

test('简洁模式提示词限制长度', () => {
  const prompt = coachPrompt('brief');
  assert.ok(prompt.includes('150-250 字'));
});
