'use strict';

/**
 * 决策引擎（纯函数，不依赖数据库/网络）。
 *
 * 目标：让"小白"打开页面就知道三件事——现在该不该动、什么时候动、为什么。
 * 所有判断都用持仓自身的数据（净值序列、费率档位、止盈止损线）推导，
 * 不预测行情，只把"纪律"翻译成人话。
 */

const { round2, round4 } = require('../utils/number');
const { addDays } = require('../utils/date');

/** 风格推断用到的行业主题关键词（命中即视为波动大的主题基金） */
const THEME_KEYWORDS = [
  '消费', '白酒', '食品', '医药', '医疗', '生物', 'health', '军工', '国防', '新能源', '光伏', '储能',
  '半导体', '芯片', '科技', '人工智能', 'AI', '传媒', '游戏', '券商', '证券', '银行', '金融', '地产',
  '有色', '煤炭', '钢铁', '化工', '农业', '养殖', '汽车', '电池', '机器人', '通信', '5G', '建材',
  '环保', '旅游', '港股', '恒生', '黄金', '原油', '稀土', '电力', '红利',
];

/** 长线属性更强的类型/名称关键词 */
const LONG_KEYWORDS = ['债券', '纯债', '短债', '货币', '理财', '指数', 'ETF', '沪深300', '中证500', '中证A500', '纳斯达克', '标普', 'MSCI', '宽基'];

const RULES = {
  minSamples: 12,          // 少于 12 个交易日不做趋势判断
  drawdownWarn: 0.12,      // 从买入后高点回撤 12% → 提示减仓
  volatilitySwing: 0.22,   // 年化波动 22% 以上视为高波动
  feeWaitMaxDays: 7,       // 触发止损但降费在 7 天内，值得等
  feeWorthSaving: 0.004,   // 省的钱 ≥ 市值 0.4% 才算值得等
  marketPanicPct: -1.5,    // 大盘跌超 1.5% 视为系统性下跌
};

/** 均线 / 区间统计：只吃"日期升序"的净值序列 */
function computeStats(rows, options = {}) {
  const series = (rows || [])
    .filter((row) => Number.isFinite(Number(row.netValue)) && row.date)
    .map((row) => ({ date: row.date, nav: Number(row.netValue) }));

  if (series.length === 0) {
    return emptyStats();
  }

  const navs = series.map((item) => item.nav);
  const latest = navs[navs.length - 1];
  const lookback = (n) => (navs.length > n ? navs[navs.length - 1 - n] : navs[0]);
  const changeOver = (n) => {
    const base = lookback(n);
    return base > 0 ? latest / base - 1 : 0;
  };

  const ma = (n) => {
    if (navs.length < n) return null;
    const slice = navs.slice(-n);
    return slice.reduce((sum, v) => sum + v, 0) / n;
  };
  const ma20 = ma(20);
  const ma50 = ma(50);
  const ma20Prev = navs.length >= 25 ? average(navs.slice(-25, -5)) : null;

  // 日收益波动率 → 年化
  const dailyReturns = [];
  for (let i = 1; i < navs.length; i += 1) {
    if (navs[i - 1] > 0) dailyReturns.push(navs[i] / navs[i - 1] - 1);
  }
  const volatility = dailyReturns.length >= 5 ? stdev(dailyReturns) * Math.sqrt(252) : null;

  // 买入后的峰值与回撤
  const sinceBuy = options.buyDate ? series.filter((item) => item.date >= options.buyDate) : series;
  const window = sinceBuy.length >= 2 ? sinceBuy : series;
  let peakNav = window[0].nav;
  let peakDate = window[0].date;
  let maxDrawdown = 0;
  for (const item of window) {
    if (item.nav > peakNav) {
      peakNav = item.nav;
      peakDate = item.date;
    }
    if (peakNav > 0) maxDrawdown = Math.min(maxDrawdown, item.nav / peakNav - 1);
  }
  const ddFromPeak = peakNav > 0 ? latest / peakNav - 1 : 0;
  const lowNav = Math.min(...window.map((item) => item.nav));
  const lowDate = window.find((item) => item.nav === lowNav)?.date || null;

  const aboveMa20 = ma20 === null ? null : latest >= ma20;
  const aboveMa50 = ma50 === null ? null : latest >= ma50;
  const momentum20 = changeOver(20);
  let trendScore = 0;
  if (aboveMa20) trendScore += 1; else if (aboveMa20 === false) trendScore -= 1;
  if (aboveMa50) trendScore += 1; else if (aboveMa50 === false) trendScore -= 1;
  trendScore += momentum20 > 0 ? 1 : momentum20 < 0 ? -1 : 0;

  const trendLabel = trendScore >= 2 ? '偏强' : trendScore <= -2 ? '偏弱' : '震荡';

  return {
    sampleDays: series.length,
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
    latestNav: round4(latest),
    r5: round4(changeOver(5)),
    r20: round4(changeOver(20)),
    r60: round4(changeOver(60)),
    volatility: volatility === null ? null : round4(volatility),
    ma20: ma20 === null ? null : round4(ma20),
    ma50: ma50 === null ? null : round4(ma50),
    ma20Rising: ma20 !== null && ma20Prev !== null ? ma20 > ma20Prev : null,
    aboveMa20,
    aboveMa50,
    momentum20: round4(momentum20),
    trendScore,
    trendLabel,
    peakNav: round4(peakNav),
    peakDate,
    lowNav: round4(lowNav),
    lowDate,
    maxDrawdown: round4(maxDrawdown),
    ddFromPeak: round4(ddFromPeak),
  };
}

