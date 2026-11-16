'use strict';

/**
 * 投资宪法：用户自己定的硬规则，买之前逐条对照。
 * 纯函数，不联网；只回答“这笔是否越线、最多还能买多少”。
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  maxSingleWeight: 30,
  maxLossPerBuy: 50,
  maxFirstBuy: 300,
  minCheckScore: 55,
  maxFunds: 5,
});

const BOUNDS = {
  maxSingleWeight: [10, 100],
  maxLossPerBuy: [1, 100000],
  maxFirstBuy: [10, 100000],
  minCheckScore: [0, 100],
  maxFunds: [1, 20],
};

function bad(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(input = {}, base = DEFAULTS) {
  const merged = { ...DEFAULTS, ...(base || {}), ...(input || {}) };
  const enabled = typeof merged.enabled === 'boolean' ? merged.enabled : Boolean(merged.enabled);

  const result = { enabled };
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    const value = num(merged[key]);
    if (value === null || value < min || value > max) {
      throw bad(`${key} 要在 ${min} 到 ${max} 之间`);
    }
    result[key] = key === 'maxFunds' ? Math.round(value) : Math.round(value * 100) / 100;
  }
  return result;
}

function pctText(value) {
  return `${(Math.round(Number(value) * 10) / 10).toFixed(1)}%`;
}

function yuanText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100) / 100} 元` : '—';
}

function failedRule(key, label, detail) {
  return { key, label, passed: false, applicable: true, detail };
}

function passedRule(key, label, detail) {
  return { key, label, passed: true, applicable: true, detail };
}

function skippedRule(key, label, detail) {
  return { key, label, passed: true, applicable: false, detail };
}

/**
 * 把“买入后这只占多少”算出来，并给出允许的最大金额。
 * 当组合还没有第二只基金时，不拿 100% 去卡第一只，避免新手永远买不了第一笔。
 */
function weightLimit({ maxSingleWeight, total, fundValue, amount, fundCount }) {
  const maxRatio = maxSingleWeight / 100;
  if (total <= 0) return { applies: false, allowed: 0, postWeight: 0 };
  const currentValue = Math.max(0, fundValue);
  const buyAmount = Math.max(0, Number(amount) || 0);
  const postTotal = total + buyAmount;
  const postWeight = postTotal > 0 ? (currentValue + buyAmount) / postTotal : 0;
  const allowed = maxRatio < 1
    ? Math.max(0, (maxRatio * total - currentValue) / (1 - maxRatio))
    : Infinity;
  return { applies: fundCount >= 2, allowed, postWeight };
}

