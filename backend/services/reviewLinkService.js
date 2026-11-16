'use strict';

const db = require('../config/database');
const { comparePlans } = require('../domain/analysis');

function latestDailyBefore(today) {
  const row = db.get(
    "SELECT date, data FROM reviews WHERE type = 'daily' AND date < ? ORDER BY date DESC, id DESC LIMIT 1",
    [today],
  );
  if (!row) return null;
  let data = null;
  try {
    data = row.data ? JSON.parse(row.data) : null;
  } catch (error) {
    data = null;
  }
  if (!data?.plan) return null;
  return { date: row.date, plan: data.plan };
}

function buildCheck(todayPlan, today) {
  if (!todayPlan) return null;
  const previous = latestDailyBefore(today);
  if (!previous) return null;
  return comparePlans(previous.plan, todayPlan, previous.date);
}

module.exports = { buildCheck, latestDailyBefore };
