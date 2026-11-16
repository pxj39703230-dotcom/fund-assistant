const cron = require('node-cron');
const fundDataService = require('./fundDataService');
const profitCalculator = require('./profitCalculator');
const db = require('../config/database');

class FundScheduler {
  constructor() {
    this.isRunning = false;
  }

  /**
   * 启动所有定时任务
   */
  start() {
    console.log('⏰ 定时任务调度器已启动');

    // ===== 每个交易日 15:30 第一次拉取（货币基金） =====
    cron.schedule('30 15 * * 1-5', async () => {
      if (!await this._isTradingDay()) return;
      console.log('\n📥 [15:30] 开始拉取货币基金净值...');
      await this.fetchFundsByCategory('货币基金');
    });

    // ===== 每个交易日 18:00 拉取股票/混合基金 =====
    cron.schedule('0 18 * * 1-5', async () => {
      if (!await this._isTradingDay()) return;
      console.log('\n📥 [18:00] 开始拉取股票/混合基金净值...');
      await this.fetchAllFunds();
    });

    // ===== 每个交易日 20:00 第二次拉取 =====
    cron.schedule('0 20 * * 1-5', async () => {
      if (!await this._isTradingDay()) return;
      console.log('\n📥 [20:00] 第二次拉取基金净值...');
      await this.fetchAllFunds();
    });

    // ===== 每个交易日 22:00 最后一次拉取 =====
    cron.schedule('0 22 * * 1-5', async () => {
      if (!await this._isTradingDay()) return;
      console.log('\n📥 [22:00] 最后一次拉取基金净值...');
      await this.fetchAllFunds();
    });

    // ===== 每天 22:30 生成每日复盘 =====
    cron.schedule('30 22 * * *', async () => {
      console.log('\n📊 [22:30] 开始生成每日复盘...');
      await this.generateDailyReview();
    });

    // ===== 每周日 20:00 生成周度复盘 =====
    cron.schedule('0 20 * * 0', async () => {
      console.log('\n📊 [周日] 开始生成周度复盘...');
      await this.generateWeeklyReview();
    });

    // ===== 每月最后一天 20:00 生成月度复盘 =====
    cron.schedule('0 20 28-31 * *', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (tomorrow.getDate() === 1) {
        console.log('\n📊 [月末] 开始生成月度复盘...');
        await this.generateMonthlyReview();
      }
    });

