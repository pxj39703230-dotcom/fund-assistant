// ================================
// 全局变量
// ================================
let holdings = [];
let portfolio = {};

// ================================
// 初始化
// ================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('📈 基金助手前端已加载');
  
  // 设置默认买入日期为今天
  document.getElementById('buyDate').valueAsDate = new Date();
  
  // 加载数据
  loadPortfolioSummary();
  loadHoldings();
  loadReviews();
  
  // 绑定表单提交
  document.getElementById('addForm').addEventListener('submit', handleAddHolding);
  
  // 定时刷新（每分钟）
  setInterval(() => {
    loadPortfolioSummary();
    loadHoldings();
  }, 60000);
});

// ================================
// 添加持仓
// ================================
async function handleAddHolding(e) {
  e.preventDefault();
  
  const data = {
    fundCode: document.getElementById('fundCode').value.trim(),
    buyDate: document.getElementById('buyDate').value,
    buyAmount: parseFloat(document.getElementById('buyAmount').value),
    buyNetValue: parseFloat(document.getElementById('buyNetValue').value),
    targetProfit: parseFloat(document.getElementById('targetProfit').value),
    stopLoss: parseFloat(document.getElementById('stopLoss').value)
  };
  
  // 验证基金代码
  if (!/^\d{6}$/.test(data.fundCode)) {
    showToast('基金代码格式错误，应为6位数字', 'error');
    return;
  }
  
  try {
    const response = await fetch('/api/holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      showToast('✅ 持仓添加成功！', 'success');
      document.getElementById('addForm').reset();
      document.getElementById('buyDate').valueAsDate = new Date();
      
      // 重新加载数据
      loadPortfolioSummary();
      loadHoldings();
    } else {
      showToast('❌ ' + (result.error || '添加失败'), 'error');
    }
  } catch (error) {
    console.error('添加持仓失败:', error);
    showToast('❌ 网络错误，请稍后重试', 'error');
  }
}

// ================================
// 加载组合总览
// ================================
async function loadPortfolioSummary() {
  try {
    const response = await fetch('/api/portfolio/summary');
    const data = await response.json();
    
    portfolio = data;
    
    // 更新界面
    document.getElementById('totalInvest').textContent = '¥' + formatNumber(data.totalInvest);
    document.getElementById('totalValue').textContent = '¥' + formatNumber(data.totalValue);
    
    const profitElement = document.getElementById('totalProfit');
    const returnElement = document.getElementById('totalReturn');
    
    profitElement.textContent = '¥' + formatNumber(data.totalProfit);
    returnElement.textContent = data.totalReturnRate;
    
    // 设置颜色
    const isProfit = parseFloat(data.totalProfit) >= 0;
    profitElement.className = 'summary-value ' + (isProfit ? 'profit' : 'loss');
    returnElement.className = 'summary-value ' + (isProfit ? 'profit' : 'loss');
    
  } catch (error) {
    console.error('加载组合总览失败:', error);
  }
}

// ================================
// 加载持仓列表
// ================================
async function loadHoldings() {
  const container = document.getElementById('holdingsContainer');
  
  try {
    const response = await fetch('/api/holdings');
    holdings = await response.json();
    
    if (holdings.length === 0) {
      container.innerHTML = '<div class="loading">暂无持仓，点击上方添加您的第一笔投资</div>';
      return;
    }
    
    // 渲染持仓卡片
    container.innerHTML = holdings.map(holding => renderHoldingCard(holding)).join('');
    
  } catch (error) {
    console.error('加载持仓失败:', error);
    container.innerHTML = '<div class="loading">加载失败，请刷新页面重试</div>';
  }
}