function emptyStats() {
  return {
    sampleDays: 0, firstDate: null, lastDate: null, latestNav: null,
    r5: 0, r20: 0, r60: 0, volatility: null,
    ma20: null, ma50: null, ma20Rising: null, aboveMa20: null, aboveMa50: null,
    momentum20: 0, trendScore: 0, trendLabel: '数据不足',
    peakNav: null, peakDate: null, lowNav: null, lowDate: null,
    maxDrawdown: 0, ddFromPeak: 0,
  };
}

/** 自动判断这笔该拿长线还是做波段（用户可手动覆盖） */
function inferStrategy(input = {}) {
  const text = `${input.type || ''} ${input.category || ''} ${input.name || ''}`;
  const vol = Number(input.volatility);

  if (LONG_KEYWORDS.some((word) => text.includes(word))) {
    return { strategy: 'long', reason: '债券/指数类基金本来就是长线工具，频繁买卖只会多交手续费' };
  }
  const theme = THEME_KEYWORDS.find((word) => text.includes(word));
  if (theme) {
    return { strategy: 'swing', reason: `「${theme}」是行业主题，涨跌都猛，适合设好线做波段，破位就走` };
  }
  if (Number.isFinite(vol) && vol >= RULES.volatilitySwing) {
    return { strategy: 'swing', reason: `年化波动约 ${(vol * 100).toFixed(0)}%，波动偏大，建议波段操作+严格止损` };
  }
  return { strategy: 'long', reason: '波动不大、没有明显主题属性，按长线持有更省心' };
}

/**
 * 单笔持仓的决策。
 * position 取自 portfolioService 的返回；stats 来自 computeStats。
 */
