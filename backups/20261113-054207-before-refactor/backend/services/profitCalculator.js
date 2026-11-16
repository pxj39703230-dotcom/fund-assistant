const db = require('../config/database');

class ProfitCalculator {
  /**
   * 计算持仓真实盈亏（扣除所有费用）
   */
  async calculateRealProfit(holding, currentNetValue) {
    const fund = await db.get('SELECT * FROM funds WHERE code = ?', [holding.fund_code]);
    
    if (!fund) {
      // 如果数据库没有基金信息，使用默认费率
      console.warn(`基金 ${holding.fund_code} 信息未找到，使用默认费率`);
    }

    // 计算持有天数
    const buyDate = new Date(holding.buy_date);
    const today = new Date();
    const holdDays = Math.floor((today - buyDate) / (1000 * 60 * 60 * 24));

    // ===== 第一步：买入成本 =====
    const purchaseRate = fund ? fund.purchase_rate : 0.015;
    const purchaseFee = this._calculatePurchaseFee(holding.buy_amount, purchaseRate);
    const actualInvestment = holding.buy_amount - purchaseFee;
    const shares = actualInvestment / holding.buy_net_value;

    // ===== 第二步：持有期成本 =====
    const managementRate = fund ? fund.management_rate : 0.015;
    const custodyRate = fund ? fund.custody_rate : 0.0025;
    const holdingCost = this._calculateHoldingCost(
      actualInvestment,
      holdDays,
      managementRate,
      custodyRate
    );

    // ===== 第三步：当前市值 =====
    const currentValue = shares * currentNetValue;

    // ===== 第四步：赎回费（根据持有天数） =====
    const redemptionRates = this._parseRedemptionRates(fund ? fund.redemption_rates : null);
    const redemptionFee = this._calculateRedemptionFee(currentValue, holdDays, redemptionRates);

    // ===== 第五步：计算各种盈亏口径 =====
    const bookProfit = currentValue - holding.buy_amount;
    const bookReturnRate = bookProfit / holding.buy_amount;

    const realProfit = currentValue - holding.buy_amount - purchaseFee - holdingCost;
    const realReturnRate = realProfit / holding.buy_amount;

    const netProfit = currentValue - holding.buy_amount - purchaseFee - holdingCost - redemptionFee;
    const netReturnRate = netProfit / holding.buy_amount;

    return {
      // 账面盈亏（不考虑费用）
      bookProfit: bookProfit.toFixed(2),
      bookReturnRate: (bookReturnRate * 100).toFixed(2) + '%',

      // 真实盈亏（考虑已发生的费用）
      realProfit: realProfit.toFixed(2),
      realReturnRate: (realReturnRate * 100).toFixed(2) + '%',

      // 如果现在卖出的净收益（考虑所有费用）
      netProfit: netProfit.toFixed(2),
      netReturnRate: (netReturnRate * 100).toFixed(2) + '%',

      // 费用明细
      fees: {
        purchaseFee: purchaseFee.toFixed(2),
        holdingCost: holdingCost.toFixed(2),
        redemptionFee: redemptionFee.toFixed(2),
        totalFees: (purchaseFee + holdingCost + redemptionFee).toFixed(2)
      },

      // 持仓详情
      details: {
        shares: shares.toFixed(2),
        buyNetValue: holding.buy_net_value.toFixed(4),
        currentNetValue: currentNetValue.toFixed(4),
        currentValue: currentValue.toFixed(2),
        holdDays: holdDays
      },

      // 赎回费优化建议
      redemptionOptimization: this._getRedemptionOptimization(holdDays, redemptionRates, currentValue)
    };
  }

  /**
   * 计算申购费（通常打1折）
   */
  _calculatePurchaseFee(amount, rate) {
    // 支付宝、天天基金等平台通常是1折申购费
    const discountRate = rate * 0.1;
    return amount * discountRate;
  }

  /**
   * 计算持有期成本（管理费+托管费）
   */
  _calculateHoldingCost(amount, holdDays, mgmtRate, custodyRate) {
    // 管理费：每日计提 = 金额 × (年费率/365) × 持有天数
    const mgmtFee = amount * (mgmtRate / 365) * holdDays;
    
    // 托管费
    const custodyFee = amount * (custodyRate / 365) * holdDays;

    return mgmtFee + custodyFee;
  }

  /**
   * 计算赎回费（根据持有天数阶梯费率）
   */
  _calculateRedemptionFee(currentValue, holdDays, rateTable) {
    const applicableRate = rateTable.find(r => holdDays < r.days)?.rate || 0;
    return currentValue * applicableRate;
  }

  /**
   * 解析赎回费率表
   */
  _parseRedemptionRates(ratesStr) {
    // 默认赎回费率表（常见基金费率结构）
    const defaultRates = [
      { days: 7, rate: 0.015 },      // 7天内：1.5%
      { days: 30, rate: 0.005 },     // 7-30天：0.5%
      { days: 365, rate: 0.001 },    // 30-365天：0.1%
      { days: 730, rate: 0 }         // 2年以上：免费
    ];

    if (!ratesStr) return defaultRates;

    try {
      return JSON.parse(ratesStr);
    } catch {
      return defaultRates;
    }
  }

  /**
   * 赎回费优化建议
   */
  _getRedemptionOptimization(holdDays, rateTable, currentValue) {
    const currentRate = rateTable.find(r => holdDays < r.days);
    const nextRate = rateTable.find(r => r.days > holdDays && r.rate < (currentRate?.rate || 0));

    if (!nextRate || !currentRate) {
      return { 
        suggestion: '✅ 已达最低赎回费率，无需等待',
        worthWaiting: false 
      };
    }

    const daysToWait = nextRate.days - holdDays;
    const feeSaved = currentRate.rate - nextRate.rate;
    const savedAmount = currentValue * feeSaved;

    return {
      suggestion: `💡 再持有 ${daysToWait} 天，赎回费从 ${(currentRate.rate * 100).toFixed(2)}% 降至 ${(nextRate.rate * 100).toFixed(2)}%`,
      daysToWait,
      currentRate: (currentRate.rate * 100).toFixed(2) + '%',
      nextRate: (nextRate.rate * 100).toFixed(2) + '%',
      feeSavedPercent: (feeSaved * 100).toFixed(2) + '%',
      savedAmount: savedAmount.toFixed(2),
      worthWaiting: feeSaved > 0.003 // 节省超过0.3%才值得等
    };
  }

  /**
   * 计算组合总盈亏
   */
  async calculatePortfolioProfit(holdings, currentNetValues) {
    let totalInvest = 0;
    let totalValue = 0;
    let totalFees = 0;

    const details = [];

    for (const holding of holdings) {
      const netValue = currentNetValues[holding.fund_code];
      if (!netValue) continue;

      const profit = await this.calculateRealProfit(holding, netValue);
      
      totalInvest += holding.buy_amount;
      totalValue += parseFloat(profit.details.currentValue);
      totalFees += parseFloat(profit.fees.totalFees);

      details.push({
        fundCode: holding.fund_code,
        profit: profit
      });
    }

    const totalProfit = totalValue - totalInvest - totalFees;
    const totalReturnRate = totalProfit / totalInvest;

    return {
      totalInvest: totalInvest.toFixed(2),
      totalValue: totalValue.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      totalReturnRate: (totalReturnRate * 100).toFixed(2) + '%',
      totalFees: totalFees.toFixed(2),
      details
    };
  }
}

module.exports = new ProfitCalculator();