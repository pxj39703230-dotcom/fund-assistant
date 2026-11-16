'use strict';
/**
 * peer.js —— 基金同类对比（Node 版，与 Python 参考实现同口径）
 *
 * 零依赖：只用 Node 18+ 自带的 fetch。
 * 只负责「取数 + 计算 + 返回纯对象」，不碰你的数据库和缓存，集成成本最低。
 *
 * 用法：
 *   const { buildPeerReport } = require('./peer');
 *   const data = await buildPeerReport('512480');
 *   res.json(data);
 *
 * 缓存建议放在调用方（内存 Map + TTL 6 小时即可，净值是 T+1 的）。
 */

const REFERER = 'https://fund.eastmoney.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CFG = {
  maxPeers: 20,       // 最多拉多少只同类
  gapMs: 180,         // 请求间隔
  minCorr: 0.75,      // 相关性门槛
  overlapMin: 0.5,    // 重仓重叠门槛
  roundTrip: 0.006,   // 换基摩擦成本
  minSpan3y: 2.5,     // 不足 2.5 年不参与 3 年排名
  minSizeYi: 2,       // 规模门槛（亿元）
};

const TOPICS = [
  '半导体', '芯片', '集成电路', '存储', '设备', '材料',
  '医药', '医疗', '生物', '创新药',
  '消费', '食品', '白酒', '家电', '酒', '饮料',
  '新能源', '光伏', '储能', '锂电', '电池', '汽车',
  '军工', '国防', '航空',
  '银行', '证券', '保险', '金融', '地产',
  '科技', '人工智能', '云计算', '通信', '计算机', '软件', '传媒', '游戏',
  '有色', '煤炭', '钢铁', '化工', '能源', '电力', '环保',
  '农业', '养殖', '黄金', '港股', '纳斯达克', '标普', '中概',
  '红利', '价值', '成长', '沪深300', '中证500', '中证1000', '科创', '创业',
  '电子', '建材', '基建', '稀土', '石油', '天然气', '机器人', '智能制造',
  '信息安全', '数字', '教育', '旅游', '零售', '农牧', '恒生', '日经',
];