function decide(input = {}) {
  const position = input.position || {};
  const stats = input.stats || emptyStats();
  const strategy = input.strategy === 'long' || input.strategy === 'swing' ? input.strategy : inferStrategy({ ...position, volatility: stats.volatility }).strategy;
  const strategyReason = input.strategyReason || inferStrategy({ ...position, volatility: stats.volatility }).reason;
  const marketChange = Number(input.marketChange || 0); // 大盘涨跌幅
  const hasPendingAction = Boolean(input.hasPendingAction); // 是否已有待办操作

  const profit = position.profit || {};
  const realRate = Number(profit.realRate || 0);
  const realPct = round2(realRate * 100);
  const targetPct = Number(position.targetProfit || 0) * 100;
  const stopPct = Number(position.stopLoss || 0) * 100;
  const holdDays = Number(profit.holdDays || 0);
  const feeOpt = (profit.redemption && profit.redemption.optimization) || {};
  const currentValue = Number(profit.currentValue || 0);
  const shares = Number(profit.shares || 0);
  const buyAmount = Number(profit.principal || position.buyAmount || 0);
  const redemptionRate = Number(profit.fees?.redemptionRate || 0);
  const ddPct = round2(stats.ddFromPeak * 100);
  const fundGrowth = Number(position.growthRate || 0); // 基金当日涨跌幅

  const stopNav = shares > 0 ? round4(buyAmount * (1 - stopPct / 100) / shares) : null;
  const targetNav = shares > 0 ? round4(buyAmount * (1 + targetPct / 100) / shares) : null;

  const reasons = [];
  if (stats.sampleDays >= RULES.minSamples) {
    reasons.push({
      label: '趋势',
      detail: `近 20 日 ${signed(stats.r20 * 100)}%，${stats.aboveMa20 ? '站上' : '跌破'} 20 日均线（${stats.ma20 ?? '—'}），整体${stats.trendLabel}`,
    });
    reasons.push({
      label: '位置',
      detail: ddPct <= -0.5
        ? `距买入后最高净值回撤 ${Math.abs(ddPct).toFixed(2)}%（高点 ${stats.peakNav}，${stats.peakDate}）`
        : `仍在买入后高点附近（${stats.peakNav ?? '—'}），没有明显回撤`,
    });
  } else {
    reasons.push({ label: '样本', detail: `只有 ${stats.sampleDays} 个交易日的历史净值，先攒够 12 天再看趋势更准` });
  }
  reasons.push({
    label: '费率',
    detail: redemptionRate > 0
      ? `现在赎回费率 ${(redemptionRate * 100).toFixed(2)}%，${feeOpt.text || ''}`
      : '当前赎回费率为 0，卖出成本只有市值波动本身',
  });
  reasons.push({
    label: '纪律线',
    detail: `止盈线 +${targetPct.toFixed(0)}%（净值 ${targetNav ?? '—'}），止损线 -${stopPct.toFixed(0)}%（净值 ${stopNav ?? '—'}），当前 ${signed(realPct)}%`,
  });
  if (holdDays < 7 && Math.abs(realPct) > 5) {
    reasons.push({
      label: '数据核对',
      detail: `才持有 ${holdDays} 天，真实盈亏却已经 ${signed(realPct)}%，和买入净值对不上；先核对「买入日期 / 买入净值」是否填错，数据不准时下面所有线都会偏`,
    });
  }

  const base = {
    strategy,
    strategyLabel: strategy === 'long' ? '长线' : '波段',
    strategyReason,
    stats,
    triggers: [],
    reasons,
    navStop: stopNav,
    navTarget: targetNav,
  };

  // 0) 价格拿不到 → 只观察
  if (position.priced === false) {
    return finalize(base, 'watch', '先观察', 'info', 0,
      '净值没取到，今天不构成任何操作依据',
      '净值抓取失败，等数据恢复再看；如果连续两天失败，检查代码或手动同步。');
  }

  // 1) 样本太少 → 观察
  if (stats.sampleDays < RULES.minSamples) {
    return finalize(base, 'watch', '先观察', 'info', 0,
      '新持仓，历史太短，先别急着判断',
      `持有 ${holdDays} 天，净值样本只有 ${stats.sampleDays} 天。先放 12 个交易日，等均线有意义了再决定。`);
  }

  // 2) 触发止损
  if (realPct <= -stopPct && stopPct > 0) {
    const canWait = feeOpt.worthWaiting && Number(feeOpt.daysToWait || 0) > 0 && Number(feeOpt.daysToWait) <= RULES.feeWaitMaxDays
      && Number(feeOpt.savedAmount || 0) >= currentValue * RULES.feeWorthSaving;
    if (canWait) {
      const sellDate = addDays(position.navDate || input.today, Number(feeOpt.daysToWait));
      return finalize(base, 'wait-fee', `等 ${feeOpt.daysToWait} 天再卖`, 'warn', 2,
        `已经跌破止损线，但再等 ${feeOpt.daysToWait} 天费率会降到 ${(Number(feeOpt.nextTierRate || 0) * 100).toFixed(2)}%，能多留 ${feeOpt.savedAmount} 元`,
        `到 ${sellDate} 之后按纪律卖出，不要再往后拖。等待期间如果继续下跌，直接走，不等费率。`);
    }
    return finalize(base, 'exit', '止损离场', 'danger', 3,
      `已跌破止损线（${signed(realPct)}% ≤ -${stopPct.toFixed(0)}%），按纪律卖出`,
      `今天先卖一半（约 ${round2(currentValue / 2)} 元），剩下的一半明天再卖；不要因为"再等等会回来"而扛单。`);
  }

  // 2.5) 刚买入：赎回费还在 1.5% 档，这时候动只会白交手续费
  if (holdDays < 7 && redemptionRate >= 0.01 && realPct < targetPct) {
    const feeIfSell = round2(currentValue * redemptionRate);
    return finalize(base, 'watch', `刚买入 ${holdDays} 天，先别动`, 'info', 0,
      `持有不满 7 天，现在赎回要交 ${(redemptionRate * 100).toFixed(2)}% 手续费（约 ${feeIfSell} 元）`,
      `${addDays(position.buyDate, 7)} 起费率就降到下一档，到那天再判断更划算；这几天只看不动。`);
  }

  // 3) 触发止盈
  if (realPct >= targetPct && targetPct > 0) {
    if (strategy === 'long' && stats.trendScore >= 1) {
      return finalize(base, 'take-profit', '止盈一半，剩下继续拿', 'good', 2,
        `到止盈线了（${signed(realPct)}%），但趋势还在，别一次卖光`,
        `先卖一半锁定利润（约 ${round2(currentValue / 2)} 元），剩下一半把止盈线上调到 +${(targetPct + 10).toFixed(0)}%，或跌破 20 日均线（${stats.ma20 ?? '—'}）再走。`);
    }
    return finalize(base, 'take-profit', '分批止盈', 'warn', 2,
      `到止盈线了（${signed(realPct)}%），且趋势不强，建议落袋`,
      `今天先卖一半（约 ${round2(currentValue / 2)} 元），剩下一半若 3 个交易日内跌破 ${stats.ma20 ?? stopNav ?? '20 日均线'} 就全部卖完。`);
  }

  // 4) 波段策略 + 趋势走弱
  if (strategy === 'swing' && stats.trendScore <= -1) {
    // 大盘环境判断：如果大盘大跌 > 2%，且基金跌幅 < 大盘，说明相对抗跌
    const isMarketPanic = marketChange < RULES.marketPanicPct * 1.33; // -2%
    const isRelativeStrong = fundGrowth > marketChange && fundGrowth > -0.02;
    
    if (isMarketPanic && isRelativeStrong && !hasPendingAction) {
      return finalize(base, 'hold', '大盘大跌，你这只相对抗跌', 'good', 0,
        `今天大盘跌 ${signed(marketChange * 100)}%，你的基金跌 ${signed(fundGrowth * 100)}%，属于抗跌`,
        `系统性下跌时，相对强的品种别急着卖；等大盘企稳后再看，跌破 20 日均线 ${stats.ma20 ?? '—'} 再考虑减仓。`);
    }
    
    const exit = stats.aboveMa20 === false && stats.aboveMa50 === false && stats.r20 < 0;
    return finalize(base, exit ? 'trim' : 'reduce-risk', exit ? '减仓一半' : '准备减仓', 'warn', exit ? 2 : 1,
      exit
        ? `波段仓位跌破 20/50 日均线，趋势转弱（近 20 日 ${signed(stats.r20 * 100)}%）`
        : `波段仓位开始走弱（近 20 日 ${signed(stats.r20 * 100)}%），先减一点`,
      exit
        ? `按波段纪律减一半（约 ${round2(currentValue / 2)} 元）；剩下的一半跌破 ${stopNav ?? '止损价'} 全部清掉。`
        : `先不动，把止损价上移到 ${round4((position.currentNav || 0) * 0.97)}（现价下 3%），跌破就走。`);
  }

  // 5) 回撤过深
  if (ddPct <= -RULES.drawdownWarn * 100 && stats.trendScore <= 0) {
    return finalize(base, 'trim', '减仓一半', 'warn', 2,
      `从买入后高点回撤 ${Math.abs(ddPct).toFixed(2)}%，动能也转弱了`,
      `先减一半（约 ${round2(currentValue / 2)} 元），剩下的看 20 日均线 ${stats.ma20 ?? '—'} 能不能重新站上；站不上就清。`);
  }

  // 6) 长线浮亏但趋势没坏 → 拿住
  if (strategy === 'long' && realPct < 0 && stats.trendScore >= 0) {
    return finalize(base, 'hold', '继续拿着，别补仓也别割', 'good', 0,
      `浮亏 ${signed(realPct)}%，但趋势没坏，长线仓位不需要动作`,
      `长线看的是 1-3 年，不因为几个点的浮亏卖出；真要继续跌到 ${stopNav ?? '止损价'} 再按纪律处理。`);
  }

  // 7) 默认：持有
  const feeHint = feeOpt.worthWaiting && Number(feeOpt.daysToWait || 0) <= 10
    ? `顺便说一句：再拿 ${feeOpt.daysToWait} 天赎回费会降一档，真打算卖可以等到那天。`
    : '';
  if (strategy === 'swing') {
    return finalize(base, 'hold', '继续拿着，但盯住线', 'good', 0,
      `波段仓位趋势还在（近 20 日 ${signed(stats.r20 * 100)}%，${stats.trendLabel}）`,
      `跌破 20 日均线 ${stats.ma20 ?? '—'} 就减仓，跌破 ${stopNav ?? '止损价'} 就清；没破之前不用天天看。${feeHint}`);
  }
  return finalize(base, 'hold', '什么都不用做', 'good', 0,
    `长线仓位，趋势${stats.trendLabel}，没有触发任何纪律线`,
    `这类仓位一年看几次就够了；跌到 ${stopNav ?? '止损价'} 或涨到 ${targetNav ?? '止盈价'} 再说。${feeHint}`);
}

