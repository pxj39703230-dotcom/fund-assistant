'use strict';

const db = require('../config/database');
const { DEFAULTS, normalize, evaluate, auditPortfolio } = require('../domain/constitution');

const SETTING_KEY = 'constitution_rules';

function readRaw() {
  const value = db.getSetting(SETTING_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function read() {
  try {
    return normalize(readRaw() || {});
  } catch (error) {
    return normalize(DEFAULTS);
  }
}

function save(input = {}) {
  const next = normalize(input, read());
  db.setSetting(SETTING_KEY, JSON.stringify(next));
  return next;
}

function updatedAt() {
  const row = db.get('SELECT updated_at FROM settings WHERE key = ?', [SETTING_KEY]);
  return row ? row.updated_at : null;
}

function publicView(summary = {}) {
  const rules = read();
  return {
    rules,
    audit: auditPortfolio(rules, summary),
    updatedAt: updatedAt(),
  };
}

function evaluateForBuy({ check, amount, mode, portfolio, fundValue, dataReady }) {
  return evaluate({
    rules: read(),
    amount,
    mode,
    score: check?.score,
    stopLoss: check?.plan?.stopLoss,
    portfolio,
    fundValue,
    dataReady,
  });
}

function audit(summary = {}) {
  return auditPortfolio(read(), summary);
}

module.exports = { read, save, publicView, evaluateForBuy, audit, updatedAt, DEFAULTS };