/* ------------------------------------------------------------------ 工具 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpGet(url, timeoutMs = 15000, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: REFERER, Accept: '*/*' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(600 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** 从 JS 源码里取出一个变量的字面量（括号配对扫描，能处理嵌套和引号） */
function jsVar(text, name) {
  const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=');
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return null;

  if (text[i] !== '[' && text[i] !== '{') {
    const end = text.indexOf(';', i);
    return text.slice(i, end < 0 ? text.length : end).trim().replace(/^["']|["']$/g, '');
  }

  const stack = [];
  let quote = null;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') stack.push(c);
    else if (c === ']' || c === '}') {
      stack.pop();
      if (!stack.length) return text.slice(i, k + 1);
    }
  }
  return null;
}

function safeJson(literal) {
  if (!literal) return null;
  try { return JSON.parse(literal); } catch { return null; }
}

function baseName(name) {
  if (name && name.length > 4 && 'ACEIH'.includes(name.slice(-1)) &&
      !/[0-9]/.test(name.slice(-2, -1))) {
    return name.slice(0, -1);
  }
  return name;
}

function topicsOf(name) {
  name = name || '';
  return TOPICS.filter((w) => name.includes(w));
}

/* ------------------------------------------------------------------ 取数 */

let _listCache = { at: 0, data: null };

async function loadFundList(force = false) {
  if (!force && _listCache.data && Date.now() - _listCache.at < 24 * 3600 * 1000) {
    return _listCache.data;
  }
  const txt = await httpGet('https://fund.eastmoney.com/js/fundcode_search.js?t=' + Date.now());
  const raw = safeJson(jsVar(txt, 'r'));
  if (!Array.isArray(raw)) throw new Error('基金列表解析失败，接口可能已变更');
  const list = raw
    .filter((row) => Array.isArray(row) && row.length >= 4)
    .map((row) => ({ code: row[0], name: row[2], type: row[3] }));
  _listCache = { at: Date.now(), data: list };
  return list;
}

async function loadFund(code) {
  const txt = await httpGet(`https://fund.eastmoney.com/pingzhongdata/${code}.js?t=${Date.now()}`);
  if (!txt.includes('fS_name')) throw new Error(`基金 ${code} 返回异常`);

  const name = jsVar(txt, 'fS_name') || '';

  const navLit = jsVar(txt, 'Data_netWorthTrend');
  const navs = [];
  if (navLit) {
    const re = /\{x:(\d{10,13}),y:(-?[0-9.]+)/g;
    let m;
    while ((m = re.exec(navLit))) navs.push([Number(m[1]), Number(m[2])]);
  }

  const accs = [];
  const accLit = jsVar(txt, 'Data_ACWorthTrend');
  const accArr = safeJson(accLit);
  if (Array.isArray(accArr)) {
    for (const p of accArr) {
      if (Array.isArray(p) && p.length >= 2) accs.push([Number(p[0]), Number(p[1])]);
    }
  }

  // ⚠️ stockCodes 是「6 位代码 + 1 位市场位」的 7 位串，必须截前 6 位
  const rawStocks = safeJson(jsVar(txt, 'stockCodes')) || [];
  const stocks = rawStocks
    .map((s) => String(s))
    .filter((s) => /^\d{6,7}$/.test(s))
    .map((s) => s.slice(0, 6))
    .slice(0, 10);

  let fee = 0;
  for (const key of ['fund_Rate', 'fund_sourceRate']) {
    const v = parseFloat(String(jsVar(txt, key) || '').replace(/"/g, ''));
    if (Number.isFinite(v) && v > 0) { fee = v; break; }
  }

  let size = null;
  const scale = safeJson(jsVar(txt, 'Data_fluctuationScale'));
  if (scale && Array.isArray(scale.series) && scale.series.length) {
    const y = parseFloat(scale.series[scale.series.length - 1].y);
    if (Number.isFinite(y)) size = y;
  }

  // 优先累计净值（含分红复权），没有才回落单位净值
  const series = accs.length && accs.length >= navs.length ? accs : navs;
  return { code, name, navs: series, stocks, fee, size };
}

/* ------------------------------------------------------------------ 指标 */

const DAY = 86400000;

function metrics(series, days) {
  if (!Array.isArray(series) || series.length < 30) return null;
  const end = series[series.length - 1][0];
  const cut = end - days * DAY;
  const win = series.filter((p) => p[0] >= cut && p[1] > 0);
  if (win.length < 30) return null;

  const first = win[0][1];
  const last = win[win.length - 1][1];
  const total = last / first - 1;
  const years = Math.max(0.08, (win[win.length - 1][0] - win[0][0]) / (365.25 * DAY));
  const ann = Math.pow(1 + total, 1 / years) - 1;

  const rets = [];
  for (let i = 1; i < win.length; i++) {
    if (win[i - 1][1] > 0) rets.push(win[i][1] / win[i - 1][1] - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
  const vol = Math.sqrt(varr) * Math.sqrt(252);

  let peak = win[0][1];
  let mdd = 0;
  for (const [, v] of win) {
    if (v > peak) peak = v;
    const d = v / peak - 1;
    if (d < mdd) mdd = d;
  }

  return {
    total, ann, vol, mdd,
    sharpe: vol ? (ann - 0.015) / vol : null,
    span: years,
  };
}

function dailyRets(series) {
  const map = new Map();
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1][1];
    if (prev > 0) map.set(series[i][0], series[i][1] / prev - 1);
  }
  return map;
}

function corrOf(a, b) {
  const keys = [];
  for (const k of a.keys()) if (b.has(k)) keys.push(k);
  if (keys.length < 60) return null;
  const xs = keys.map((k) => a.get(k));
  const ys = keys.map((k) => b.get(k));
  const n = xs.length;
  const mx = xs.reduce((p, c) => p + c, 0) / n;
  const my = ys.reduce((p, c) => p + c, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  if (!vx || !vy) return null;
  return cov / Math.sqrt(vx * vy);
}

/* ------------------------------------------------------------------ 同类池 */

function pickPeers(list, me, limit) {
  const myTopics = topicsOf(me.name);
  const myBase = baseName(me.name);
  const seen = new Set();
  const strict = [];
  const loose = [];

  for (const f of list) {
    if (f.code === me.code) continue;
    const b = baseName(f.name);
    if (b === myBase || seen.has(b)) continue;
    if (f.type !== me.type) continue;
    seen.add(b);
    const t = topicsOf(f.name);
    const share = myTopics.filter((w) => t.includes(w));
    if (myTopics.length && share.length) strict.push({ f, score: share.length });
    else loose.push({ f });
  }

  strict.sort((x, y) => y.score - x.score || x.f.name.length - y.f.name.length);
  const out = strict.slice(0, limit).map((x) => x.f);
  if (out.length < 6) out.push(...loose.slice(0, 6 - out.length).map((x) => x.f));
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ 主流程 */

async function buildPeerReport(code, options = {}) {
  const cfg = { ...CFG, ...options };
  if (!/^\d{6}$/.test(String(code))) throw new Error('基金代码必须是 6 位数字');

  const list = await loadFundList();
  const meta = list.find((f) => f.code === code);
  if (!meta) throw new Error(`基金代码 ${code} 不在列表里`);

  const me = await loadFund(code);
  me.type = meta.type;
  if (!me.name) me.name = meta.name;

  const peers = pickPeers(list, me, cfg.maxPeers);
  const rows = [me];

  for (const p of peers) {
    try {
      const f = await loadFund(p.code);
      f.type = p.type;
      if (!f.name) f.name = p.name;
      if (f.navs && f.navs.length > 60) rows.push(f);
    } catch {
      /* 单只失败跳过 */
    }
    await sleep(cfg.gapMs);
  }

  const meM3 = metrics(me.navs, 365 * 3);
  const meM1 = metrics(me.navs, 365);
  if (!meM3) throw new Error('本基金数据不足（可能成立不满 3 个月）');

  const myRets = dailyRets(me.navs);
  const pool = [];

  for (const f of rows) {
    const m1 = metrics(f.navs, 365);
    const m3 = metrics(f.navs, 365 * 3);
    if (!m3) continue;

    let c = 1;
    if (f.code !== code) {
      c = corrOf(myRets, dailyRets(f.navs));
      if (c == null || c < cfg.minCorr) continue;
    }

    let overlap = 0;
    if (f.code !== code && me.stocks.length) {
      const inter = f.stocks.filter((s) => me.stocks.includes(s)).length;
      const union = me.stocks.length + f.stocks.length - inter;
      overlap = union ? inter / union : 0;
    }

    pool.push({
      code: f.code, name: f.name, fee: f.fee, size: f.size,
      m1y: m1 ? m1.total : null,
      m3y: m3.ann, mdd3y: m3.mdd, vol3y: m3.vol, sharpe3y: m3.sharpe,
      span: m3.span, corr: c, overlap, me: f.code === code,
    });
  }

  const meRow = pool.find((p) => p.me);
  if (!meRow) throw new Error('本基金不在同类池里，数据异常');

  /* 排名：3 年类指标要求历史 >= 2.5 年 */
  function rank(key, useSpan = true) {
    const arr = pool
      .filter((p) => p[key] != null && (!useSpan || key === 'm1y' || p.span >= cfg.minSpan3y))
      .sort((a, b) => b[key] - a[key]);
    const idx = arr.findIndex((p) => p.me);
    return { rank: idx < 0 ? null : idx + 1, n: arr.length };
  }

  const r1 = rank('m1y', false);
  const r3 = rank('m3y');
  const rd = rank('mdd3y');
  const rs = rank('sharpe3y');

  const q = (r) => (r.rank && r.n > 1 ? Math.round(((r.n - r.rank) / (r.n - 1)) * 100) : null);
  const q1 = q(r1), q3 = q(r3), qd = q(rd);

  const band = (v, hi = 67, lo = 33) => (v >= hi ? '高' : v <= lo ? '低' : '中');
  const quadrant = q1 == null || qd == null
    ? '数据不足'
    : `${band(q1)}收益 / ${band(100 - qd)}回撤`;

  const qualifiedOf = (p) => p.span >= cfg.minSpan3y && (!p.size || p.size >= cfg.minSizeYi);

  const alternatives = pool
    .filter((p) => !p.me && p.overlap >= cfg.overlapMin && p.m3y > meRow.m3y)
    .map((p) => {
      const caveats = [];
      if (p.fee && meRow.fee && p.fee - meRow.fee > 0.2) {
        caveats.push(`费率高出 ${(p.fee - meRow.fee).toFixed(2)} 个点`);
      }
      if (p.size && p.size < 5) caveats.push(`规模仅 ${p.size.toFixed(1)} 亿`);
      if (p.mdd3y < meRow.mdd3y) caveats.push(`回撤更大 ${(p.mdd3y * 100).toFixed(1)}%`);
      if (p.span < cfg.minSpan3y) caveats.push('历史不足 3 年');
      return {
        peer: {
          code: p.code, name: p.name, m3y: p.m3y, mdd3y: p.mdd3y,
          fee: p.fee, size: p.size, sharpe3y: p.sharpe3y, corr: p.corr,
        },
        overlap: p.overlap,
        gap: p.m3y - meRow.m3y,
        qualified: qualifiedOf(p),
        caveats,
      };
    })
    .sort((a, b) => (a.qualified === b.qualified ? b.gap - a.gap : a.qualified ? -1 : 1));

  return {
    code,
    name: me.name,
    n: pool.length,
    dropped: rows.length - pool.length,
    as_of: new Date().toISOString().slice(0, 10),
    quadrant,
    quantile: { q1, q3, qd },
    rank: {
      r1: [r1.rank, r1.n],
      r3: [r3.rank, r3.n],
      mdd: [rd.rank, rd.n],
      sharpe: [rs.rank, rs.n],
    },
    me: {
      code, name: me.name, m1y: meRow.m1y, m3y: meRow.m3y,
      mdd3y: meRow.mdd3y, vol3y: meRow.vol3y, sharpe3y: meRow.sharpe3y,
      fee: meRow.fee, size: meRow.size, span: meRow.span,
    },
    peers: pool,
    alternatives,
    short_history: meRow.span < cfg.minSpan3y,
    config: { roundTrip: cfg.roundTrip, minCorr: cfg.minCorr, overlapMin: cfg.overlapMin },
  };
}

module.exports = { buildPeerReport, metrics, corrOf, jsVar, CFG };