function finalize(base, verdict, verdictLabel, tone, urgency, headline, action) {
  const triggers = [];
  if (base.navStop) triggers.push({ label: '跌破就减仓', value: base.navStop, note: '对应止损线' });
  if (base.navTarget) triggers.push({ label: '涨到就止盈', value: base.navTarget, note: '对应止盈线' });
  if (base.stats?.ma20 && base.strategy === 'swing') triggers.push({ label: '20 日均线', value: base.stats.ma20, note: '跌破视为波段走弱' });
  return {
    strategy: base.strategy,
    strategyLabel: base.strategyLabel,
    strategyReason: base.strategyReason,
    verdict,
    verdictLabel,
    tone,
    urgency,
    headline,
    action,
    triggers,
    reasons: base.reasons,
    stats: base.stats,
  };
}

/** 组合层面：今天到底要不要动手 */
function buildPlan(input = {}) {
  const adviceList = input.adviceList || [];
  const positions = input.positions || [];
  const summary = input.summary || {};
  const market = input.market || {};

  if (positions.length === 0) {
    return {
      tone: 'info',
      headline: '还没有持仓，先把第一笔加进来',
      subline: '加完之后，这里会直接告诉你：该拿长线还是波段、什么时候该卖。',
      actions: [],
      flags: [],
      stats: { hold: 0, watch: 0, risk: 0 },
    };
  }

  const actions = adviceList
    .filter((item) => item.urgency >= 1)
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 4)
    .map((item) => ({
      code: item.code,
      name: item.name,
      verdict: item.verdict,
      verdictLabel: item.verdictLabel,
      tone: item.tone,
      headline: item.headline,
      action: item.action,
      urgency: item.urgency,
    }));

  const urgent = adviceList.filter((item) => item.urgency >= 2);
  const holds = adviceList.filter((item) => item.verdict === 'hold').length;
  const watches = adviceList.filter((item) => item.verdict === 'watch').length;

  let tone = 'good';
  let headline;
  let subline;
  if (urgent.length > 0) {
    tone = urgent.some((item) => item.tone === 'danger') ? 'danger' : 'warn';
    headline = `今天有 ${urgent.length} 笔需要处理：${urgent.map((item) => `${item.name}${item.verdictLabel}`).join('、')}`;
    subline = `其余 ${holds} 笔保持原样，不需要天天盯。`;
  } else if (actions.length > 0) {
    tone = 'info';
    headline = `今天不用动手，有 ${actions.length} 件事提前知道就行`;
    subline = actions.map((item) => `${item.name}：${item.headline}`).join('；');
  } else {
    tone = 'good';
    headline = '今天什么都不用做';
    subline = positions.length === 1
      ? `这 1 笔在轨道内（${adviceList[0] ? adviceList[0].headline : '趋势正常'}），明天再看一眼就行。`
      : `${holds} 笔都在纪律线内，没有触发任何买卖条件。`;
  }

  const flags = buildFlags({ positions, summary, market, adviceList });
  return { tone, headline, subline, actions, flags, stats: { hold: holds, watch: watches, risk: urgent.length } };
}