    console.log('✅ 定时任务已配置：');
    console.log('   - 15:30 货币基金净值拉取');
    console.log('   - 18:00/20:00/22:00 所有基金净值拉取');
    console.log('   - 22:30 每日复盘');
    console.log('   - 周日20:00 周度复盘');
    console.log('   - 月末20:00 月度复盘');
  }

  /**
   * 拉取所有持仓基金的净值
   */
  async fetchAllFunds() {
    if (this.isRunning) {
      console.log('⏳ 上一次拉取还在进行中，跳过本次');
      return;
    }

    this.isRunning = true;

    try {
      // 获取所有持仓基金代码
      const holdings = await db.all('SELECT DISTINCT fund_code FROM holdings');
      
      if (holdings.length === 0) {
        console.log('💡 暂无持仓基金');
        return;
      }

      console.log(`📋 共 ${holdings.length} 只基金待更新`);

      let successCount = 0;
      let failCount = 0;

      for (const holding of holdings) {
        try {
          const data = await fundDataService.getFundData(holding.fund_code);
          
          // 检查异动
          await this._checkAbnormalChange(holding.fund_code, data);
          
          successCount++;
          
          // 请求间隔500ms，避免被封
          await this._sleep(500);
          
        } catch (error) {
          console.error(`  ✗ ${holding.fund_code} 失败: ${error.message}`);
          failCount++;
        }
      }

      console.log(`\n✅ 净值拉取完成: 成功 ${successCount}，失败 ${failCount}`);

    } catch (error) {
      console.error('❌ 拉取任务失败:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 按类别拉取基金
   */
  async fetchFundsByCategory(category) {
    try {
      const holdings = await db.all(
        'SELECT DISTINCT h.fund_code FROM holdings h JOIN funds f ON h.fund_code = f.code WHERE f.category = ?',
        [category]
      );

      if (holdings.length === 0) return;

      console.log(`📋 ${category} 共 ${holdings.length} 只`);

      for (const holding of holdings) {
        try {
          await fundDataService.getFundData(holding.fund_code);
          await this._sleep(500);
        } catch (error) {
          console.error(`  ✗ ${holding.fund_code} 失败`);
        }
      }
    } catch (error) {
      console.error('拉取失败:', error.message);
    }
  }

  /**
   * 检查异动（大涨大跌、触达止盈止损）
   */
  async _checkAbnormalChange(fundCode, data) {
    const alerts = [];

    // 1. 单日涨跌超过3%
    if (Math.abs(data.growthRate) > 3) {
      alerts.push({
        type: 'volatility',
        level: 'high',
        message: `⚡ ${data.name || fundCode} 今日${data.growthRate > 0 ? '大涨' : '大跌'} ${Math.abs(data.growthRate).toFixed(2)}%`
      });
    }

    // 2. 检查是否触达止盈止损线
    const holdings = await db.all('SELECT * FROM holdings WHERE fund_code = ?', [fundCode]);
    
    for (const holding of holdings) {
      try {
        const profit = await profitCalculator.calculateRealProfit(holding, data.netValue);
        const returnRate = parseFloat(profit.realReturnRate) / 100;

        // 触达止盈线
        if (returnRate >= holding.target_profit) {
          alerts.push({
            type: 'target_reached',
            level: 'critical',
            message: `🎯 ${data.name || fundCode} 已达止盈线（+${(returnRate * 100).toFixed(2)}%）\n建议: ${profit.redemptionOptimization.suggestion}`
          });
        }

        // 触达止损线
        if (returnRate <= -holding.stop_loss) {
          alerts.push({
            type: 'stop_loss',
            level: 'critical',
            message: `🛑 ${data.name || fundCode} 触达止损线（${(returnRate * 100).toFixed(2)}%）\n建议立即止损`
          });
        }

      } catch (error) {
        // 忽略计算错误
      }
    }

    // 发送通知
    if (alerts.length > 0) {
      for (const alert of alerts) {
        console.log(`\n${alert.message}`);
        // TODO: 这里可以对接通知服务（桌面通知、Server酱等）
      }
    }
  }

  /**
   * 生成每日复盘
   */
  async generateDailyReview() {
    try {
      const holdings = await db.all('SELECT * FROM holdings');
      
      if (holdings.length === 0) {
        console.log('💡 暂无持仓，跳过复盘');
        return;
      }

      let totalProfit = 0;
      let todayProfit = 0;
      const fundDetails = [];

      for (const holding of holdings) {
        try {
          const data = await fundDataService.getFundData(holding.fund_code);
          const profit = await profitCalculator.calculateRealProfit(holding, data.netValue);
          
          totalProfit += parseFloat(profit.realProfit);
          todayProfit += parseFloat(profit.details.currentValue) * (data.growthRate / 100);

          fundDetails.push({
            code: holding.fund_code,
            name: data.name,
            growthRate: data.growthRate,
            profit: parseFloat(profit.realProfit)
          });

        } catch (error) {
          console.error(`计算 ${holding.fund_code} 失败`);
        }
      }

      // 排序
      fundDetails.sort((a, b) => b.growthRate - a.growthRate);

      const review = `
╔════════════════════════════════════════╗
║        📊 ${new Date().toLocaleDateString()} 每日复盘        ║
╚════════════════════════════════════════╝

【今日盈亏】${todayProfit >= 0 ? '📈' : '📉'} ¥${todayProfit.toFixed(2)} 
【累计收益】${totalProfit >= 0 ? '📈' : '📉'} ¥${totalProfit.toFixed(2)}

【今日涨幅榜 TOP3】
${fundDetails.slice(0, 3).map((f, i) => 
  `${i + 1}. ${f.name || f.code} ${f.growthRate > 0 ? '📈' : '📉'} ${f.growthRate.toFixed(2)}%`
).join('\n')}

【今日跌幅榜 TOP3】
${fundDetails.slice(-3).reverse().map((f, i) => 
  `${i + 1}. ${f.name || f.code} ${f.growthRate > 0 ? '📈' : '📉'} ${f.growthRate.toFixed(2)}%`
).join('\n')}

【AI建议】
${this._generateAIAdvice(fundDetails, totalProfit)}

════════════════════════════════════════
      `;

      console.log(review);

      // 保存到数据库
      await db.run(`
        INSERT INTO reviews (date, type, content)
        VALUES (date('now'), 'daily', ?)
      `, [review]);

    } catch (error) {
      console.error('❌ 生成复盘失败:', error.message);
    }
  }

  /**
   * 生成周度复盘
   */
  async generateWeeklyReview() {
    console.log('📊 周度复盘功能开发中...');
    // TODO: 实现周度复盘逻辑
  }

  /**
   * 生成月度复盘
   */
  async generateMonthlyReview() {
    console.log('📊 月度复盘功能开发中...');
    // TODO: 实现月度复盘逻辑
  }

  /**
   * 生成AI建议
   */
  _generateAIAdvice(fundDetails, totalProfit) {
    const avgGrowth = fundDetails.reduce((sum, f) => sum + f.growthRate, 0) / fundDetails.length;
    
    if (avgGrowth > 2) {
      return '市场情绪较好，建议持有观望，谨防追高';
    } else if (avgGrowth < -2) {
      return '市场回调，已设止损的基金注意风险，长期投资者可考虑加仓';
    } else {
      return '市场平稳，继续持有即可';
    }
  }

  /**
   * 判断是否为交易日
   */
  async _isTradingDay() {
    const today = new Date();
    const day = today.getDay();
    
    // 周末
    if (day === 0 || day === 6) {
      return false;
    }
    
    // 检查是否在节假日表中
    const holiday = await db.get(
      'SELECT * FROM trading_holidays WHERE date = date(?)',
      [today.toISOString().split('T')[0]]
    );
    
    return !holiday;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new FundScheduler();