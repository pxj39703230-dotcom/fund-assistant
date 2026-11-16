'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'fund-coach', 'SKILL.md');
let cache = { mtimeMs: 0, text: '' };

function loadCoachSkill() {
  try {
    const stat = fs.statSync(SKILL_PATH);
    if (cache.text && cache.mtimeMs === stat.mtimeMs) return cache.text;
    const text = fs.readFileSync(SKILL_PATH, 'utf8').trim();
    cache = { mtimeMs: stat.mtimeMs, text };
    return text;
  } catch (error) {
    return '你是用户个人基金助手里的新手教练。只依据用户数据回答，不预测涨跌，先给结论，再给理由和下一步。';
  }
}

function coachPrompt(style = 'coach') {
  const lengthRule = style === 'brief'
    ? '这次用简洁模式：只保留一句话结论、2 条理由、1 个动作，150-250 字。'
    : '这次用详细模式：结论、2-4 条带数字的理由、下一步、改口条件、一个新手词条、底线，500-800 字。';
  return `${loadCoachSkill()}\n\n## 本次输出要求\n${lengthRule}`;
}

module.exports = { loadCoachSkill, coachPrompt, SKILL_PATH };