function buildFlags({ positions, summary, market, adviceList }) {
  const flags = [];

  if (market.indices && market.indices.length) {
    const main = market.indices[0];
    if (Number(main.pct) <= RULES.marketPanicPct) {
      flags.push({
        level: 'info',
        title: `大盘${main.pct <= -2.5 ? '大跌' : '回调'} ${main.pct.toFixed(2)}%`,
        text: '这是系统性下跌，不是你的基金出了问题；没有触线就别在恐慌里割肉，也别急着抄底。',
      });
    }
  }

  if (positions.length >= 3 && Number(summary.topWeight) >= 0.4) {
    flags.push({
      level: 'warn',
      title: '仓位过于集中',
      text: `${summary.topFund} 占总市值 ${(Number(summary.topWeight) * 100).toFixed(0)}%，它一个人跌 10%，组合就跌 ${(Number(summary.topWeight) * 10).toFixed(1)}%。`,
    });
  }

  const themeGroups = new Map();
  for (const position of positions) {
    const theme = THEME_KEYWORDS.find((word) => String(position.name || '').includes(word));
    if (!theme) continue;
    const weight = Number(position.profit?.currentValue || 0);
    themeGroups.set(theme, (themeGroups.get(theme) || 0) + weight);
  }
  const totalValue = Number(summary.value || 0);
  for (const [theme, weight] of themeGroups) {
    if (totalValue > 0 && weight / totalValue >= 0.5 && themeGroups.size >= 1) {
      flags.push({
        level: 'warn',
        title: `同一主题占比 ${((weight / totalValue) * 100).toFixed(0)}%`,
        text: `多笔持仓都押在「${theme}」上，涨跌会同步放大；条件允许时换一个不相关的方向分散。`,
      });
      break;
    }
  }

  const stale = positions.filter((position) => position.stale).length;
  if (stale > 0) {
    flags.push({ level: 'warn', title: `${stale} 只基金净值未更新`, text: '结论基于历史净值，等同步成功后再看一次建议。' });
  }

  const losing = adviceList.filter((item) => Number(item.realPct) < 0);
  if (positions.length >= 2 && losing.length === positions.length && Number(summary.realRate) <= -0.05) {
    flags.push({
      level: 'info',
      title: `组合整体浮亏 ${(Number(summary.realRate) * 100).toFixed(1)}%`,
      text: '全部持仓都在亏的时候最容易做错决定：先看趋势有没有坏，趋势没坏就别加仓摊平，也别割在地板上。',
    });
  }

  return flags;
}

function signed(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

module.exports = { computeStats, inferStrategy, decide, buildPlan, RULES };
