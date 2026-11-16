'use strict';

const aiClient = require('./aiClient');
const aiConfigService = require('./aiConfigService');
const portfolioService = require('./portfolioService');
const fundCheckService = require('./fundCheckService');
const skillService = require('./skillService');
const { createLogger } = require('../utils/logger');

const log = createLogger('assistant');

const CHIPS = ['110022 能不能买', '现在该卖吗', '我的仓位有问题吗', '赎回费怎么算'];
const CODE_RE = /(\d{6})/;
const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(万)?\s*(?:块钱|块|元)/;
const BUY_RE = /(买|买入|加仓|上车|适合|能不能|值不值|体检|靠谱|机会)/;
const SELL_RE = /(卖|卖出|抛|减仓|止盈|止损|清仓|割肉|跑)/;
const POSITION_RE = /(仓位|组合|集中|分散|风险|配置|占比)/;
const MARKET_RE = /(大盘|行情|指数|开盘|收盘|上证|深证|创业板|涨|跌)/;
const FEE_RE = /(费率|手续费|赎回费|申购费|管理费|托管费)/;
const HELP_RE = /(怎么用|能做什么|功能|帮助|你会|你是谁)/;

function extractCode(text) {
  const match = String(text || '').match(CODE_RE);
  return match ? match[1] : null;
}

function extractAmount(text) {
  const match = String(text || '').match(AMOUNT_RE);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] ? 10000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function pctText(ratio) {
  return `${(Number(ratio) * 100).toFixed(2)}%`;
}

