'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { todayString, diffDays, addDays, isDateString } = require('../backend/utils/date');

test('diffDays 同日为 0，正负方向正确', () => {
  assert.equal(diffDays('2026-11-13', '2026-11-13'), 0);
  assert.equal(diffDays('2026-11-12', '2026-11-13'), 1);
  assert.equal(diffDays('2026-11-13', '2026-11-12'), -1);
  assert.equal(diffDays('2026-01-01', '2026-12-31'), 364);
});

test('跨月、跨年不会因为时区少算或多算一天', () => {
  assert.equal(diffDays('2026-02-28', '2026-03-01'), 1);
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1);
  assert.equal(diffDays('2024-02-28', '2024-03-01'), 2); // 闰年
  assert.equal(diffDays('2026-03-08', '2026-03-09'), 1);
});

test('addDays 往返一致', () => {
  assert.equal(addDays('2026-11-13', 30), '2026-12-13');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(diffDays(todayString(), addDays(todayString(), 7)), 7);
});

test('isDateString 拒绝非法日期与未来格式错误', () => {
  assert.equal(isDateString('2026-11-13'), true);
  assert.equal(isDateString('2026-13-01'), false);
  assert.equal(isDateString('2026-2-3'), false);
  assert.equal(isDateString(''), false);
  assert.equal(isDateString(null), false);
});
