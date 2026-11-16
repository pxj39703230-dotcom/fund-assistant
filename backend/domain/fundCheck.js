'use strict';

/**
 * 买入体检：把一只基金的历史波动、趋势位置、费率和你的组合情况
 * 打分并翻译成"能不能买、先买多少、跌破多少走"。
 * 纯函数，不联网、不预测，只做纪律判断。
 */

const RULES = {
  minSamples: 12,
  volHigh: 0.28,
  volWarn: 0.22,
  ddHeavy: -0.2,
  ddWarn: -0.12,
  chaseWarn: -0.03,
  singleMaxWeight: 0.4,
};

function fixed(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function pctText(ratio) {
  return `${fixed(ratio * 100, 2)}%`;
}

function signedPct(ratio) {
  const value = fixed(ratio * 100, 2);
  return `${value >= 0 ? '+' : ''}${value}%`;
}

function gradeOf(score) {
  if (score >= 72) return { grade: 'buy', gradeLabel: '可以分批买', tone: 'good' };
  if (score >= 55) return { grade: 'try', gradeLabel: '能买，但先小仓位', tone: 'warn' };
  return { grade: 'avoid', gradeLabel: '现在不建议买', tone: 'danger' };
}

function checkFund(input = {}) {
  const stats = input.stats || {};
  const fees = input.fees || {};
  const portfolio = input.portfolio || {};
  const name = input.name || input.code || '这只基金';
  const strategy = input.strategy === 'swing' ? 'swing' : (input.strategy === 'long' ? 'long' : 'long');

  const sample = Number(stats.sampleDays || 0);
  if (sample < RULES.minSamples) {
    return {
      code: input.code || null,
      name,
      score: null,
      grade: 'unknown',
      gradeLabel: '数据不够，先观察',
      tone: 'info',
      headline: `只拿到 ${sample} 个交易日的净值，样本不足，先别急着下手`,
      text: '历史净值不足 12 个交易日，趋势和回撤都算不准。先观察两周，等数据够了再来体检。',
      reasons: [`历史净值只有 ${sample} 天，趋势判断不可靠`],
      risks: ['样本不足，任何结论都可能失真'],
      plan: null,
      stats,
      fees,
    };
  }

  let score = 60;
  const reasons = [];
  const risks = [];

  const trendScore = Number(stats.trendScore || 0);
  if (trendScore >= 2) {
    score += 12;
    reasons.push(`趋势：近 20 日 ${signedPct(stats.r20 || 0)}，站上 20/50 日均线，${stats.trendLabel || '偏强'}`);
  } else if (trendScore === 1) {
    score += 5;
    reasons.push(`趋势：近 20 日 ${signedPct(stats.r20 || 0)}，只站上一条均线，${stats.trendLabel || '震荡'}`);
  } else if (trendScore <= -1) {
    score -= 12;
    reasons.push(`趋势：近 20 日 ${signedPct(stats.r20 || 0)}，已跌破均线，${stats.trendLabel || '偏弱'}`);
    risks.push('趋势向下，买入后继续阴跌的概率不低');
  }

  const dd = Number(stats.ddFromPeak || 0);
  if (dd <= RULES.ddHeavy) {
    score += 4;
    reasons.push(`位置：距高点回撤 ${pctText(Math.abs(dd))}（高点 ${stats.peakNav ?? '—'}），跌得比较多`);
    risks.push('回撤已超 20%，可能仍在下跌途中，别一次买满');
  } else if (dd <= RULES.ddWarn) {
    score -= 4;
    reasons.push(`位置：距高点回撤 ${pctText(Math.abs(dd))}，处在半山腰`);
  } else if (dd > RULES.chaseWarn) {
    score -= 6;
    reasons.push('位置：就在买入后高点附近，属于追高位置');
    risks.push('追高风险：一旦回调，短期浮亏会很明显');
  } else {
    reasons.push(`位置：距高点回撤 ${pctText(Math.abs(dd))}，位置适中`);
  }

  const vol = Number(stats.volatility || 0);
  if (vol >= RULES.volHigh) {
    score -= 10;
    reasons.push(`波动：年化波动 ${pctText(vol)}，涨跌都很猛`);
    risks.push('高波动品种，单日 2-3% 的波动很常见，拿不住就容易割在低点');
  } else if (vol >= RULES.volWarn) {
    score -= 5;
    reasons.push(`波动：年化波动 ${pctText(vol)}，偏大`);
  } else {
    reasons.push(`波动：年化波动 ${pctText(vol)}，相对温和`);
  }

  if (strategy === 'swing' && trendScore <= -1) {
    score -= 8;
    risks.push('行业主题基金 + 趋势已走弱，波段逻辑下现在不是买点');
  }

  const purchaseRate = Number(fees.purchaseRate || 0);
  if (purchaseRate > 0) {
    reasons.push(`成本：申购费 ${fixed(purchaseRate * 100, 3)}%，7 天内赎回通常还有 1.5% 惩罚性费率`);
  }

  const shortFee = Number(fees.redemptionShort || 0);
  if (shortFee >= 0.01) {
    risks.push(`短期赎回费 ${pctText(shortFee)}：买了又马上卖，光手续费就吃掉一大截`);
  }

  if (Number(portfolio.fundCount || 0) >= 2 && Number(portfolio.topWeight || 0) >= RULES.singleMaxWeight) {
    risks.push(`你的组合里 ${portfolio.topFund || '单只基金'} 已占 ${pctText(portfolio.topWeight)}，再买同方向会加剧集中`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const { grade, gradeLabel, tone } = gradeOf(score);

  const headline = grade === 'buy'
    ? '趋势和位置都还行，可以分 2-3 次买，别一次打满'
    : grade === 'try'
      ? '能买，但位置或波动一般，先用小钱试水'
      : '现在不是好买点（趋势弱或位置太高），等信号再说';

  const baseValue = Number(portfolio.value || portfolio.invest || 0);
  const firstAmount = Math.max(100, Math.min(1000, Math.round((baseValue * 0.1 || 300) / 100) * 100));
  const stopLoss = vol >= 0.25 ? 0.15 : 0.1;
  const targetProfit = strategy === 'long' ? 0.3 : 0.2;

  const plan = {
    firstAmount,
    batches: 3,
    stopLoss,
    targetProfit,
    holdHint: strategy === 'long' ? '按年拿，每季度看一次' : '1-3 个月，跌破 20 日均线就走',
    lines: [
      `先买 ${firstAmount} 元，分 3 次、每次间隔 1-2 周，不要一把梭`,
      `跌破买入价 -${fixed(stopLoss * 100, 0)}% 就止损离场`,
      `涨到 +${fixed(targetProfit * 100, 0)}% 先卖一半锁利润`,
      `持有不满 7 天先别卖，赎回费 1.5% 不划算`,
    ],
  };

  const text = [
    `${name}（${input.code || '—'}）：${gradeLabel}，纪律分 ${score}/100。`,
    ...reasons.map((item) => `· ${item}`),
    ...(risks.length ? ['风险：', ...risks.map((item) => `! ${item}`)] : []),
    '怎么买：',
    ...plan.lines.map((item) => `· ${item}`),
    '以上是规则判断，不预测涨跌，也不构成投资建议。',
  ].join('\n');

  return {
    code: input.code || null,
    name,
    score,
    grade,
    gradeLabel,
    tone,
    headline,
    text,
    reasons,
    risks,
    plan,
    stats,
    fees,
    type: input.type || null,
    strategy,
  };
}

module.exports = { checkFund, RULES };
