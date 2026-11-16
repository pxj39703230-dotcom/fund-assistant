const axios = require('axios');
const db = require('../config/database');

class FundDataService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
  }

  /**
   * 获取基金实时数据（带容错和缓存）
   */
  async getFundData(code) {
    // 1. 检查缓存
    const cached = this.cache.get(code);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      console.log(`  ↳ [缓存] ${code}: ${cached.data.netValue}`);
      return cached.data;
    }

    // 2. 尝试获取数据
    try {
      const data = await this._fetchFromEastmoney(code);
      
      if (this._validateData(data)) {
        this.cache.set(code, { data, timestamp: Date.now() });
        await this._saveToHistory(code, data, 'eastmoney').catch(() => {});
        console.log(`  ✓ [eastmoney] ${code}: ${data.netValue} (${data.growthRate}%)`);
        return data;
      }
    } catch (error) {
      console.error(`  ✗ 数据获取失败:`, error.message);
    }

    // 3. 所有源都失败，返回最近一次有效数据
    const lastValid = await this._getLastValidData(code);
    if (lastValid) {
      console.warn(`  ⚠ ${code} 使用历史数据（${lastValid.date}）`);
      return { 
        code: code,
        name: '',
        netValue: lastValid.net_value, 
        growthRate: lastValid.growth_rate || 0,
        updateDate: lastValid.date,
        isStale: true 
      };
    }

    throw new Error(`基金 ${code} 数据获取失败，所有数据源不可用`);
  }

  /**
   * 从天天基金获取数据
   */
  async _fetchFromEastmoney(code) {
    const url = `http://fundgz.1234567.com.cn/js/${code}.js`;
    
    try {
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'http://fund.eastmoney.com/'
        }
      });
      
      console.log(`  [调试] 响应内容:`, response.data.substring(0, 200));
      
      // 响应格式：jsonpgz({"fundcode":"110022","name":"易方达消费行业","jzrq":"2025-01-10","dwjz":"2.5430","gsz":"2.5543","gszzl":"0.44"});
      const match = response.data.match(/jsonpgz\((.*)\)/);
      if (!match) {
        throw new Error('数据格式错误');
      }
      
      const data = JSON.parse(match[1]);
      
      return {
        code: data.fundcode,
        name: data.name || '未知基金',
        netValue: parseFloat(data.dwjz || data.gsz || 0),
        estimatedValue: parseFloat(data.gsz || data.dwjz || 0),
        growthRate: parseFloat(data.gszzl || 0),
        updateDate: data.jzrq || new Date().toISOString().split('T')[0]
      };
    } catch (error) {
      console.error(`  [调试] 请求失败:`, error.message);
      throw error;
    }
  }

  /**
   * 数据校验
   */
  _validateData(data) {
    const isValid = data && 
           data.netValue > 0 && 
           data.netValue < 100 &&
           Math.abs(data.growthRate) < 20;
    
    if (!isValid) {
      console.error('  [调试] 数据校验失败:', data);
    }
    
    return isValid;
  }

  /**
   * 保存历史数据
   */
  async _saveToHistory(code, data, source) {
    const year = new Date().getFullYear();
    try {
      await db.run(`
        INSERT OR REPLACE INTO fund_net_values_${year} 
        (fund_code, date, net_value, growth_rate, data_source)
        VALUES (?, ?, ?, ?, ?)
      `, [code, data.updateDate, data.netValue, data.growthRate, source]);
    } catch (err) {
      console.error('  [调试] 保存失败:', err.message);
    }
  }

  /**
   * 获取最近一次有效数据
   */
  async _getLastValidData(code) {
    const year = new Date().getFullYear();
    try {
      return await db.get(`
        SELECT * FROM fund_net_values_${year}
        WHERE fund_code = ?
        ORDER BY date DESC
        LIMIT 1
      `, [code]);
    } catch (err) {
      return null;
    }
  }

  /**
   * 获取基金详细信息
   */
  async getFundDetail(code) {
    try {
      const url = `http://fund.eastmoney.com/pingzhongdata/${code}.js`;
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'http://fund.eastmoney.com/'
        }
      });
      
      const data = { code: code };
      
      const nameMatch = response.data.match(/var fS_name = "(.+?)"/);
      if (nameMatch) data.name = nameMatch[1];
      
      const typeMatch = response.data.match(/var fS_type = "(.+?)"/);
      if (typeMatch) data.type = typeMatch[1];
      
      const managerMatch = response.data.match(/var fund_manager = "(.+?)"/);
      if (managerMatch) data.managerName = managerMatch[1];
      
      const rateMatch = response.data.match(/var fund_Rate = "(.+?)"/);
      if (rateMatch) {
        const rates = rateMatch[1].split('|');
        data.purchaseRate = parseFloat(rates[0]) / 100 || 0.015;
        data.managementRate = parseFloat(rates[1]) / 100 || 0.015;
        data.custodyRate = parseFloat(rates[2]) / 100 || 0.0025;
      }
      
      await db.run(`
        INSERT OR REPLACE INTO funds 
        (code, name, type, manager_name, purchase_rate, management_rate, custody_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        code, 
        data.name || '未知基金', 
        data.type, 
        data.managerName, 
        data.purchaseRate || 0.015,
        data.managementRate || 0.015, 
        data.custodyRate || 0.0025
      ]);
      
      console.log(`✅ 基金 ${code} 详情已更新`);
      return data;
    } catch (error) {
      console.error(`获取基金 ${code} 详情失败:`, error.message);
      return null;
    }
  }

  /**
   * 批量获取基金数据
   */
  async getFundDataBatch(codes) {
    const results = [];
    for (const code of codes) {
      try {
        const data = await this.getFundData(code);
        results.push(data);
        await this._sleep(500);
      } catch (error) {
        console.error(`基金 ${code} 获取失败:`, error.message);
        results.push({ code, error: error.message });
      }
    }
    return results;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new FundDataService();