function evaluate(input = {}) {
  const rules = normalize(input.rules || {});
  const amount = Math.max(0, Number(input.amount) || 0);
  const score = input.score === null || input.score === undefined ? null : Number(input.score);
  const stopLoss = Math.max(0, Number(input.stopLoss) || 0);
  const summary = input.portfolio || {};
  const fundCount = Math.max(0, Number(summary.fundCount) || 0);
  const total = Math.max(0, Number(summary.value) || 0);
  const fundValue = Math.max(0, Number(input.fundValue) || 0);
  const mode = input.mode === 'add' ? 'add' : 'first';
  const dataReady = input.dataReady !== false && amount > 0;

  if (!rules.enabled) {
    return {
      enabled: false,
      passed: true,
      blocked: false,
      level: 'off',
      headline: '投资宪法已停用，这笔没有经过规则拦截',
      rules: [],
      audit: auditPortfolio(rules, summary),
      amount,
      mode,
    };
  }

  if (!dataReady) {
    return {
      enabled: true,
      passed: false,
      blocked: true,
      level: 'unknown',
      headline: '数据不够，宪法无法核对；先别买，等体检有分数和止损线再说',
      rules: [failedRule('data', '数据完整', '没有体检分数或止损线，无法算这笔会亏多少')],
      audit: auditPortfolio(rules, summary),
      amount,
      mode,
    };
  }

  const resultRules = [];
  const weight = weightLimit({
    maxSingleWeight: rules.maxSingleWeight,
    total,
    fundValue,
    amount,
    fundCount,
  });
  if (!weight.applies) {
    resultRules.push(skippedRule(
      'weight',
      '单只不超过 ' + rules.maxSingleWeight + '%',
      fundCount < 2
        ? '组合只有 1 只，第一只不按比例卡；先建第二只，再谈集中度'
        : '组合还没有市值，先从小额开始',
    ));
  } else {
    const postWeightPct = weight.postWeight * 100;
    if (postWeightPct <= rules.maxSingleWeight + 1e-9) {
      resultRules.push(passedRule(
        'weight',
        '单只不超过 ' + rules.maxSingleWeight + '%',
        '买入后这只占 ' + pctText(postWeightPct) + '，没有越线',
      ));
    } else {
      const allowed = Math.floor(weight.allowed / 10) * 10;
      const suggestion = allowed >= 10
        ? '把金额降到约 ' + allowed + ' 元以内，或先分散现有持仓'
        : '现有这只已经超配，这笔先别加；下一笔换方向';
      resultRules.push(failedRule(
        'weight',
        '单只不超过 ' + rules.maxSingleWeight + '%',
        '买入后这只占 ' + pctText(postWeightPct) + '，超过上限；' + suggestion,
      ));
    }
  }

  if (stopLoss <= 0) {
    resultRules.push(failedRule('loss', '单笔最多亏 ' + yuanText(rules.maxLossPerBuy), '这笔没有止损线，无法算最大亏损；先设止损再买'));
  } else {
    const loss = amount * stopLoss;
    if (loss <= rules.maxLossPerBuy + 1e-9) {
      resultRules.push(passedRule(
        'loss',
        '单笔最多亏 ' + yuanText(rules.maxLossPerBuy),
        '按 -' + Math.round(stopLoss * 100) + '% 止损，约亏 ' + yuanText(loss),
      ));
    } else {
      const allowed = Math.floor((rules.maxLossPerBuy / stopLoss) / 10) * 10;
      resultRules.push(failedRule(
        'loss',
        '单笔最多亏 ' + yuanText(rules.maxLossPerBuy),
        '按 -' + Math.round(stopLoss * 100) + '% 止损，约亏 ' + yuanText(loss) + '，超过上限；把金额降到约 ' + Math.max(0, allowed) + ' 元以内',
      ));
    }
  }

  if (mode === 'first') {
    if (amount <= rules.maxFirstBuy + 1e-9) {
      resultRules.push(passedRule(
        'first',
        '新基金首笔不超过 ' + yuanText(rules.maxFirstBuy),
        '这笔 ' + yuanText(amount) + '，在首笔上限内',
      ));
    } else {
      resultRules.push(failedRule(
        'first',
        '新基金首笔不超过 ' + yuanText(rules.maxFirstBuy),
        '这笔 ' + yuanText(amount) + '，超过首笔上限；先买 ' + yuanText(rules.maxFirstBuy) + ' 试水，拿得住再加',
      ));
    }
  } else {
    resultRules.push(skippedRule('first', '新基金首笔上限', '这笔是已有持仓加仓，不适用首笔上限'));
  }

  if (score === null || !Number.isFinite(score)) {
    resultRules.push(failedRule('score', '体检分至少 ' + rules.minCheckScore, '没有体检分，先做体检再买'));
  } else if (score >= rules.minCheckScore) {
    resultRules.push(passedRule('score', '体检分至少 ' + rules.minCheckScore, '当前 ' + Math.round(score) + ' 分，过线'));
  } else {
    resultRules.push(failedRule('score', '体检分至少 ' + rules.minCheckScore, '当前 ' + Math.round(score) + ' 分，低于宪法线；先观察，别急着买'));
  }

  if (mode === 'first' && fundCount >= rules.maxFunds) {
    resultRules.push(failedRule(
      'count',
      '最多持有 ' + rules.maxFunds + ' 只',
      '现在已有 ' + fundCount + ' 只，再加就超过上限；先合并或替换',
    ));
  } else {
    resultRules.push(passedRule(
      'count',
      '最多持有 ' + rules.maxFunds + ' 只',
      mode === 'add' ? '加仓不增加基金只数' : '买后 ' + (fundCount + 1) + ' 只，未超上限',
    ));
  }

  const failed = resultRules.filter((item) => item.applicable && !item.passed);
  const passed = failed.length === 0;
  const headline = passed
    ? '宪法通过：这笔可以按计划走，别一次买满'
    : '宪法不通过：' + failed[0].label + '。' + failed[0].detail;

  return {
    enabled: true,
    passed,
    blocked: !passed,
    level: passed ? 'pass' : 'block',
    headline,
    rules: resultRules,
    failed: failed.map((item) => item.label),
    audit: auditPortfolio(rules, summary),
    amount,
    mode,
    postWeight: weight.applies ? weight.postWeight : null,
  };
}

function auditPortfolio(rulesInput, summary = {}) {
  const rules = normalize(rulesInput || {});
  if (!rules.enabled) {
    return { enabled: false, level: 'off', items: [] };
  }
  const fundCount = Math.max(0, Number(summary.fundCount) || 0);
  const topWeight = Math.max(0, Number(summary.topWeight) || 0);
  const topFund = summary.topFund || '占比最大的那只';
  const items = [];

  if (fundCount >= 2 && topWeight * 100 > rules.maxSingleWeight + 1e-9) {
    items.push({
      key: 'weight',
      level: 'warn',
      label: '单只占比 ' + pctText(topWeight * 100),
      text: topFund + ' 占 ' + pctText(topWeight * 100) + '，超过宪法 ' + rules.maxSingleWeight + '%。已持有的不强制卖；先别加仓，下一笔换方向。',
    });
  }
  if (fundCount > rules.maxFunds) {
    items.push({
      key: 'count',
      level: 'warn',
      label: '基金只数 ' + fundCount,
      text: '已有 ' + fundCount + ' 只，超过宪法上限 ' + rules.maxFunds + ' 只；先合并或替换，不要继续加新基金。',
    });
  }
  if (fundCount === 1 && topWeight >= 0.99) {
    items.push({
      key: 'first-fund',
      level: 'info',
      label: '组合只有 1 只',
      text: '现在 100% 压在一只基金上，这是建仓阶段，不用自责；下一笔优先加到不同方向，把比例降下来。',
    });
  }

  return { enabled: true, level: items.some((item) => item.level === 'warn') ? 'warn' : 'ok', items };
}

module.exports = {
  DEFAULTS,
  BOUNDS,
  normalize,
  evaluate,
  auditPortfolio,
  pctText,
  yuanText,
};
