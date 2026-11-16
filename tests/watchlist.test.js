'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeInput, decorate, hoursLeft } = require('../backend/services/watchlistService');

test('想买清单：代码、目标净值、理由规范化', () => {
  const item = normalizeInput({ code: '110022', targetNav: '2.60', reason: '  看好消费复苏  ', score: '72', grade: '可以分批买' });
  assert.equal(item.code, '110022');
  assert.equal(item.targetNav, 2.6);
  assert.equal(item.reason, '看好消费复苏');
  assert.equal(item.score, 72);
  assert.equal(item.grade, '可以分批买');
});

test('想买清单：代码不合法直接拒绝', () => {
  assert.throws(() => normalizeInput({ code: '11002' }), /6 位数字/);
});

test('想买清单：目标净值不能为负', () => {
  assert.throws(() => normalizeInput({ code: '110022', targetNav: -1 }), /大于 0/);
});

test('想买清单：冷静期剩余小时与到期状态', () => {
  const now = new Date('2026-11-16T08:00:00');
  assert.equal(hoursLeft('2026-11-17 08:00:00', now), 24);
  assert.equal(hoursLeft('2026-11-16 07:00:00', now), 0);
  const item = decorate({
    id: 1,
    code: '110022',
    name: '易方达消费行业股票',
    target_nav: null,
    reason: '测试',
    score: 66,
    grade: '能买，但先小仓位',
    status: 'ready',
    cool_until: '2026-11-16 07:00:00',
    created_at: '2026-11-15 07:00:00',
  }, now);
  assert.equal(item.isReady, true);
  assert.equal(item.coolingHours, 0);
  assert.equal(item.targetNav, null);
});
