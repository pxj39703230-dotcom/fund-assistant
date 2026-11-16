'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHoldingPayload, parseHoldingPatch, parseId, parseDays } = require('../backend/http/validate');
const { todayString, addDays } = require('../backend/utils/date');

const valid = {
  fundCode: '110022',
  buyDate: '2026-01-05',
  buyAmount: 1000,
  buyNetValue: 2.5,
};

test('合法入参会补上默认止盈止损', () => {
  const payload = parseHoldingPayload(valid);
  assert.equal(payload.fundCode, '110022');
  assert.equal(payload.targetProfit, 0.3);
  assert.equal(payload.stopLoss, 0.2);
  assert.equal(payload.note, '');
});

test('拒绝金额为 0、代码位数不对、未来日期', () => {
  assert.throws(() => parseHoldingPayload({ ...valid, buyAmount: 0 }), /买入金额/);
  assert.throws(() => parseHoldingPayload({ ...valid, fundCode: '11002' }), /基金代码/);
  assert.throws(() => parseHoldingPayload({ ...valid, fundCode: '11002A' }), /基金代码/);
  assert.throws(() => parseHoldingPayload({ ...valid, buyDate: addDays(todayString(), 1) }), /未来日期/);
  assert.throws(() => parseHoldingPayload({ ...valid, buyDate: '2026/01/05' }), /YYYY-MM-DD/);
});

test('止盈止损超范围直接拒绝', () => {
  assert.throws(() => parseHoldingPayload({ ...valid, targetProfit: 3 }), /止盈线/);
  assert.throws(() => parseHoldingPayload({ ...valid, stopLoss: -0.1 }), /止损线/);
  assert.throws(() => parseHoldingPayload({ ...valid, stopLoss: 1.5 }), /止损线/);
});

test('备注超过 200 字拒绝，空备注视为清空', () => {
  assert.throws(() => parseHoldingPayload({ ...valid, note: 'x'.repeat(201) }), /备注/);
  assert.equal(parseHoldingPatch({ note: '' }).note, '');
});

test('PUT 没有任何字段时给出明确错误，而不是静默成功', () => {
  assert.throws(() => parseHoldingPatch({}), /没有需要更新的字段/);
  assert.throws(() => parseHoldingPatch({ targetProfit: undefined }), /没有需要更新的字段/);
});

test('ID 与天数解析有边界', () => {
  assert.equal(parseId('3'), 3);
  assert.throws(() => parseId('0'), /ID/);
  assert.throws(() => parseId('abc'), /ID/);
  assert.equal(parseDays('30'), 30);
  assert.equal(parseDays('999'), 50);
  assert.equal(parseDays('-1'), 5);
  assert.equal(parseDays(undefined, 30), 30);
});