function signedPct(ratio) {
  const value = Number(ratio) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function joinLines(lines) {
  return lines.filter((line) => line !== null && line !== undefined && line !== '').join('\n');
}

function yuan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n >= 100 ? 0 : 2)} 元`;
}

function constitutionLines(constitution, style) {
  if (!constitution || !constitution.enabled) return [];
  if (constitution.passed) {
    return [style === 'brief' ? '宪法：通过，按计划走。' : '宪法：5 条规则都过线，可以按上面的金额和节奏走。'];
  }
  const failed = (constitution.rules || []).filter((item) => item.applicable && !item.passed);
  return [
    '宪法：不通过，先别买。',
    ...failed.map((item) => `· 卡在「${item.label}」：${item.detail}`),
  ];
}

function coachTail(style, { term, next, change, risk }) {
  if (style === 'brief') return [];
  const lines = [];
  if (next) lines.push(`【下一步】${next}`);
  if (change) lines.push(`【什么情况下改口】${change}`);
  if (term) lines.push(`【新手词条】${term}`);
  if (risk) lines.push(`【底线】${risk}`);
  return lines.length ? ['', ...lines] : [];
}

function marketLine(market) {
  if (!market || !Array.isArray(market.indices) || !market.indices.length) {
    return '现在拿不到指数行情（不影响净值和建议）';
  }
  return market.indices
    .map((item) => `${item.name} ${Number(item.price).toFixed(2)}（${Number(item.pct) >= 0 ? '+' : ''}${Number(item.pct).toFixed(2)}%）`)
    .join('，');
}

function sellAnswer(portfolio, style = 'coach') {
  const positions = portfolio?.positions || [];
  if (!positions.length) {
    return {
      title: '卖出判断',
      answer: joinLines([
        '你还没有持仓，暂时没有可卖的。',
        '先在「添加持仓」里录入买入日期、金额和净值，我才能按纪律线和赎回费判断。',
        style === 'brief' ? '' : '【新手词条】卖出不是看今天涨没涨，而是看：趋势有没有坏、赎回费贵不贵、有没有触发你自己的止损线。',
      ]),
      chips: CHIPS,
    };
  }
  const items = positions.filter((pos) => pos.advice);
  const needAction = items.filter((pos) => Number(pos.advice.urgency) >= 1);
  const lines = [
    needAction.length
      ? `先看结论：今天有 ${needAction.length} 笔需要处理，其余继续拿。`
      : `先看结论：今天 ${items.length} 笔都不用动手。`,
    '',
    '为什么：',
  ];
  for (const pos of items) {
    const fee = Number(pos.profit?.fees?.redemptionRate || 0);
    const holdDays = pos.profit?.holdDays ?? '—';
    lines.push(`· ${pos.name}：${pos.advice.verdictLabel} —— ${pos.advice.action}`);
    if (fee > 0 || holdDays !== '—') {
      lines.push(`  这笔持有 ${holdDays} 天，现在卖赎回费约 ${pctText(fee)}；不是趋势坏了，就先别为了小波动付这个钱。`);
    }
    const triggers = (pos.advice.triggers || []).slice(0, 2).map((t) => `${t.label} ${t.value}`);
    if (triggers.length) lines.push(`  要盯的线：${triggers.join(' / ')}`);
  }
  lines.push(...coachTail(style, {
    next: needAction.length
      ? '先处理最急的那笔，按结论里的比例卖；没触发的不要“顺便一起卖”。卖完剩下的仍然按原来的止损线盯。'
      : '今天不操作也是一种操作。把要盯的线记下来，破线再动，不用每分钟看。',
    change: '净值跌破止损线、趋势转为明确向下、或者持有满 7 天进入更低赎回费档，三者任一变化，再回来问我一次。',
    term: '赎回费按持有天数分档：7 天内通常 1.5%，7 天到一年约 0.5%，时间越长越低。它是“卖出成本”，不是收益。',
    risk: '以上只根据你的持仓和纪律线判断，不预测涨跌；真有急用钱的需求，优先保证现金流，不要为了省手续费硬扛。',
  }));
  return { title: '卖出判断', answer: joinLines(lines), chips: CHIPS };
}

function positionAnswer(portfolio, style = 'coach') {
  const summary = portfolio?.summary || {};
  const plan = portfolio?.advice?.plan;
  if (!portfolio?.positions?.length) {
    return {
      title: '组合检查',
      answer: joinLines([
        '你还没有持仓，组合风险暂时无从谈起。',
        '先加一两笔小额试水，我就能帮你盯集中度、整体浮亏和单笔纪律线。',
        style === 'brief' ? '' : '【新手词条】仓位不是一个百分比，而是“这只基金跌 20% 时，你总共会亏多少钱”。',
      ]),
      chips: CHIPS,
    };
  }
  const lines = [
    `先看结论：当前 ${summary.fundCount || 0} 只基金、市值 ${yuan(summary.value)}，单只最大占比 ${pctText(summary.topWeight || 0)}。`,
    '',
    '为什么：',
  ];
  if (plan?.flags?.length) {
    for (const flag of plan.flags) lines.push(`· ${flag.title}：${flag.text}`);
  } else {
    lines.push('· 组合层面暂时没有触发集中度、系统性下跌或整体浮亏的提醒。');
  }
  if (Number(summary.topWeight || 0) >= 0.5) {
    lines.push(`· 最大那只占 ${pctText(summary.topWeight)}，它一波动，你的总资产就跟着大幅波动，这不是分散。`);
  }
  lines.push(`· 今日纪律结论：${plan?.headline || '—'}`);
  lines.push(...coachTail(style, {
    next: Number(summary.topWeight || 0) >= 0.5
      ? '先别再加同方向。下一笔资金优先放到和它相关性低的方向，或者干脆先留现金，等比例降下来。'
      : '保持现在的节奏，每加一笔都先看它会不会让最大单只占比超过 50%。',
    change: '最大单只占比降下来、或者出现整体浮亏超过你能承受的范围时，再重新判断。',
    term: '集中度 = 单只基金市值 ÷ 组合总市值。它不是越低越好，但太高意味着“一只基金决定你全部盈亏”。',
    risk: '分散只能降低单一风险，不能保证赚钱；小资金也不要为了分散买一堆，管理成本会变高。',
  }));
  return { title: '组合检查', answer: joinLines(lines), chips: CHIPS };
}

function marketAnswer(market, portfolio, style = 'coach') {
  const state = market?.stateLabel || '行情状态未知';
  const plan = portfolio?.advice?.plan;
  const lines = [
    `先看结论：现在是${state}。${marketLine(market)}`,
    '指数只用来判断“今天是不是系统性下跌”，不是买卖信号。',
  ];
  if (plan) lines.push(`· 你的组合今天：${plan.headline}`);
  lines.push(...coachTail(style, {
    next: '如果只是指数小跌、你的持仓没跌破纪律线，今天不用动；如果普跌且触发止损，按单笔结论处理，不要因为“大盘不好”一次清仓。',
    change: '指数跌幅扩大且你的持仓跌破止损线，或者行情从普跌转为单只基金独立走弱，再重新判断。',
    term: '系统性下跌 = 大部分指数一起跌，通常不是某只基金自身的问题；这种时候先看纪律线，不急着割。',
    risk: '行情是滞后数据，盘中估值也可能偏离，别用一分钟的涨跌做一辈子的决定。',
  }));
  return { title: '大盘情况', answer: joinLines(lines), chips: CHIPS };
}

function feeAnswer(portfolio, style = 'coach') {
  const positions = portfolio?.positions || [];
  if (!positions.length) {
    return {
      title: '费率说明',
      answer: joinLines([
        '先看结论：场外基金的费用主要分三块——申购费、赎回费、每天从净值里扣的管理费/托管费。',
        '申购费按金额分档，很多平台打 1 折，约 0.15%；赎回费按持有天数递减，7 天内通常 1.5%，7 天到一年约 0.5%，两年以上常为 0。',
        '管理费、托管费已经含在公布净值里，程序不会重复扣。',
        style === 'brief' ? '' : '【新手词条】“免申购费”不等于免费，赎回费和管理费还在；买之前先把两头都算进去。',
      ]),
      chips: CHIPS,
    };
  }
  const lines = [
    '先看结论：你这几笔现在的赎回费和“再等几天更划算”：',
  ];
  for (const pos of positions) {
    const fees = pos.profit?.fees || {};
    const opt = pos.profit?.redemption?.optimization;
    lines.push(`· ${pos.name}：持有 ${pos.profit?.holdDays ?? '—'} 天，赎回费 ${pctText(fees.redemptionRate || 0)}${opt?.text ? `；${opt.text}` : ''}`);
  }
  lines.push('管理费、托管费已包含在公布净值里，程序不会重复扣。');
  lines.push(...coachTail(style, {
    next: '先看每笔的“再持有几天降档”；如果只差几天、且趋势没坏，等一等通常比现在卖更划算。',
    change: '趋势明显走弱、或者需要用钱，就别为了省手续费硬等；省下的费可能还不够一天的下跌。',
    term: '申购费是买入时付的，赎回费是卖出时付的，管理费/托管费是每天从基金资产里扣的；三个不是一回事。',
    risk: '费率只是成本，不是买卖理由；不要因为“赎回费低”就频繁交易。',
  }));
  return { title: '费率说明', answer: joinLines(lines), chips: CHIPS };
}

function helpAnswer() {
  return {
    title: '我能做什么',
    answer: joinLines([
      '我只会用你自己的持仓数据和纪律线回答问题，不预测涨跌：',
      '· 买之前体检：发 6 位代码，例如「110022 能不能买」，我给纪律分、买多少、跌破多少走',
      '· 卖不卖：问「现在该卖吗」，我按止损/止盈/趋势/费率逐笔给结论',
      '· 组合风险：问「我的仓位有问题吗」，看集中度和整体浮亏',
      '· 大盘：问「今天大盘怎么样」，看指数和交易状态',
      '· 费率：问「赎回费怎么算」，看每笔的费档和等待是否划算',
      '· 想买但拿不准：先把它放进「想买清单」，强制冷静 24 小时，明天再决定。',
    ]),
    chips: CHIPS,
  };
}

/**
 * 规则回答：不联网也能用，所有数字都来自当前快照。
 */
function buildRuleAnswer({ question, code, portfolio, market, check, style = 'coach' }) {
  const text = String(question || '').trim();
  const marketData = market || portfolio?.market || null;
  const wantBuy = BUY_RE.test(text);
  const hasCode = Boolean(code || extractCode(text));

  if (check) {
    const short = style === 'brief';
    const reasons = (check.reasons || []).slice(0, short ? 2 : 3).map((item) => `· ${item}`);
    const risks = (check.risks || []).slice(0, short ? 1 : 2).map((item) => `! ${item}`);
    const planLines = (check.plan?.lines || []).slice(0, short ? 2 : 3).map((item) => `· ${item}`);
    const firstAmount = Number(check.constitution?.amount || check.plan?.firstAmount || 0);
    const stopLoss = Number(check.plan?.stopLoss || 0);
    const lossMoney = firstAmount > 0 && stopLoss > 0 ? Math.round(firstAmount * stopLoss * 100) / 100 : null;
    const blocked = check.constitution?.enabled && !check.constitution?.passed;
    const verdict = blocked ? '按你的投资宪法，这笔先别买' : check.gradeLabel;
    return {
      intent: 'check',
      title: `${check.name} 体检`,
      answer: joinLines([
        `先看结论：${verdict}，纪律分 ${check.score === null ? '—' : check.score}/100。`,
        check.headline,
        '',
        '为什么：',
        ...reasons,
        ...risks,
        ...constitutionLines(check.constitution, style),
        planLines.length ? '下一步：' : '',
        ...planLines,
        lossMoney ? `· 把亏损翻成人话：先买 ${firstAmount} 元，若触发 -${Math.round(stopLoss * 100)}% 止损，约亏 ${lossMoney} 元；这个数你能接受再买。` : '',
        ...coachTail(style, {
          change: '趋势重新站上均线、回撤收窄、或者你的组合集中度降下来，任一变化，重新体检一次再决定。',
          term: '纪律分不是预测分数，是把趋势、位置、波动、费率和你的仓位放在一起打的分；分数低不代表一定跌，只代表“现在下手不划算”。',
          risk: '体检是买前筛查，不保证收益；先买小仓、分批、设好止损，比一次买满更能让你拿得住。',
        }),
      ]),
      check,
      chips: CHIPS,
    };
  }

  if (wantBuy && !hasCode) {
    return {
      intent: 'ask-code',
      title: '买之前先体检',
      answer: joinLines([
        '先别急着买：我需要 6 位基金代码，才能做体检。',
        '把代码发我，例如「110022 能不能买」。我会看趋势、回撤位置、年化波动、申购赎回费，再结合你现在的组合集中度，给出“能不能买、先买多少、跌破多少走”。',
        '没有代码我不会瞎猜——盲目买才是真的可能亏钱。',
        style === 'brief' ? '' : '【下一步】打开基金 App 找到 6 位代码，直接发我；如果你已经持有，也可以问「现在该卖吗」。',
      ]),
      chips: CHIPS,
    };
  }

  if (SELL_RE.test(text)) {
    return { intent: 'sell', ...sellAnswer(portfolio, style) };
  }
  if (POSITION_RE.test(text)) {
    return { intent: 'position', ...positionAnswer(portfolio, style) };
  }
  if (MARKET_RE.test(text)) {
    return { intent: 'market', ...marketAnswer(marketData, portfolio, style) };
  }
  if (FEE_RE.test(text)) {
    return { intent: 'fee', ...feeAnswer(portfolio, style) };
  }
  if (HELP_RE.test(text)) {
    return { intent: 'help', ...helpAnswer() };
  }

  return {
    intent: 'fallback',
    title: '可以这样问我',
    answer: joinLines([
      '我没听懂具体要判断哪件事。你可以直接问：',
      '· 「110022 能不能买」——买入体检',
      '· 「现在该卖吗」——逐笔卖出结论',
      '· 「我的仓位有问题吗」——集中度和组合风险',
      '· 「今天大盘怎么样」——指数和交易状态',
      '· 「赎回费怎么算」——每笔的费档和等待是否划算',
    ]),
    chips: CHIPS,
  };
}

function compactSnapshot(portfolio, market, check) {
  const positions = (portfolio?.positions || []).map((pos) => ({
    code: pos.code,
    name: pos.name,
    strategy: pos.advice?.strategyLabel,
    verdict: pos.advice?.verdictLabel,
    action: pos.advice?.action,
    realPct: pos.profit?.realRate ? Number((pos.profit.realRate * 100).toFixed(2)) : null,
    holdDays: pos.profit?.holdDays,
    triggers: pos.advice?.triggers?.map((t) => `${t.label} ${t.value}`),
  }));
  return {
    today: portfolio?.meta?.today || null,
    summary: portfolio?.summary || null,
    plan: portfolio?.advice?.plan || null,
    positions,
    market: market ? { state: market.stateLabel, indices: (market.indices || []).map((i) => `${i.name} ${i.price} ${i.pct}%`) } : null,
    check: check ? {
      name: check.name,
      score: check.score,
      grade: check.gradeLabel,
      reasons: check.reasons,
      risks: check.risks,
      plan: check.plan,
      constitution: check.constitution || null,
    } : null,
  };
}

async function askAI({ question, snapshot, ruleAnswer, style = 'coach' }) {
  const system = [
    skillService.coachPrompt(style),
    '',
    '## 本次可用数据',
    JSON.stringify(snapshot),
    '',
    '## 规则引擎算出的参考结论',
    '可以改写得更口语、更像教练，但所有数字必须与这里一致：',
    '如果 check.constitution.enabled=true 且 passed=false，开头必须明确说“按你的投资宪法，这笔先别买”，并解释卡在哪条；不得建议绕过宪法。',
    ruleAnswer.answer,
  ].join('\n');

  const result = await aiClient.chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(question).slice(0, 500) },
    ],
    temperature: 0.3,
    maxTokens: style === 'brief' ? 500 : 1000,
  });
  return result.content;
}

async function ask({ question, code, style = 'coach' }) {
  const text = String(question || '').trim();
  const answerStyle = style === 'brief' ? 'brief' : 'coach';
  if (!text) {
    return { mode: 'rule', ...helpAnswer() };
  }

  const wantCode = extractCode(text) || (code ? String(code) : null);
  let portfolio = null;
  try {
    portfolio = await portfolioService.buildPortfolio({});
  } catch (error) {
    log.warn(`组合数据获取失败: ${error.message}`);
  }

  let check = null;
  if (wantCode && BUY_RE.test(text)) {
    try {
      check = await fundCheckService.checkFundByCode(wantCode, { amount: extractAmount(text) });
    } catch (error) {
      log.warn(`${wantCode} 体检失败: ${error.message}`);
    }
  }

  const market = portfolio?.market || null;
  const ruleAnswer = buildRuleAnswer({ question: text, code: wantCode, portfolio, market, check, style: answerStyle });

  const aiReady = aiConfigService.isReady();
  if (!aiReady) {
    return { mode: 'rule', ...ruleAnswer, aiReady: false };
  }

  try {
    const answer = await askAI({ question: text, snapshot: compactSnapshot(portfolio, market, check), ruleAnswer, style: answerStyle });
    return { mode: 'ai', ...ruleAnswer, answer, aiReady: true };
  } catch (error) {
    log.warn(`AI 调用失败，回退规则回答: ${error.message}`);
    return { mode: 'rule', ...ruleAnswer, aiReady: true, aiError: error.message };
  }
}

module.exports = { ask, buildRuleAnswer, extractCode, extractAmount, CHIPS };
