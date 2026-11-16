require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./config/database');
const fundDataService = require('./services/fundDataService');
const profitCalculator = require('./services/profitCalculator');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ================================
// API 路由
// ================================

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '服务运行正常',
    timestamp: new Date().toISOString()
  });
});

/**
 * 添加持仓
 */
app.post('/api/holdings', async (req, res) => {
  try {
    const { fundCode, buyDate, buyAmount, buyNetValue, targetProfit, stopLoss } = req.body;
    
    // 参数验证
    if (!fundCode || !buyDate || !buyAmount || !buyNetValue) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 计算份额
    const shares = buyAmount / buyNetValue;

    // 插入持仓记录
    const result = await db.run(`
      INSERT INTO holdings (fund_code, buy_date, buy_amount, buy_net_value, shares, target_profit, stop_loss)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      fundCode, 
      buyDate, 
      buyAmount, 
      buyNetValue, 
      shares,
      targetProfit || 0.3,
      stopLoss || 0.2
    ]);

    // 尝试获取基金详细信息
    try {
      await fundDataService.getFundDetail(fundCode);
    } catch (error) {
      console.warn('获取基金详情失败，将使用默认费率');
    }

    res.json({ 
      success: true, 
      id: result.id,
      message: '持仓添加成功'
    });

  } catch (error) {
    console.error('添加持仓失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取所有持仓（含实时盈亏）
 */
app.get('/api/holdings', async (req, res) => {
  try {
    const holdings = await db.all('SELECT * FROM holdings ORDER BY buy_date DESC');
    
    if (holdings.length === 0) {
      return res.json([]);
    }

    // 并发获取所有基金数据
    const results = await Promise.all(holdings.map(async (holding) => {
      try {
        // 获取实时净值
        const data = await fundDataService.getFundData(holding.fund_code);
        
        // 计算盈亏
        const profit = await profitCalculator.calculateRealProfit(holding, data.netValue);
        
        return {
          id: holding.id,
          fundCode: holding.fund_code,
          fundName: data.name,
          buyDate: holding.buy_date,
          buyAmount: holding.buy_amount,
          buyNetValue: holding.buy_net_value,
          currentNetValue: data.netValue,
          growthRate: data.growthRate,
          targetProfit: holding.target_profit,
          stopLoss: holding.stop_loss,
          profit: profit,
          updateDate: data.updateDate,
          isStale: data.isStale || false
        };
      } catch (error) {
        console.error(`获取 ${holding.fund_code} 数据失败:`, error.message);
        return { 
          ...holding, 
          error: error.message,
          fundName: '获取失败'
        };
      }
    }));
    
    res.json(results);

  } catch (error) {
    console.error('获取持仓失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除持仓
 */
app.delete('/api/holdings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.run('DELETE FROM holdings WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    res.json({ success: true, message: '持仓已删除' });

  } catch (error) {
    console.error('删除持仓失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新持仓（修改止盈止损线）
 */
app.put('/api/holdings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetProfit, stopLoss } = req.body;

    const result = await db.run(`
      UPDATE holdings 
      SET target_profit = ?, stop_loss = ?
      WHERE id = ?
    `, [targetProfit, stopLoss, id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    res.json({ success: true, message: '持仓已更新' });

  } catch (error) {
    console.error('更新持仓失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取单只基金实时数据
 */
app.get('/api/fund/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const data = await fundDataService.getFundData(code);
    
    res.json(data);

  } catch (error) {
    console.error(`获取基金 ${req.params.code} 数据失败:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取基金详细信息
 */
app.get('/api/fund/:code/detail', async (req, res) => {
  try {
    const { code } = req.params;
    const detail = await fundDataService.getFundDetail(code);
    
    if (!detail) {
      return res.status(404).json({ error: '基金详情获取失败' });
    }

    res.json(detail);

  } catch (error) {
    console.error(`获取基金详情失败:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取组合总览
 */
app.get('/api/portfolio/summary', async (req, res) => {
  try {
    const holdings = await db.all('SELECT * FROM holdings');
    
    if (holdings.length === 0) {
      return res.json({
        totalInvest: 0,
        totalValue: 0,
        totalProfit: 0,
        totalReturnRate: '0.00%',
        holdingCount: 0
      });
    }

    let totalInvest = 0;
    let totalValue = 0;
    let totalFees = 0;

    for (const holding of holdings) {
      try {
        const data = await fundDataService.getFundData(holding.fund_code);
        const profit = await profitCalculator.calculateRealProfit(holding, data.netValue);
        
        totalInvest += holding.buy_amount;
        totalValue += parseFloat(profit.details.currentValue);
        totalFees += parseFloat(profit.fees.totalFees);
      } catch (error) {
        console.error(`计算 ${holding.fund_code} 失败`);
      }
    }

    const totalProfit = totalValue - totalInvest;
    const totalReturnRate = totalInvest > 0 ? (totalProfit / totalInvest * 100).toFixed(2) + '%' : '0.00%';

    res.json({
      totalInvest: totalInvest.toFixed(2),
      totalValue: totalValue.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      totalReturnRate,
      totalFees: totalFees.toFixed(2),
      holdingCount: holdings.length
    });

  } catch (error) {
    console.error('获取组合总览失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 手动触发净值拉取
 */
app.post('/api/sync', async (req, res) => {
  try {
    console.log('\n🔄 手动触发净值同步...');
    
    // 异步执行，不阻塞响应
    scheduler.fetchAllFunds().catch(err => {
      console.error('同步失败:', err);
    });

    res.json({ 
      success: true, 
      message: '同步任务已启动，请稍后查看结果' 
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取复盘记录
 */
app.get('/api/reviews', async (req, res) => {
  try {
    const { type, limit = 10 } = req.query;
    
    let sql = 'SELECT * FROM reviews';
    const params = [];
    
    if (type) {
      sql += ' WHERE type = ?';
      params.push(type);
    }
    
    sql += ' ORDER BY date DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const reviews = await db.all(sql, params);
    
    res.json(reviews);

  } catch (error) {
    console.error('获取复盘记录失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 手动生成今日复盘
 */
app.post('/api/reviews/daily', async (req, res) => {
  try {
    console.log('\n📊 手动生成每日复盘...');
    
    await scheduler.generateDailyReview();
    
    res.json({ 
      success: true, 
      message: '复盘已生成' 
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// 错误处理
// ================================

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// ================================
// 启动服务
// ================================

app.listen(PORT, () => {
  console.clear();
  console.log('\n');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║                                           ║');
  console.log('║        📈 基金投资助手 v1.0               ║');
  console.log('║                                           ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('\n');
  console.log(`✅ 服务已启动: http://localhost:${PORT}`);
  console.log('✅ 数据库已初始化');
  console.log('\n');
  console.log('📋 可用接口:');
  console.log('   GET  /api/health         - 健康检查');
  console.log('   GET  /api/holdings       - 获取所有持仓');
  console.log('   POST /api/holdings       - 添加持仓');
  console.log('   GET  /api/fund/:code     - 获取基金数据');
  console.log('   POST /api/sync           - 手动同步净值');
  console.log('   GET  /api/portfolio/summary - 组合总览');
  console.log('\n');
  
  // 启动定时任务
  scheduler.start();
  
  console.log('\n💡 提示: 按 Ctrl+C 停止服务\n');
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n\n⏳ 正在关闭服务...');
  
  try {
    await db.close();
    console.log('✅ 数据库连接已关闭');
  } catch (error) {
    console.error('❌ 关闭数据库失败:', error);
  }
  
  console.log('👋 再见！\n');
  process.exit(0);
});