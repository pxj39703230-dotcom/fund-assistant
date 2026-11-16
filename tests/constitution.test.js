'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  DEFAULTS,
  normalize,
  evaluate,
  auditPortfolio,
} = require('../backend/domain/constitution');

const portfolio = { value: 1000, fundCount: 2, topWeight: 0.999, topFund: '023313' };

test('宪法：默认规则可读且边界校验', () => {
  const rules = normalize({});
  assert.equal(rules.enabled, true);
  assert.equal(rules.maxSingleWeight, 30);
  assert.equal(rules.maxFirstBuy, 300);
  assert.throws(() => normalize({ maxSingleWeight: 0 }), /10 到 100/);
  assert.throws(() => normalize({ maxFunds: 0 }), /1 到 20/);
});

test('宪法：100 元试水通过五条规则', () => {
  const result = evaluate({
    amount: 100,
    mode: 'first',
    score: 66,
    stopLoss: 0.1,
    portfolio,
    fundValue: 0,
    dataReady: true,
  });
  assert.equal(result.passed, true);
  assert.equal(result.level, 'pass');
  assert.equal(result.rules.filter((item) => item.applicable && !item.passed).length, 0);
});

test('宪法：单只占比越线会拦截，并给出降额建议', () => {
  const result = evaluate({
    amount: 500,
    mode: 'first',
    score: 66,
    stopLoss: 0.1,
    portfolio,
    fundValue: 1,
    dataReady: true,
  });
  assert.equal(result.passed, false);
  assert.equal(result.blocked, true);
  assert.match(result.headline, /单只不超过 30%/);
  assert.match(result.headline, /420 元以内/);
});

test('宪法：首笔上限拦住 500 元新基金', () => {
  const result = evaluate({
    amount: 500,
    mode: 'first',
    score: 66,
    stopLoss: 0.1,
    portfolio: { value: 1000, fundCount: 1, topWeight: 1 },
    fundValue: 0,
    dataReady: true,
  });
  const first = result.rules.find((item) => item.key === 'first');
  assert.equal(first.passed, false);
  assert.match(first.detail, /超过首笔上限/);
});

test('宪法：单笔亏损超过上限会被点名', () => {
  const result = evaluate({
    amount: 1000,
    mode: 'add',
    score: 66,
    stopLoss: 0.1,
    portfolio,
    fundValue: 0,
    dataReady: true,
  });
  const loss = result.rules.find((item) => item.key === 'loss');
  assert.equal(loss.passed, false);
  assert.match(loss.detail, /约亏 100 元/);
  assert.match(loss.detail, /500 元以内/);
});

test('宪法：体检分不够和基金只数超限', () => {
  const lowScore = evaluate({
    amount: 100,
    mode: 'first',
    score: 40,
    stopLoss: 0.1,
    portfolio: { value: 1000, fundCount: 1, topWeight: 1 },
    fundValue: 0,
    dataReady: true,
  });
  assert.equal(lowScore.rules.find((item) => item.key === 'score').passed, false);

  const tooMany = evaluate({
    amount: 100,
    mode: 'first',
    score: 66,
    stopLoss: 0.1,
    portfolio: { value: 5000, fundCount: 5, topWeight: 0.2, topFund: 'A' },
    fundValue: 0,
    dataReady: true,
  });
  assert.equal(tooMany.rules.find((item) => item.key === 'count').passed, false);
});

test('宪法：第一只基金不被 100% 集中度卡住', () => {
  const result = evaluate({
    amount: 100,
    mode: 'first',
    score: 66,
    stopLoss: 0.1,
    portfolio: { value: 0, fundCount: 0, topWeight: 0 },
    fundValue: 0,
    dataReady: true,
  });
  const weight = result.rules.find((item) => item.key === 'weight');
  assert.equal(weight.applicable, false);
  assert.equal(result.passed, true);
});

test('宪法：组合审计指出 99.9% 单只集中', () => {
  const audit = auditPortfolio(DEFAULTS, portfolio);
  assert.equal(audit.level, 'warn');
  assert.equal(audit.items.length, 1);
  assert.match(audit.items[0].text, /已持有的不强制卖/);
});

test('宪法：停用时不再拦截，但保留审计', () => {
  const result = evaluate({
    rules: { enabled: false },
    amount: 500,
    mode: 'first',
    score: 40,
    stopLoss: 0.1,
    portfolio,
    fundValue: 0,
  });
  assert.equal(result.passed, true);
  assert.equal(result.level, 'off');
  assert.equal(result.blocked, false);
});

test('宪法：数据不足时明确拦住', () => {
  const result = evaluate({
    amount: 0,
    mode: 'first',
    score: null,
    stopLoss: 0,
    portfolio,
    fundValue: 0,
    dataReady: false,
  });
  assert.equal(result.passed, false);
  assert.equal(result.level, 'unknown');
  assert.match(result.headline, /数据不够/);
});