// ================================
// 渲染持仓卡片
// ================================
function renderHoldingCard(holding) {
  if (holding.error) {
    return `
      <div class="holding-card">
        <div class="holding-header">
          <div class="holding-title">基金代码: ${holding.fundCode || holding.fund_code}</div>
          <div class="holding-code">数据获取失败</div>
        </div>
        <div class="stale-data">⚠️ ${holding.error}</div>
      </div>
    `;
  }
  
  const profit = holding.profit;
  const isProfit = parseFloat(profit.realProfit) >= 0;
  const growthClass = holding.growthRate >= 0 ? 'positive' : 'negative';
  
  return `
    <div class="holding-card">
      <!-- 头部 -->
      <div class="holding-header">
        <div class="holding-title">${holding.fundName || '基金名称'}</div>
        <div class="holding-code">${holding.fundCode}</div>
      </div>
      
      <!-- 今日涨跌 -->
      <div class="growth-rate ${growthClass}">
        ${holding.growthRate >= 0 ? '📈' : '📉'} 今日 ${holding.growthRate >= 0 ? '+' : ''}${holding.growthRate.toFixed(2)}%
      </div>
      
      <!-- 基本信息 -->
      <div class="holding-info">
        <div class="info-item">
          <div class="info-label">买入日期</div>
          <div class="info-value">${holding.buyDate}</div>
        </div>
        <div class="info-item">
          <div class="info-label">持有天数</div>
          <div class="info-value">${profit.details.holdDays} 天</div>
        </div>
        <div class="info-item">
          <div class="info-label">买入净值</div>
          <div class="info-value">${profit.details.buyNetValue}</div>
        </div>
        <div class="info-item">
          <div class="info-label">当前净值</div>
          <div class="info-value">${profit.details.currentNetValue}</div>
        </div>
        <div class="info-item">
          <div class="info-label">买入金额</div>
          <div class="info-value">¥${formatNumber(holding.buyAmount)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">当前市值</div>
          <div class="info-value">¥${formatNumber(profit.details.currentValue)}</div>
        </div>
      </div>
      
      <!-- 盈亏详情 -->
      <div class="profit-section">
        <div class="profit-row">
          <span class="profit-label">账面盈亏</span>
          <span class="profit-value ${isProfit ? 'positive' : 'negative'}">
            ¥${profit.bookProfit} (${profit.bookReturnRate})
          </span>
        </div>
        <div class="profit-row">
          <span class="profit-label">真实盈亏</span>
          <span class="profit-value ${isProfit ? 'positive' : 'negative'}">
            ¥${profit.realProfit} (${profit.realReturnRate})
          </span>
        </div>
        <div class="profit-row">
          <span class="profit-label">净收益（扣赎回费）</span>
          <span class="profit-value ${parseFloat(profit.netProfit) >= 0 ? 'positive' : 'negative'}">
            ¥${profit.netProfit} (${profit.netReturnRate})
          </span>
        </div>
        <div class="profit-row">
          <span class="profit-label">总手续费</span>
          <span class="profit-value">¥${profit.fees.totalFees}</span>
        </div>
      </div>
      
      <!-- 赎回优化建议 -->
      ${profit.redemptionOptimization.worthWaiting ? `
        <div class="optimization-tip">
          💡 ${profit.redemptionOptimization.suggestion}
          <br>可节省 ¥${profit.redemptionOptimization.savedAmount}
        </div>
      ` : ''}
      
      <!-- 过期数据提示 -->
      ${holding.isStale ? `
        <div class="stale-data">⚠️ 数据未更新，使用历史数据（${holding.updateDate}）</div>
      ` : ''}
      
      <!-- 操作按钮 -->
      <div class="holding-actions">
        <button class="btn-danger" onclick="deleteHolding(${holding.id})">删除</button>
      </div>
    </div>
  `;
}

// ================================
// 删除持仓
// ================================
async function deleteHolding(id) {
  if (!confirm('确定要删除这笔持仓吗？')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/holdings/${id}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      showToast('✅ 持仓已删除', 'success');
      loadPortfolioSummary();
      loadHoldings();
    } else {
      showToast('❌ 删除失败', 'error');
    }
  } catch (error) {
    console.error('删除持仓失败:', error);
    showToast('❌ 网络错误', 'error');
  }
}

// ================================
// 手动同步净值
// ================================
async function syncNow() {
  showToast('🔄 正在同步净值...', 'warning');
  
  try {
    const response = await fetch('/api/sync', { method: 'POST' });
    const result = await response.json();
    
    if (response.ok) {
      showToast('✅ 同步任务已启动，请稍等片刻', 'success');
      
      // 3秒后刷新数据
      setTimeout(() => {
        loadPortfolioSummary();
        loadHoldings();
      }, 3000);
    } else {
      showToast('❌ 同步失败', 'error');
    }
  } catch (error) {
    console.error('同步失败:', error);
    showToast('❌ 网络错误', 'error');
  }
}

// ================================
// 生成复盘
// ================================
async function generateReview() {
  showToast('📊 正在生成复盘...', 'warning');
  
  try {
    const response = await fetch('/api/reviews/daily', { method: 'POST' });
    
    if (response.ok) {
      showToast('✅ 复盘已生成', 'success');
      loadReviews();
    } else {
      showToast('❌ 生成失败', 'error');
    }
  } catch (error) {
    console.error('生成复盘失败:', error);
    showToast('❌ 网络错误', 'error');
  }
}

// ================================
// 加载复盘记录
// ================================
async function loadReviews() {
  const container = document.getElementById('reviewsContainer');
  
  try {
    const response = await fetch('/api/reviews?limit=5');
    const reviews = await response.json();
    
    if (reviews.length === 0) {
      container.innerHTML = '<div class="loading">暂无复盘记录，点击"生成复盘"按钮创建</div>';
      return;
    }
    
    container.innerHTML = reviews.map(review => `
      <div class="review-card">
        <div class="review-header">
          <div class="review-date">📅 ${review.date}</div>
          <div class="review-type">${getReviewTypeName(review.type)}</div>
        </div>
        <div class="review-content">${review.content}</div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('加载复盘失败:', error);
    container.innerHTML = '<div class="loading">加载失败</div>';
  }
}

// ================================
// 工具函数
// ================================

// 格式化数字
function formatNumber(num) {
  if (!num) return '0.00';
  return parseFloat(num).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// 获取复盘类型名称
function getReviewTypeName(type) {
  const types = {
    'daily': '每日复盘',
    'weekly': '周度复盘',
    'monthly': '月度复盘'
  };
  return types[type] || type;
}

// 显示Toast通知
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ================================
// 键盘快捷键
// ================================
document.addEventListener('keydown', (e) => {
  // Ctrl+R 刷新数据
  if (e.ctrlKey && e.key === 'r') {
    e.preventDefault();
    loadPortfolioSummary();
    loadHoldings();
    showToast('🔄 数据已刷新', 'success');
  }
  
  // Ctrl+S 同步净值
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    syncNow();
  }
});

console.log('💡 快捷键提示：');
console.log('   Ctrl+R - 刷新数据');
console.log('   Ctrl+S - 同步净值');