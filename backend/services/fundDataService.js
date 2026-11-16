'use strict';

const axios = require('axios');
const db = require('../config/database');
const config = require('../config/env');
const { createLogger } = require('../utils/logger');
const { sleep } = require('../utils/asyncPool');
const { todayString, addDays, diffDays } = require('../utils/date');
const { DEFAULT_REDEMPTION_TIERS } = require('../domain/rates');

const log = createLogger('fund-data');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const http = axios.create({
  timeout: config.fetchTimeoutMs,
  maxRedirects: 3,
  validateStatus: (status) => status >= 200 && status < 500,
  headers: {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
});

function decodeGbk(buffer) {
  try {
    return new TextDecoder('gbk').decode(Buffer.from(buffer));
  } catch (error) {
    return Buffer.from(buffer).toString('utf8');
  }
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePercent(text) {
  const match = String(text || '').match(/([\d.]+)\s*%/);
  return match ? Number(match[1]) / 100 : null;
}

function toDateOnly(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function sanitizeQuote(raw) {
  const nav = Number(raw.netValue);
  if (!Number.isFinite(nav) || nav <= 0 || nav > 1000) return null;
  const growth = Number.isFinite(Number(raw.growthRate)) ? Number(raw.growthRate) : null;
  if (growth !== null && Math.abs(growth) > 30) return null;
  return {
    code: String(raw.code || '').padStart(6, '0'),
    name: (raw.name || '').trim() || null,
    netValue: nav,
    accumulatedValue: Number.isFinite(Number(raw.accumulatedValue)) ? Number(raw.accumulatedValue) : null,
    growthRate: growth,
    navDate: toDateOnly(raw.navDate) || todayString(),
    source: raw.source || 'unknown',
  };
}

/** 页面里同一个词可能先出现在导航或注释里，必须定位"跟着表格"的那一处 */
function findTableSection(html, keyword) {
  let index = html.indexOf(keyword);
  while (index !== -1) {
    if (/<table/i.test(html.slice(index, index + 500))) return index;
    index = html.indexOf(keyword, index + 1);
  }
  return -1;
}

class FundDataService {
  constructor() {
    this.cache = new Map();
    this.inflight = new Map();
    this.historyCache = new Map();
  }

  /**
   * 获取基金最新净值。
   * 顺序：内存缓存 → 多数据源 → 本地上次有效净值（标记 stale）。
   * 同一基金的并发请求会合并成一个，避免首页三个接口各拉一次。
   */
  async getQuote(code, options = {}) {
    const code6 = String(code || '').trim();
    if (!/^\d{6}$/.test(code6)) {
      const error = new Error('基金代码必须是 6 位数字');
      error.status = 400;
      throw error;
    }

    if (!options.force) {
      const cached = this.cache.get(code6);
      if (cached && cached.expiresAt > Date.now()) return { ...cached.data, fromCache: true };
    }

    if (this.inflight.has(code6)) return this.inflight.get(code6);

    const task = (async () => {
      const errors = [];
      for (const source of this._sources()) {
        try {
          const quote = await this._withRetry(() => source.fetch(code6), source.name);
          const clean = quote && sanitizeQuote(quote);
          if (clean) {
            this._remember(clean);
            await this._persist(clean).catch(() => {});
            return clean;
          }
        } catch (error) {
          errors.push(`${source.name}: ${error.message}`);
          log.debug(`${source.name} 获取 ${code6} 失败: ${error.message}`);
        }
      }

      const fallback = this._lastKnownQuote(code6);
      if (fallback) {
        log.warn(`${code6} 所有实时源不可用，回退到本地净值 ${fallback.netValue}（${fallback.navDate}）`);
        return fallback;
      }

      const error = new Error(`基金 ${code6} 净值获取失败：${errors.join(' | ') || '无可用数据源'}`);
      error.status = 502;
      throw error;
    })();

    this.inflight.set(code6, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(code6);
    }
  }

  /** 兼容旧调用名 */
  getFundData(code, options) {
    return this.getQuote(code, options);
  }

  _sources() {
    return [
      { name: 'eastmoney-lsjz', fetch: (code) => this._fromEastmoneyHistory(code) },
      { name: 'eastmoney-mobile', fetch: (code) => this._fromEastmoneyMobile(code) },
      { name: 'sina', fetch: (code) => this._fromSina(code) },
      { name: 'tencent', fetch: (code) => this._fromTencent(code) },
    ];
  }

  async _withRetry(fn, label) {
    let lastError;
    for (let attempt = 0; attempt <= config.fetchRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < config.fetchRetries) {
          log.debug(`${label} 第 ${attempt + 1} 次失败，${300 * (attempt + 1)}ms 后重试`);
          await sleep(300 * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  // ---------- 数据源 ----------

  /** 东财历史净值接口：JSON，字段最全（单位净值、累计净值、日涨跌幅） */
  async _fromEastmoneyHistory(code) {
    const response = await http.get('https://api.fund.eastmoney.com/f10/lsjz', {
      params: { fundCode: code, pageIndex: 1, pageSize: 2, _: Date.now() },
      headers: { Referer: 'https://fundf10.eastmoney.com/' },
    });

    const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    const rows = body && body.Data && body.Data.LSJZList;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('返回数据为空');

    const row = rows[0];
    return {
      code,
      name: null,
      netValue: row.DWJZ,
      accumulatedValue: row.LJJZ,
      growthRate: row.JZZZL === '' || row.JZZZL === null ? null : row.JZZZL,
      navDate: row.FSRQ,
      source: 'eastmoney-lsjz',
    };
  }

  /** 东财手机端基础信息：含名称、类型、公司、规模、优惠申购费率 */
  async _fromEastmoneyMobile(code) {
    const response = await http.get('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation', {
      params: { FCODE: code, deviceid: 'fund-assistant', plat: 'Android', product: 'EFund', version: '6.2.8' },
    });

    const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    const data = body && body.Datas;
    if (!data || !data.DWJZ) throw new Error('返回数据为空');

    this._rememberProfile(code, {
      name: data.SHORTNAME,
      type: data.FTYPE,
      company: data.JJGS,
      purchaseRate: parsePercent(data.RATE) ?? parsePercent(data.SOURCERATE),
      scale: Number(data.ENDNAV) / 1e8 || null,
      establishedDate: toDateOnly(data.ESTABDATE),
    });

    return {
      code,
      name: data.SHORTNAME,
      netValue: data.DWJZ,
      accumulatedValue: data.LJJZ,
      growthRate: data.RZDF,
      navDate: data.FSRQ,
      source: 'eastmoney-mobile',
    };
  }

  /** 新浪行情：GBK 编码，作为第二备份源 */
  async _fromSina(code) {
    const response = await http.get('https://hq.sinajs.cn/list=f_' + code, {
      headers: { Referer: 'https://finance.sina.com.cn/' },
      responseType: 'arraybuffer',
    });
    const text = decodeGbk(response.data);
    const match = text.match(/="(.+?)"/);
    if (!match) throw new Error('行情格式异常');
    const fields = match[1].split(',');
    if (fields.length < 5) throw new Error('行情字段不足');

    const nav = Number(fields[1]);
    const prevNav = Number(fields[3]);
    const growth = prevNav > 0 ? ((nav - prevNav) / prevNav) * 100 : null;

    return {
      code,
      name: fields[0],
      netValue: nav,
      accumulatedValue: fields[2],
      growthRate: growth === null ? null : Number(growth.toFixed(4)),
      navDate: fields[4],
      source: 'sina',
    };
  }

  /** 腾讯行情：GBK 编码，作为第三备份源 */
  async _fromTencent(code) {
    const response = await http.get('https://qt.gtimg.cn/q=jj' + code, { responseType: 'arraybuffer' });
    const text = decodeGbk(response.data);
    const match = text.match(/="(.+?)"/);
    if (!match) throw new Error('行情格式异常');
    const fields = match[1].split('~');
    if (fields.length < 9) throw new Error('行情字段不足');

    return {
      code,
      name: fields[1],
      netValue: fields[5],
      accumulatedValue: fields[6],
      growthRate: fields[7],
      navDate: fields[8],
      source: 'tencent',
    };
  }

  // ---------- 缓存与持久化 ----------

  _remember(quote) {
    const tradeDate = quote.navDate || todayString();
    // 净值日期越新，缓存有效期越短（盘中会变；收盘后基本不动）
    const fresh = diffDays(tradeDate, todayString()) <= 0;
    const ttl = fresh ? config.quoteCacheMs : Math.max(config.quoteCacheMs, 30 * 60 * 1000);
    this.cache.set(quote.code, { data: quote, expiresAt: Date.now() + ttl });
  }

  _rememberProfile(code, profile) {
    const patch = {};
    for (const [key, value] of Object.entries(profile)) {
      if (value !== null && value !== undefined && value !== '') patch[key] = value;
    }
    if (Object.keys(patch).length) this._persistProfile(code, patch);
  }

  async _persist(quote) {
    const exists = db.get('SELECT code FROM funds WHERE code = ?', [quote.code]);
    if (!exists) {
      db.run('INSERT OR IGNORE INTO funds (code, name) VALUES (?, ?)', [quote.code, quote.name || quote.code]);
    }
    const fields = ['last_net_value = ?', 'last_net_date = ?'];
    const params = [quote.netValue, quote.navDate];
    if (quote.name) {
      fields.push('name = ?');
      params.push(quote.name);
    }
    params.push(quote.code);
    db.run(`UPDATE funds SET ${fields.join(', ')} WHERE code = ?`, params);

    if (quote.navDate) {
      db.run(
        `INSERT INTO fund_net_values (fund_code, date, net_value, accumulated_value, growth_rate, data_source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(fund_code, date) DO UPDATE SET
           net_value = excluded.net_value,
           accumulated_value = COALESCE(excluded.accumulated_value, fund_net_values.accumulated_value),
           growth_rate = COALESCE(excluded.growth_rate, fund_net_values.growth_rate),
           data_source = excluded.data_source`,
        [quote.code, quote.navDate, quote.netValue, quote.accumulatedValue ?? null, quote.growthRate ?? null, quote.source],
      );
    }
  }

  _persistProfile(code, patch) {
    const exists = db.get('SELECT code FROM funds WHERE code = ?', [code]);
    if (!exists) db.run('INSERT OR IGNORE INTO funds (code, name) VALUES (?, ?)', [code, code]);
    const map = {
      name: 'name',
      type: 'type',
      company: 'company',
      purchaseRate: 'purchase_rate',
      scale: 'scale',
      establishedDate: 'established_date',
    };
    const fields = [];
    const params = [];
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] === undefined) continue;
      fields.push(`${column} = ?`);
      params.push(patch[key]);
    }
    if (!fields.length) return;
    params.push(code);
    db.run(`UPDATE funds SET ${fields.join(', ')} WHERE code = ?`, params);
  }

  _lastKnownQuote(code) {
    const fund = db.get('SELECT * FROM funds WHERE code = ?', [code]);
    const row = fund && fund.last_net_value
      ? { net_value: fund.last_net_value, date: fund.last_net_date }
      : db.get('SELECT net_value, date, growth_rate FROM fund_net_values WHERE fund_code = ? ORDER BY date DESC LIMIT 1', [code]);

    if (!row || !row.net_value) return null;

    return {
      code,
      name: fund?.name || null,
      netValue: Number(row.net_value),
      accumulatedValue: null,
      growthRate: row.growth_rate === undefined || row.growth_rate === null ? null : Number(row.growth_rate),
      navDate: row.date || fund.last_net_date,
      source: 'local-cache',
      isStale: true,
      staleDays: diffDays(row.date || fund.last_net_date || todayString(), todayString()),
    };
  }

  // ---------- 基金详情（费率） ----------

  async getFundDetail(code, options = {}) {
    const code6 = String(code || '').trim();
    if (!/^\d{6}$/.test(code6)) throw Object.assign(new Error('基金代码必须是 6 位数字'), { status: 400 });

    const cached = this._readDetailFromDb(code6);
    if (cached && !options.force && cached.fresh) return cached.detail;

    const errors = [];
    let profile = null;
    let fees = null;

    try {
      // 手机接口能拿到名称/类型/公司/规模/优惠申购费率
      await this.getQuote(code6).catch(() => {});
    } catch (error) {
      errors.push(error.message);
    }

    for (const url of [`https://fundf10.eastmoney.com/jbgk_${code6}.html`, `https://fundf10.eastmoney.com/jjfl_${code6}.html`]) {
      try {
        const response = await http.get(url, { headers: { Referer: 'https://fundf10.eastmoney.com/' } });
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const parsed = this._parseFundPage(html);
        if (url.includes('jbgk')) profile = { ...(profile || {}), ...parsed };
        else fees = parsed;
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    const stored = this._readDetailFromDb(code6);
    const detail = this._mergeDetail(code6, stored?.detail, profile, fees);
    if (!detail.name && !detail.managementRate && !detail.redemptionTiers) {
      throw Object.assign(new Error(`基金 ${code6} 详情获取失败：${errors.join(' | ') || '无可用数据源'}`), { status: 502 });
    }

    this._saveDetail(detail);
    return detail;
  }

  isDetailFresh(code) {
    const row = db.get('SELECT detail_updated_at, redemption_tiers FROM funds WHERE code = ?', [code]);
    if (!row || !row.detail_updated_at) return false;
    // 只有日期没有阶梯数据，说明是旧版本留下的半成品，必须重抓
    if (!row.redemption_tiers) return false;
    return diffDays(row.detail_updated_at.slice(0, 10), todayString()) < config.detailCacheDays;
  }

  _readDetailFromDb(code) {
    const fund = db.get('SELECT * FROM funds WHERE code = ?', [code]);
    if (!fund) return null;
    const fresh = this.isDetailFresh(code);
    const detail = {
      code: fund.code,
      name: fund.name,
      type: fund.type,
      company: fund.company,
      managementRate: fund.management_rate,
      custodyRate: fund.custody_rate,
      salesServiceRate: fund.sales_service_rate,
      purchaseRate: fund.purchase_rate,
      purchaseTiers: safeJson(fund.purchase_tiers) || [],
      redemptionTiers: safeJson(fund.redemption_tiers) || null,
      scale: fund.scale,
      establishedDate: fund.established_date,
      detailUpdatedAt: fund.detail_updated_at,
    };
    const hasFees = detail.managementRate !== null || detail.redemptionTiers !== null;
    return { detail, fresh, hasFees };
  }

  _mergeDetail(code, previous, profile, fees) {
    const base = previous || {};
    const merged = {
      code,
      name: profile?.name || base.name || null,
      type: profile?.type || base.type || null,
      company: profile?.company || base.company || null,
      // 概况页(jbgk)的管理费/托管费/优惠申购费率才可信；费率页(jjfl)只负责赎回阶梯
      managementRate: pickRate(profile?.managementRate, pickRate(fees?.managementRate, base.managementRate)),
      custodyRate: pickRate(profile?.custodyRate, pickRate(fees?.custodyRate, base.custodyRate)),
      salesServiceRate: pickRate(profile?.salesServiceRate, pickRate(fees?.salesServiceRate, base.salesServiceRate)),
      purchaseRate: pickRate(profile?.purchaseRate, pickRate(fees?.purchaseRate, base.purchaseRate)),
      purchaseTiers: profile?.purchaseTiers?.length
        ? profile.purchaseTiers
        : (fees?.purchaseTiers?.length ? fees.purchaseTiers : (base.purchaseTiers || [])),
      redemptionTiers: fees?.redemptionTiers?.length ? fees.redemptionTiers : (base.redemptionTiers || null),
      scale: profile?.scale ?? base.scale ?? null,
      establishedDate: profile?.establishedDate || base.establishedDate || null,
      detailUpdatedAt: todayString(),
    };
    return merged;
  }

  _saveDetail(detail) {
    const exists = db.get('SELECT code FROM funds WHERE code = ?', [detail.code]);
    if (!exists) db.run('INSERT OR IGNORE INTO funds (code, name) VALUES (?, ?)', [detail.code, detail.name || detail.code]);
    db.run(
      `UPDATE funds SET
         name = COALESCE(?, name),
         type = COALESCE(?, type),
         company = COALESCE(?, company),
         management_rate = COALESCE(?, management_rate),
         custody_rate = COALESCE(?, custody_rate),
         sales_service_rate = COALESCE(?, sales_service_rate),
         purchase_rate = COALESCE(?, purchase_rate),
         purchase_tiers = COALESCE(?, purchase_tiers),
         redemption_tiers = COALESCE(?, redemption_tiers),
         scale = COALESCE(?, scale),
         established_date = COALESCE(?, established_date),
         detail_updated_at = ?,
         updated_at = datetime('now', 'localtime')
       WHERE code = ?`,
      [
        detail.name ?? null,
        detail.type ?? null,
        detail.company ?? null,
        detail.managementRate ?? null,
        detail.custodyRate ?? null,
        detail.salesServiceRate ?? null,
        detail.purchaseRate ?? null,
        detail.purchaseTiers?.length ? JSON.stringify(detail.purchaseTiers) : null,
        detail.redemptionTiers?.length ? JSON.stringify(detail.redemptionTiers) : null,
        detail.scale ?? null,
        detail.establishedDate ?? null,
        detail.detailUpdatedAt,
        detail.code,
      ],
    );
  }

  /** 解析 jbgk（概况/费率）+ jjfl（赎回阶梯）页面，两页结构一致，合在一起解析 */
  _parseFundPage(html) {
    const result = {};

    const nameMatch = html.match(/<th>基金简称<\/th><td>([^<]+)</);
    if (nameMatch) result.name = nameMatch[1].trim();

    const typeMatch = html.match(/<th>基金类型<\/th><td>(?:<[^>]*>)*([^<）]+)/);
    if (typeMatch) result.type = stripTags(typeMatch[1]);

    const companyMatch = html.match(/<th>基金管理人<\/th><td>(?:<a[^>]*>)?([^<]+)</);
    if (companyMatch) result.company = stripTags(companyMatch[1]);

    const managerMatch = html.match(/<th>基金经理人<\/th><td>(?:<a[^>]*>)?([^<]+)</);
    if (managerMatch) result.managerName = stripTags(managerMatch[1]);

    const mgmt = html.match(/<th>管理费率<\/th><td[^>]*>([\d.]+)%/);
    if (mgmt) result.managementRate = Number(mgmt[1]) / 100;

    const custody = html.match(/<th>托管费率<\/th><td[^>]*>([\d.]+)%/);
    if (custody) result.custodyRate = Number(custody[1]) / 100;

    const sales = html.match(/<th>销售服务费率<\/th><td[^>]*>([\d.]+)%/);
    if (sales) result.salesServiceRate = Number(sales[1]) / 100;

    const discountRate = html.match(/天天基金优惠费率[^%]*?([\d.]+)%/);
    const purchaseRate = discountRate || html.match(/<th>最高申购费率<\/th><td[^>]*>[^%]*?([\d.]+)%/);
    if (purchaseRate) result.purchaseRate = Number(purchaseRate[1]) / 100;

    const scaleMatch = html.match(/净资产规模<\/th><td[^>]*>([\d.]+)亿元/);
    if (scaleMatch) result.scale = Number(scaleMatch[1]);

    const establishMatch = html.match(/成立日期\/规模<\/th><td>(\d{4})年(\d{2})月(\d{2})日/);
    if (establishMatch) result.establishedDate = `${establishMatch[1]}-${establishMatch[2]}-${establishMatch[3]}`;

    result.purchaseTiers = this._parsePurchaseTiers(html);
    result.redemptionTiers = this._parseRedemptionTiers(html);
    return result;
  }

  _parseRedemptionTiers(html) {
    const tiers = [];
    // 只取"赎回费率"表格所在段落，避免把认购/申购档位混进来
    const start = findTableSection(html, '赎回费率');
    const section = start >= 0 ? html.slice(start) : html;
    const regex = /<td[^>]*>([^<]*?[天日][^<]*?)<\/td>\s*<td[^>]*>([\d.]+)%/g;
    regex.lastIndex = 0;
    const scoped = section || html;
    let match;
    while ((match = regex.exec(scoped)) !== null) {
      const label = stripTags(match[1]);
      const rate = Number(match[2]) / 100;
      const min = label.match(/大于等于\s*(\d+)\s*天/);
      const max = label.match(/小于等于\s*(\d+)\s*天/);
      const lessThan = label.match(/小于\s*(\d+)\s*天/);
      if (!min && !max && !lessThan) continue;
      tiers.push({
        minDays: min ? Number(min[1]) : 0,
        maxDays: max ? Number(max[1]) : (lessThan ? Number(lessThan[1]) - 1 : null),
        rate,
        label,
      });
    }
    if (!tiers.length) return null;
    tiers.sort((a, b) => a.minDays - b.minDays);
    // 补齐区间，保证 0 天开始有对应档
    if (tiers[0].minDays > 0) tiers.unshift({ minDays: 0, maxDays: tiers[0].minDays - 1, rate: tiers[0].rate, label: `小于${tiers[0].minDays}天` });
    for (let i = 0; i < tiers.length - 1; i += 1) {
      if (tiers[i].maxDays === null) tiers[i].maxDays = tiers[i + 1].minDays - 1;
    }
    return tiers;
  }

  _parsePurchaseTiers(html) {
    const tiers = [];
    // 只解析"申购费率"表格（认购费率、赎回费率表格格式相似，混入会导致费率取错档）
    const startIndex = findTableSection(html, '申购费率');
    if (startIndex < 0) return tiers;
    const endIndex = html.indexOf('赎回费率', startIndex);
    const section = html.slice(startIndex, endIndex > -1 ? endIndex : undefined);
    const regex = /<td[^>]*>(小于[^<]*?元[^<]*?(?:，[^<]*?元)?)<\/td>\s*<td[^>]*>(.*?)<\/td>/g;
    let match;
    while ((match = regex.exec(section)) !== null) {
      const label = stripTags(match[1]);
      const amountText = stripTags(match[2]);
      const minMatch = label.match(/大于等于\s*(\d+(?:\.\d+)?)\s*万元/);
      const maxMatch = label.match(/小于\s*(\d+(?:\.\d+)?)\s*万元/);
      const lower = minMatch ? Number(minMatch[1]) * 10000 : 0;
      const upper = maxMatch ? Number(maxMatch[1]) * 10000 : null;

      if (/每笔/.test(amountText)) {
        const fixed = Number((amountText.match(/([\d.]+)\s*元/) || [])[1]);
        if (Number.isFinite(fixed)) tiers.push({ minAmount: lower, maxAmount: upper, fixedFee: fixed, rate: null, label });
        continue;
      }

      const percents = [...amountText.matchAll(/([\d.]+)\s*%/g)].map((m) => Number(m[1]) / 100);
      if (!percents.length) continue;
      // 天天基金页面：原费率 | 优惠费率，取优惠费率
      tiers.push({ minAmount: lower, maxAmount: upper, rate: percents[percents.length - 1], label });
    }
    return tiers;
  }

  /** 历史净值（用于走势图 / 周月复盘），会顺手回写本地库 */
  async getHistory(code, days = 30) {
    const code6 = String(code || '').trim();
    const cacheKey = `${code6}:${days}`;
    const cached = this.historyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.rows;

    // 上游单页最多给 20 条；均线/回撤用 120 天，定投回测最多要 800 个交易日
    const pageSize = 20;
    const maxPages = 40;
    const wanted = Math.min(Math.max(days, 5), 800);
    const pages = Math.min(Math.max(Math.ceil(wanted / pageSize), 1), maxPages);
    let rows = [];
    try {
      for (let page = 1; page <= pages; page += 1) {
        const response = await http.get('https://api.fund.eastmoney.com/f10/lsjz', {
          params: { fundCode: code6, pageIndex: page, pageSize, _: Date.now() },
          headers: { Referer: 'https://fundf10.eastmoney.com/' },
        });
        const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        const list = body?.Data?.LSJZList || [];
        rows.push(
          ...list
            .map((row) => ({
              date: toDateOnly(row.FSRQ),
              netValue: Number(row.DWJZ),
              accumulatedValue: Number(row.LJJZ) || null,
              growthRate: row.JZZZL === '' || row.JZZZL === null ? null : Number(row.JZZZL),
            }))
            .filter((row) => row.date && Number.isFinite(row.netValue)),
        );
        if (list.length < pageSize) break;
        await sleep(120);
      }

      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      rows = [...new Map(rows.map((row) => [row.date, row])).values()];

      for (const row of rows) {
        db.run(
          `INSERT INTO fund_net_values (fund_code, date, net_value, accumulated_value, growth_rate, data_source)
           VALUES (?, ?, ?, ?, ?, 'eastmoney-lsjz')
           ON CONFLICT(fund_code, date) DO NOTHING`,
          [code6, row.date, row.netValue, row.accumulatedValue, row.growthRate],
        );
      }
    } catch (error) {
      log.debug(`历史净值 ${code6} 拉取失败，改用本地库: ${error.message}`);
      rows = db
        .all('SELECT date, net_value AS netValue, accumulated_value AS accumulatedValue, growth_rate AS growthRate FROM fund_net_values WHERE fund_code = ? ORDER BY date DESC LIMIT ?', [code6, pages * pageSize])
        .reverse();
    }

    this.historyCache.set(cacheKey, { rows, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return rows;
  }

  /** 批量顺序拉取（保留给需要严格串行的场景） */
  async getFundDataBatch(codes) {
    const results = [];
    for (const code of codes) {
      try {
        results.push(await this.getQuote(code));
        await sleep(500);
      } catch (error) {
        results.push({ code, error: error.message });
      }
    }
    return results;
  }

  clearCache() {
    this.cache.clear();
    this.historyCache.clear();
  }
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function pickRate(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

module.exports = new FundDataService();
module.exports.DEFAULT_REDEMPTION_TIERS = DEFAULT_REDEMPTION_TIERS;
module.exports.safeJson = safeJson;
module.exports.DEFAULT_PURCHASE_RATE = require('../domain/rates').DEFAULT_PURCHASE_RATE;
