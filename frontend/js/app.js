import { api, ApiError, onAuthRequired } from './api.js?v=1.7';
import {
  escapeHtml,
  money,
  signedMoney,
  percentFromRate,
  percentFromNumber,
  signClass,
  todayISO,
  shortDate,
  dateTime,
  colorAt,
  sparklinePath,
} from './format.js?v=1.6';

const state = {
  portfolio: null,
  meta: null,
  reviewType: 'daily',
  history: new Map(),
  sparklineLoading: new Set(),
  syncing: false,
  market: null,
  marketTimer: null,
  lastMarketLoad: 0,
  ask: { open: false, busy: false, greeted: false },
  watchlist: [],
  constitution: null,
  timer: null,
  lastLoaded: 0,
};

const ASK_STYLE_KEY = 'fund-assistant-ask-style';

function answerStyle() {
  try {
    return localStorage.getItem(ASK_STYLE_KEY) === 'brief' ? 'brief' : 'coach';
  } catch (error) {
    return 'coach';
  }
}

const SOURCE_LABEL = {
  'eastmoney-lsjz': '东财净值',
  'eastmoney-mobile': '东财快照',
  sina: '新浪行情',
  tencent: '腾讯行情',
  'local-cache': '本地缓存',
  none: '无数据',
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 显示当前用户
  const username = localStorage.getItem('username');
  if (username) {
    document.getElementById('currentUser').textContent = `👤 ${username}`;
  }
  
  // 绑定退出按钮
  document.getElementById('btnLogout').addEventListener('click', () => {
    if (confirm('确定要退出登录吗？')) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      window.location.href = '/login.html';
    }
  });
  
  onAuthRequired(() => {
    const input = window.prompt('该服务已开启访问口令，请输入 API_TOKEN：');
    return input;
  });

  document.getElementById('buyDate').value = todayISO();
  bindEvents();
  await loadMeta();
  await Promise.allSettled([loadPortfolio(), loadMarket(), loadReviews(), loadAlerts(), loadWatchlist()]);
  startPolling();
}

function bindEvents() {
  document.getElementById('addForm').addEventListener('submit', handleAdd);
  document.getElementById('fundCode').addEventListener('input', debounce(previewFund, 700));
  document.getElementById('fundCode').addEventListener('blur', previewFund);
  document.getElementById('btnSync').addEventListener('click', syncNow);
  document.getElementById('btnRefresh').addEventListener('click', () => loadPortfolio(true));
  document.getElementById('btnReview').addEventListener('click', generateReview);
  document.getElementById('positions').addEventListener('click', handlePositionAction);
  document.getElementById('alertBar').addEventListener('click', handleAlertAction);
  document.getElementById('preview').addEventListener('click', handlePreviewAction);
  document.getElementById('reviewTabs').addEventListener('click', handleReviewTab);
  document.getElementById('adviceActions').addEventListener('click', handleAdviceAction);
  document.getElementById('btnSettings').addEventListener('click', openAiSettings);
  document.getElementById('btnAiSettings').addEventListener('click', openAiSettings);
  document.getElementById('watchlistForm').addEventListener('submit', handleWatchAdd);
  document.getElementById('watchlistList').addEventListener('click', handleWatchAction);
  document.getElementById('btnConstEdit').addEventListener('click', openConstitutionForm);
  document.getElementById('constitutionForm').addEventListener('submit', handleConstitutionSave);
  document.getElementById('btnConstCancel').addEventListener('click', closeConstitutionForm);
  document.getElementById('constCheckForm').addEventListener('submit', handleConstitutionCheck);
  initAsk();
  initAnalysis();
  initMobileAccess();
  initTabNavigation();

  const modal = document.getElementById('modal');
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.getElementById('editForm').addEventListener('submit', handleEditSave);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
      closeAsk();
      closeAiSettings();
    }
  });
}

function startPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (document.hidden || state.syncing) return;
    if (Date.now() - state.lastLoaded < 60 * 1000) return;
    loadPortfolio(false, true);
  }, 120 * 1000);

  if (state.marketTimer) clearInterval(state.marketTimer);
  // 交易时段 30 秒刷新，非交易时段最多 5 分钟一次，避免盘前盘后空转
  state.marketTimer = setInterval(() => {
    if (document.hidden) return;
    const trading = state.market?.state === 'trading';
    const stale = !state.lastMarketLoad || Date.now() - state.lastMarketLoad > 5 * 60 * 1000;
    if (trading || stale) loadMarket(true);
  }, 30 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastLoaded > 5 * 60 * 1000) {
      loadPortfolio(false, true);
    }
  });
}

// -------------------- 数据加载 --------------------

async function loadMeta() {
  try {
    state.meta = await api.meta();
    document.getElementById('footerVersion').textContent = `v${state.meta.version}`;
    renderMarketLine();
    renderMobileAccess();
  } catch (error) {
    showNotice([{ type: 'error', text: error.message }]);
  }
}

async function loadPortfolio(refresh = false, silent = false) {
  try {
    const data = await api.portfolio(refresh);
    state.portfolio = data;
    if (data.market) state.market = data.market;
    state.lastLoaded = Date.now();
    renderSummary();
    renderConstitution(data.constitution);
    renderAdvice();
    renderPositions();
    renderAlerts(data.alerts);
    renderMarketLine();
    if (!silent) clearNotice();
  } catch (error) {
    if (silent) return;
    showNotice([{ type: 'error', text: error.message }]);
    if (error instanceof ApiError && error.status === 401) return;
  }
}

async function loadReviews() {
  const container = document.getElementById('reviews');
  try {
    const reviews = await api.reviews(state.reviewType, 8);
    if (!reviews.length) {
      container.innerHTML = '<div class="empty">该类型暂无复盘记录，点击右上角“生成复盘”创建</div>';
      return;
    }
    container.innerHTML = reviews.map((review) => `
      <article class="review">
        <div class="review-head">
          <b>${escapeHtml(review.typeName)} · ${escapeHtml(review.date)}</b>
          <span>${escapeHtml(dateTime(review.createdAt))}</span>
        </div>
        <pre>${escapeHtml(review.content || '')}</pre>
      </article>
    `).join('');
  } catch (error) {
    container.innerHTML = `<div class="empty">复盘加载失败：${escapeHtml(error.message)}</div>`;
  }
}

async function loadAlerts() {
  try {
    renderAlerts(await api.alerts(20));
  } catch (error) {
    /* 提醒不是核心路径，失败静默 */
  }
}

// -------------------- 渲染：投资宪法 --------------------

function constRuleCard(label, value, note, enabled) {
  return `
    <div class="const-rule ${enabled ? '' : 'off'}">
      <b>${escapeHtml(label)}</b>
      <span>${escapeHtml(value)}</span>
      <span>${escapeHtml(note)}</span>
    </div>
  `;
}

function renderConstitution(data) {
  const box = document.getElementById('constitutionRules');
  const auditBox = document.getElementById('constitutionAudit');
  if (!box) return;
  if (!data || !data.rules) {
    box.innerHTML = '<div class="empty">宪法规则加载失败，刷新页面再试。</div>';
    if (auditBox) auditBox.innerHTML = '';
    return;
  }
  state.constitution = data;
  const rules = data.rules;
  box.innerHTML = [
    constRuleCard('单只占比', `不超过 ${rules.maxSingleWeight}%`, '单只基金占组合的上限', rules.enabled),
    constRuleCard('单笔亏损', `不超过 ${rules.maxLossPerBuy} 元`, '按止损线算，不是猜', rules.enabled),
    constRuleCard('新基金首笔', `不超过 ${rules.maxFirstBuy} 元`, '先小仓试水，拿得住再加', rules.enabled),
    constRuleCard('体检分', `至少 ${rules.minCheckScore} 分`, '低于这条线就不买', rules.enabled),
    constRuleCard('基金只数', `最多 ${rules.maxFunds} 只`, '别为了分散买一堆', rules.enabled),
  ].join('');

  if (auditBox) {
    if (!rules.enabled) {
      auditBox.innerHTML = '<div class="const-audit-item info">宪法已停用；体检还会给建议，但不会再用你的硬规则拦。</div>';
    } else if (!data.audit || !data.audit.items?.length) {
      auditBox.innerHTML = '<div class="const-audit-item ok">当前组合没有触发宪法的硬规则。买入前还会逐笔核对。</div>';
    } else {
      auditBox.innerHTML = data.audit.items
        .map((item) => `<div class="const-audit-item ${item.level === 'info' ? 'info' : ''}"><b>${escapeHtml(item.label)}</b>：${escapeHtml(item.text)}</div>`)
        .join('');
    }
  }
  if (document.getElementById('constitutionForm').classList.contains('hidden')) fillConstitutionForm(rules);
}

function fillConstitutionForm(rules) {
  document.getElementById('constEnabled').checked = Boolean(rules.enabled);
  document.getElementById('constWeight').value = rules.maxSingleWeight;
  document.getElementById('constLoss').value = rules.maxLossPerBuy;
  document.getElementById('constFirst').value = rules.maxFirstBuy;
  document.getElementById('constScore').value = rules.minCheckScore;
  document.getElementById('constFunds').value = rules.maxFunds;
}

async function openConstitutionForm() {
  if (!state.constitution) {
    try {
      const data = await api.constitution();
      state.constitution = data;
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
  }
  fillConstitutionForm(state.constitution.rules);
  document.getElementById('constitutionForm').classList.remove('hidden');
  document.getElementById('constWeight').focus();
}

function closeConstitutionForm() {
  document.getElementById('constitutionForm').classList.add('hidden');
}

async function handleConstitutionSave(event) {
  event.preventDefault();
  const button = document.getElementById('btnConstSave');
  const body = {
    enabled: document.getElementById('constEnabled').checked,
    maxSingleWeight: Number(document.getElementById('constWeight').value),
    maxLossPerBuy: Number(document.getElementById('constLoss').value),
    maxFirstBuy: Number(document.getElementById('constFirst').value),
    minCheckScore: Number(document.getElementById('constScore').value),
    maxFunds: Number(document.getElementById('constFunds').value),
  };
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    await api.saveConstitution(body);
    closeConstitutionForm();
    await loadPortfolio(false, true);
    toast('宪法已保存；下次买前体检会按新规则核对', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '保存规则';
  }
}

async function handleConstitutionCheck(event) {
  event.preventDefault();
  const code = document.getElementById('constCheckCode').value.trim();
  const amount = Number(document.getElementById('constCheckAmount').value);
  if (!/^\d{6}$/.test(code)) {
    toast('基金代码必须是 6 位数字', 'error');
    return;
  }
  if (!(amount > 0)) {
    toast('金额要大于 0', 'error');
    return;
  }
  const button = document.getElementById('btnConstCheck');
  const box = document.getElementById('constitutionCheckResult');
  button.disabled = true;
  button.textContent = '核对中…';
  box.innerHTML = '<div class="empty">正在算这笔有没有越线…</div>';
  try {
    const data = await api.checkConstitution({ code, amount });
    box.innerHTML = renderConstitutionBlock(data.constitution) || '<div class="empty">没有拿到宪法结果</div>';
  } catch (error) {
    box.innerHTML = `<div class="empty">核对失败：${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = '核对';
  }
}

// -------------------- 渲染：总览 --------------------

function renderSummary() {
  const { summary, positions, meta } = state.portfolio;
  setText('mInvest', `¥${money(summary.invest)}`);
  setText('mValue', `¥${money(summary.value)}`);
  setText('mValueSub', `账面盈亏 ${signedMoney(summary.bookProfit)}（${percentFromRate(summary.bookRate)}）`);

  const realEl = setText('mReal', signedMoney(summary.realProfit));
  realEl.className = signClass(summary.realProfit);
  setText('mRealSub', `收益率 ${percentFromRate(summary.realRate)} · 已扣申购费 ¥${money(summary.purchaseFee)}`);

  const netEl = setText('mNet', signedMoney(summary.netProfit));
  netEl.className = signClass(summary.netProfit);
  setText('mNetSub', `收益率 ${percentFromRate(summary.netRate)} · 赎回费 ¥${money(summary.redemptionFeeIfSell)}`);

  const todayEl = setText('mToday', signedMoney(summary.todayProfit));
  todayEl.className = signClass(summary.todayProfit);
  setText('mTodaySub', summary.todayProfit === 0 ? '今日无有效涨跌' : '按当日净值涨跌估算');

  setText('mCount', `${summary.holdingCount} 笔`);
  setText('mCountSub', `${summary.fundCount} 只基金${summary.staleCount ? ` · ${summary.staleCount} 笔数据滞后` : ''}`);

  setText('summaryMeta', `交易日 ${meta.today} · 数据时间 ${dateTime(meta.updatedAt)}${summary.staleCount ? ' · 含历史净值' : ''}`);
  setText('positionsMeta', `共 ${positions.length} 笔 · 市值 ¥${money(summary.value)}`);

  renderAllocation(positions);
  renderNoticeFromPortfolio();
}

function renderAllocation(positions) {
  const bar = document.getElementById('allocBar');
  const legend = document.getElementById('allocLegend');
  if (!positions.length) {
    bar.innerHTML = '';
    legend.textContent = '';
    return;
  }

  const grouped = new Map();
  for (const p of positions) {
    const item = grouped.get(p.code) || { code: p.code, name: p.name, value: 0 };
    item.value += p.profit.currentValue;
    grouped.set(p.code, item);
  }
  const list = [...grouped.values()].sort((a, b) => b.value - a.value);
  const total = list.reduce((sum, item) => sum + item.value, 0) || 1;

  bar.innerHTML = list.map((item, index) => {
    const width = (item.value / total) * 100;
    return `<div class="alloc-seg" style="width:${width.toFixed(2)}%;background:${colorAt(index)}" title="${escapeHtml(item.name)}"></div>`;
  }).join('');

  legend.innerHTML = list.map((item, index) => {
    const share = ((item.value / total) * 100).toFixed(1);
    return `<span><i style="background:${colorAt(index)}"></i>${escapeHtml(item.name)} ${share}%</span>`;
  }).join('');
}

function renderMarketLine() {
  const market = state.market;
  const meta = state.meta;
  const portfolio = state.portfolio;
  const lineEl = document.getElementById('marketLine');

  if (market && market.indices && market.indices.length) {
    lineEl.innerHTML = market.indices
      .map((item) => `<span class="idx ${signClass(item.pct)}">${escapeHtml(item.name)} ${Number(item.price).toFixed(2)} <em>${percentFromNumber(item.pct)}</em></span>`)
      .join('<span class="idx-sep">·</span>');
  } else {
    lineEl.textContent = '行情暂时取不到（净值与建议照常可用）';
  }

  const parts = [];
  if (meta) {
    parts.push(meta.today);
    parts.push(market?.stateLabel || (meta.tradingDay ? '交易日' : '休市'));
    if (market?.asOf) parts.push(`行情 ${dateTime(market.asOf)}`);
    if (meta.lastSyncAt) parts.push(`上次同步 ${dateTime(meta.lastSyncAt)}`);
    if (meta.tokenRequired) parts.push('已启用访问口令');
  }
  if (portfolio?.meta?.quoteSources?.length) {
    parts.push(`净值来源 ${portfolio.meta.quoteSources.map((s) => SOURCE_LABEL[s] || s).join(' / ')}`);
  }
  setText('marketSub', parts.join(' · '));
}

// -------------------- 渲染：今日决策 --------------------

function renderAdvice() {
  const advice = state.portfolio?.advice;
  const head = document.getElementById('adviceHead');
  const actionsEl = document.getElementById('adviceActions');
  const flagsEl = document.getElementById('adviceFlags');
  const metaEl = document.getElementById('adviceMeta');

  if (!advice || !advice.plan) {
    head.className = 'advice-head tone-info';
    head.textContent = '数据加载中…';
    return;
  }

  const plan = advice.plan;
  const meta = state.portfolio.meta || {};
  metaEl.textContent = `按 ${meta.today || '最新'} 净值判断 · ${state.market?.stateLabel || '—'}`;
  head.className = `advice-head tone-${plan.tone}`;
  head.innerHTML = `
    <div class="advice-line"><span class="advice-dot"></span><strong>${escapeHtml(plan.headline)}</strong></div>
    ${plan.subline ? `<p class="advice-sub">${escapeHtml(plan.subline)}</p>` : ''}
  `;

  if (plan.actions.length) {
    actionsEl.classList.remove('is-empty');
    actionsEl.innerHTML = plan.actions.map((item) => `
      <div class="action-card tone-${item.tone}">
        <div class="action-head">
          <span class="action-name">${escapeHtml(item.name)}</span>
          <span class="chip ${item.tone}">${escapeHtml(item.verdictLabel)}</span>
        </div>
        <p>${escapeHtml(item.action)}</p>
        <button type="button" class="link-btn" data-focus="${escapeHtml(item.code)}">查看这笔持仓 →</button>
      </div>`).join('');
  } else {
    const watches = (state.portfolio.positions || [])
      .filter((pos) => pos.advice && (pos.advice.triggers || []).length)
      .slice(0, 3);
    actionsEl.classList.add('is-empty');
    actionsEl.innerHTML = watches.length
      ? `<div class="watch-list">
          <p class="watch-title">不用动手，但这几条线记一下，破了再说：</p>
          ${watches.map((pos) => {
            const lines = pos.advice.triggers
              .filter((t) => t.note === '跌破视为波段走弱' || t.note === '对应止损线')
              .slice(0, 2)
              .map((t) => `${escapeHtml(t.label)} ${t.value}`);
            return `<div class="watch-item">
              <span class="action-name">${escapeHtml(pos.name)}</span>
              <span class="watch-lines">${lines.join(' · ') || '—'}</span>
              <button type="button" class="link-btn" data-focus="${escapeHtml(pos.code)}">看持仓 →</button>
            </div>`;
          }).join('')}
        </div>`
      : '<p class="muted">暂时没有需要动手的事。</p>';
  }

  flagsEl.innerHTML = (plan.flags || []).map((flag) => `
    <div class="flag ${escapeHtml(flag.level)}">
      <b>${escapeHtml(flag.title)}</b>
      <span>${escapeHtml(flag.text)}</span>
    </div>`).join('');

  renderReviewLink();
}

function handleAdviceAction(event) {
  const button = event.target.closest('[data-focus]');
  if (!button) return;
  const card = document.querySelector(`.position[data-code="${button.dataset.focus}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1200);
}

async function loadMarket(force = false) {
  try {
    state.market = await api.market(force);
    state.lastMarketLoad = Date.now();
    renderMarketLine();
    if (state.portfolio) renderAdvice();
  } catch (error) {
    /* 行情不是核心路径，失败静默 */
  }
}

// -------------------- 渲染：持仓 --------------------

function renderPositions() {
  const container = document.getElementById('positions');
  const positions = state.portfolio.positions;

  if (!positions.length) {
    container.innerHTML = '<div class="empty">还没有持仓。在上方录入第一笔买入，或先添加一笔再同步净值。</div>';
    return;
  }

  container.innerHTML = positions.map(renderPositionCard).join('');
  document.querySelectorAll('[data-spark]').forEach((el) => drawSpark(el, state.history.get(el.dataset.spark)));
  loadSparklines();
}

function renderPositionCard(position) {
  if (!position.priced && position.error) {
    return `
      <article class="position error">
        <div class="position-head">
          <div class="position-title">
            <h3>${escapeHtml(position.name)}</h3>
            <span class="code">${escapeHtml(position.code)} · 买入 ${escapeHtml(position.buyDate)}</span>
          </div>
        <div class="error-box">净值获取失败：${escapeHtml(position.error)}</div>
        <div class="facts">
          <div class="fact"><span>买入金额</span><b>¥${money(position.buyAmount)}</b></div>
          <div class="fact"><span>买入净值</span><b>${position.buyNav}</b></div>
          <div class="fact"><span>份额</span><b>${position.shares}</b></div>
        </div>
        <div class="position-actions">
          <button class="btn danger small" data-action="delete" data-id="${position.id}">删除</button>
        </div>
      </article>
    `;
  }

  const profit = position.profit;
  const risk = profit.risk;
  const badges = [];
  if (position.stale) badges.push(`<span class="badge warn">历史净值 · ${position.staleDays} 天前</span>`);
  if (risk.reachedTarget) badges.push('<span class="badge danger">已达止盈</span>');
  if (risk.reachedStop) badges.push('<span class="badge danger">触及止损</span>');
  badges.push(`<span class="badge">${escapeHtml(SOURCE_LABEL[position.source] || position.source)}</span>`);

  const growthText = position.growthRate === null ? '—' : percentFromNumber(position.growthRate);
  const opt = profit.redemption.optimization;
  const tipClass = risk.reachedTarget || risk.reachedStop ? 'warn' : (opt.worthWaiting ? 'accent' : '');

  let tipText;
  if (risk.reachedTarget) {
    tipText = `已达止盈线 +${(position.targetProfit * 100).toFixed(0)}%，当前 ${percentFromRate(profit.realRate)}。${opt.worthWaiting ? opt.text : '可考虑分批止盈。'}`;
  } else if (risk.reachedStop) {
    tipText = `已触及止损线 -${(position.stopLoss * 100).toFixed(0)}%，当前 ${percentFromRate(profit.realRate)}。先复核投资逻辑，再决定是否减仓。`;
  } else {
    tipText = opt.text;
  }

  const markerPos = Math.min(Math.max(risk.positionRatio * 100, 0), 100);

  return `
    <article class="position${position.stale ? ' stale' : ''}" data-id="${position.id}" data-code="${escapeHtml(position.code)}">
      <div class="position-head">
        <div class="position-title">
          <h3>${escapeHtml(position.name)}</h3>
          <span class="code">${escapeHtml(position.code)}</span>
        </div>
        <div class="badges">${badges.join('')}</div>
      </div>

      <div class="nav-row">
        <span class="nav-value">${position.currentNav.toFixed(4)}</span>
        <span class="nav-change ${signClass(position.growthRate)}">${growthText}</span>
        ${position.advice && position.advice.estimate ? `<span class="est ${signClass(position.advice.estimate.pct)}">盘中估算 ${position.advice.estimate.nav} ${percentFromNumber(position.advice.estimate.pct)}</span>` : ''}
        <span class="nav-date">净值日 ${escapeHtml(shortDate(position.navDate))}</span>
      </div>
      <svg class="sparkline" viewBox="0 0 300 44" preserveAspectRatio="none" data-spark="${escapeHtml(position.code)}" aria-hidden="true"></svg>

      <div class="facts">
        <div class="fact"><span>持有天数</span><b>${profit.holdDays} 天</b></div>
        <div class="fact"><span>份额</span><b>${position.shares}</b></div>
        <div class="fact"><span>买入净值</span><b>${position.buyNav}</b></div>
        <div class="fact"><span>买入金额</span><b>¥${money(position.buyAmount)}</b></div>
        <div class="fact"><span>当前市值</span><b>¥${money(profit.currentValue)}</b></div>
        <div class="fact"><span>今日盈亏</span><b class="${signClass(position.todayProfit)}">${signedMoney(position.todayProfit)}</b></div>
      </div>

      <div class="pl">
        <div class="pl-row">
          <span class="label">账面盈亏</span>
          <span class="value ${signClass(profit.bookProfit)}">${signedMoney(profit.bookProfit)} <small>${percentFromRate(profit.bookRate)}</small></span>
        </div>
        <div class="pl-row primary">
          <span class="label">真实盈亏</span>
          <span class="value ${signClass(profit.realProfit)}">${signedMoney(profit.realProfit)} <small>${percentFromRate(profit.realRate)}</small></span>
        </div>
        <div class="pl-row">
          <span class="label">净收益（现在赎回）</span>
          <span class="value ${signClass(profit.netProfit)}">${signedMoney(profit.netProfit)} <small>${percentFromRate(profit.netRate)}</small></span>
        </div>
      </div>

      ${renderAdviceInline(position)}

      <div class="risk">
        <div class="risk-head">
          <span>止损 -${(position.stopLoss * 100).toFixed(0)}%</span>
          <span>当前 ${percentFromRate(profit.realRate)}</span>
          <span>止盈 +${(position.targetProfit * 100).toFixed(0)}%</span>
        </div>
        <div class="progress"><div class="fill"></div><div class="marker" style="left:calc(${markerPos.toFixed(1)}% - 1px)"></div></div>
        <div class="risk-head">
          <span>距止盈 ${percentFromRate(Math.max(risk.distanceToTarget, 0))}</span>
          <span>距止损 ${percentFromRate(Math.max(risk.distanceToStop, 0))}</span>
        </div>
      </div>

      <div class="tip ${tipClass}">${escapeHtml(tipText)}</div>

      <details class="fees">
        <summary>费用明细与计算依据</summary>
        <div class="fee-table">
          <div class="fee-row"><span>申购费率（买入 ¥${money(position.buyAmount)} 适用）</span><b>${percentFromRate(profit.fees.purchaseRate, 3)}</b></div>
          <div class="fee-row"><span>申购费（内扣）</span><b>¥${money(profit.fees.purchaseFee)}</b></div>
          <div class="fee-row"><span>赎回费率（${escapeHtml(profit.fees.redemptionLabel || '')}）</span><b>${percentFromRate(profit.fees.redemptionRate, 3)}</b></div>
          <div class="fee-row"><span>若现在赎回的赎回费</span><b>¥${money(profit.fees.redemptionFee)}</b></div>
          <div class="fee-row"><span>管理费率 / 托管费率</span><b>${percentFromRate(profit.includedCost.managementRate, 2)} / ${percentFromRate(profit.includedCost.custodyRate, 2)}</b></div>
          <div class="fee-row"><span>持有期已内含费用（估算）</span><b>¥${money(profit.includedCost.estimated)}</b></div>
          <div class="fee-row"><span class="muted">${escapeHtml(profit.includedCost.note)}</span></div>
        </div>
      </details>

      <div class="position-actions">
        <button class="btn ghost small" data-action="edit" data-id="${position.id}">编辑</button>
        <button class="btn danger small" data-action="delete" data-id="${position.id}">删除</button>
      </div>
    </article>
  `;
}

function renderAdviceInline(position) {
  const advice = position.advice;
  if (!advice) return '';
  const triggers = (advice.triggers || [])
    .map((item) => `<span>${escapeHtml(item.label)} ${item.value}</span>`)
    .join('');
  const reasons = (advice.reasons || [])
    .map((item) => `<li><b>${escapeHtml(item.label)}：</b>${escapeHtml(item.detail)}</li>`)
    .join('');
  return `
    <div class="advice-inline tone-${escapeHtml(advice.tone)}">
      <div class="advice-inline-head">
        <span class="chip strategy">${escapeHtml(advice.strategyLabel)}</span>
        <strong>${escapeHtml(advice.verdictLabel)}</strong>
      </div>
      <p class="advice-inline-sub">${escapeHtml(advice.headline)}</p>
      <p class="advice-inline-action">${escapeHtml(advice.action)}</p>
      ${triggers ? `<div class="triggers">${triggers}</div>` : ''}
      <details class="advice-why">
        <summary>为什么这么判断</summary>
        <ul>${reasons}</ul>
      </details>
    </div>
  `;
}

function handlePositionAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (button.dataset.action === 'delete') deleteHolding(id);
  if (button.dataset.action === 'edit') openEdit(id);
}

// -------------------- 走势图 --------------------

async function loadSparklines() {
  const codes = [...new Set(state.portfolio.positions.filter((p) => p.code).map((p) => p.code))];
  for (const code of codes) {
    if (state.history.has(code) || state.sparklineLoading.has(code)) continue;
    state.sparklineLoading.add(code);
    try {
      const data = await api.history(code, 30);
      state.history.set(code, data.rows || []);
      document.querySelectorAll(`[data-spark="${code}"]`).forEach((el) => drawSpark(el, state.history.get(code)));
    } catch (error) {
      state.history.set(code, []);
    } finally {
      state.sparklineLoading.delete(code);
    }
  }
}

function drawSpark(el, rows) {
  if (!rows || !rows.length) {
    el.innerHTML = '';
    el.setAttribute('aria-label', '暂无历史净值');
    return;
  }
  const result = sparklinePath(rows, 300, 44);
  if (!result) return;
  const stroke = result.rising ? '#d92d20' : '#067647';
  el.innerHTML = `<polyline fill="none" stroke="${stroke}" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${result.points}"></polyline>`;
  el.setAttribute('aria-label', `${rows.length} 个交易日净值走势`);
}

// -------------------- 提醒 --------------------

function renderAlerts(alerts) {
  const bar = document.getElementById('alertBar');
  const list = (alerts || []).filter((a) => !a.isRead).slice(0, 4);

  if (!list.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="alert-item ${list[0].level}">
      <div>
        <strong>${escapeHtml(list[0].title)}</strong>
        <span>${escapeHtml(list[0].message || '')}</span>
      </div>
      <div class="alert-actions"><button class="btn ghost small" data-alert-action="read-all">全部已读</button></div>
    </div>
    ${list.slice(1).map((alert) => `
      <div class="alert-item ${alert.level}">
        <div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.message || '')}</span></div>
      </div>
    `).join('')}
  `;
}

async function handleAlertAction(event) {
  const button = event.target.closest('[data-alert-action]');
  if (!button) return;
  button.disabled = true;
  try {
    await api.markAlertsRead([]);
    document.getElementById('alertBar').classList.add('hidden');
    if (state.portfolio) state.portfolio.alerts = [];
    toast('提醒已标记为已读', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// -------------------- 新增持仓 --------------------

let previewTimer = null;
let lastPreview = null;

function debounce(fn, wait) {
  return (...args) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => fn(...args), wait);
  };
}

async function previewFund() {
  const input = document.getElementById('fundCode');
  const hint = document.getElementById('codeHint');
  const code = input.value.trim();
  lastPreview = null;

  if (!/^\d{6}$/.test(code)) {
    hint.textContent = code ? '需要 6 位数字' : '';
    hint.style.color = '';
    document.getElementById('preview').classList.add('hidden');
    return;
  }

  hint.textContent = '查询中…';
  hint.style.color = '';
  try {
    const data = await api.previewFund(code);
    lastPreview = data;
    hint.textContent = data.name ? `已找到：${data.name}` : '已获取净值';
    hint.style.color = '#067647';
    renderPreview(data);
  } catch (error) {
    hint.textContent = error.status === 404 ? '未找到该基金' : error.message;
    hint.style.color = '#b42318';
    document.getElementById('preview').classList.add('hidden');
  }
}

function renderPreview(data) {
  const box = document.getElementById('preview');
  const fees = data.fees;
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="row">
      <div class="kv"><span class="muted">基金</span><b>${escapeHtml(data.name)}</b></div>
      <div class="kv"><span class="muted">最新净值</span><b>${Number(data.netValue).toFixed(4)}</b></div>
      <div class="kv"><span class="muted">净值日</span><b>${escapeHtml(data.navDate || '—')}</b></div>
      <div class="kv"><span class="muted">日涨跌</span><b class="${signClass(data.growthRate)}">${data.growthRate === null ? '—' : percentFromNumber(data.growthRate)}</b></div>
      ${fees && fees.purchaseRate !== null ? `<div class="kv"><span class="muted">申购费率</span><b>${percentFromRate(fees.purchaseRate, 3)}</b></div>` : ''}
      ${fees && fees.managementRate !== null ? `<div class="kv"><span class="muted">管理费率</span><b>${percentFromRate(fees.managementRate, 2)}</b></div>` : ''}
      <button type="button" class="btn ghost small" data-preview-action="use-nav">填入最新净值</button>
    </div>
    ${data.isStale ? '<div class="muted" style="margin-top:8px">注意：这是本地缓存的历史净值，可能不是最新交易日。</div>' : ''}
  `;
}

function handlePreviewAction(event) {
  const button = event.target.closest('[data-preview-action]');
  if (!button || !lastPreview) return;
  document.getElementById('buyNetValue').value = Number(lastPreview.netValue).toFixed(4);
  toast('已填入最新净值，请核对买入净值后提交', 'success');
}

async function handleAdd(event) {
  event.preventDefault();
  const button = document.getElementById('btnAdd');
  const form = document.getElementById('addForm');
  const code = document.getElementById('fundCode').value.trim();

  if (!/^\d{6}$/.test(code)) {
    toast('基金代码必须是 6 位数字', 'error');
    return;
  }

  const payload = {
    fundCode: code,
    buyDate: document.getElementById('buyDate').value,
    buyAmount: Number(document.getElementById('buyAmount').value),
    buyNetValue: Number(document.getElementById('buyNetValue').value),
    targetProfit: Number(document.getElementById('targetProfit').value) / 100,
    stopLoss: Number(document.getElementById('stopLoss').value) / 100,
    strategy: document.getElementById('addStrategy').value,
  };

  if (!(payload.buyAmount > 0) || !(payload.buyNetValue > 0)) {
    toast('买入金额和净值必须大于 0', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = '添加中…';
  try {
    await api.addHolding(payload);
    toast('持仓已添加', 'success');
    form.reset();
    document.getElementById('buyDate').value = todayISO();
    document.getElementById('targetProfit').value = '30';
    document.getElementById('stopLoss').value = '20';
    document.getElementById('addStrategy').value = 'auto';
    document.getElementById('codeHint').textContent = '';
    document.getElementById('preview').classList.add('hidden');
    lastPreview = null;
    state.history.delete(code);
    await loadPortfolio(true, true);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '添加持仓';
  }
}

// -------------------- 想买冷静期 --------------------

function watchStatusText(item) {
  if (item.isReady) return '冷静期到了';
  if (item.coolingHours <= 1) return '不到 1 小时';
  return `还剩约 ${item.coolingHours} 小时`;
}

function renderWatchlist() {
  const box = document.getElementById('watchlistList');
  if (!box) return;
  const items = state.watchlist || [];
  if (!items.length) {
    box.innerHTML = '<div class="empty">还没有待决定的基金。先做买前体检，拿不准就加进来放 24 小时。</div>';
    return;
  }
  box.innerHTML = items.map((item) => {
    const ready = item.isReady;
    const score = item.score == null ? '未体检' : `纪律分 ${item.score}`;
    const target = item.targetNav == null ? '没设目标净值' : `目标净值 ${Number(item.targetNav).toFixed(4)}`;
    return `
      <article class="watch-card ${ready ? 'ready' : 'cooling'}">
        <div class="watch-head">
          <b>${escapeHtml(item.name || item.code)}</b>
          <span class="watch-badge ${ready ? 'ready' : ''}">${ready ? '到期可决定' : '冷静中'}</span>
        </div>
        <div class="watch-meta">${escapeHtml(item.code)} · ${escapeHtml(score)} · ${escapeHtml(target)} · <span class="watch-count">${watchStatusText(item)}</span></div>
        <p class="watch-reason">当时想买的理由：“${escapeHtml(item.reason || '')}”</p>
        <div class="watch-actions">
          <button type="button" class="btn ghost small" data-watch-action="check" data-id="${item.id}" data-code="${escapeHtml(item.code)}">${ready ? '到期，去体检' : '再体检一次'}</button>
          ${ready ? `<button type="button" class="btn primary small" data-watch-action="bought" data-id="${item.id}" data-code="${escapeHtml(item.code)}">我买了，去记账</button>` : ''}
          <button type="button" class="link-btn danger" data-watch-action="drop" data-id="${item.id}">${ready ? '不买了' : '不等了'}</button>
        </div>
      </article>
    `;
  }).join('');
}

async function loadWatchlist() {
  const box = document.getElementById('watchlistList');
  if (!box) return;
  try {
    const data = await api.watchlist();
    state.watchlist = data.items || [];
    renderWatchlist();
  } catch (error) {
    box.innerHTML = `<div class="empty">想买清单加载失败：${escapeHtml(error.message)}</div>`;
  }
}

async function handleWatchAdd(event) {
  event.preventDefault();
  const code = document.getElementById('watchCode').value.trim();
  if (!/^\d{6}$/.test(code)) {
    toast('基金代码必须是 6 位数字', 'error');
    return;
  }
  const targetNav = document.getElementById('watchNav').value.trim();
  const reason = document.getElementById('watchReason').value.trim();
  const button = document.getElementById('btnWatchAdd');
  button.disabled = true;
  button.textContent = '加入中…';
  try {
    const data = await api.addWatch({
      code,
      targetNav: targetNav || null,
      reason,
    });
    const hours = data.item?.coolingHours ?? 24;
    document.getElementById('watchlistForm').reset();
    await loadWatchlist();
    toast(`已加入冷静期，约 ${hours} 小时后到期；到点再决定，不用现在下单`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '加入冷静期';
  }
}

async function handleWatchAction(event) {
  const btn = event.target.closest('[data-watch-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const item = state.watchlist.find((row) => row.id === id);
  if (!item) return;
  const action = btn.dataset.watchAction;

  if (action === 'check') {
    closeAsk();
    askQuestion(`${item.code} 能不能买`);
    return;
  }

  if (action === 'bought') {
    await api.updateWatch(id, 'bought');
    document.getElementById('fundCode').value = item.code;
    document.getElementById('fundCode').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('buyAmount').focus();
    const panel = document.getElementById('addTitle').closest('.panel');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await loadWatchlist();
    toast('已标记为已买，接着把日期、金额和净值补上', 'success');
    return;
  }

  if (action === 'drop') {
    if (!window.confirm('确定不买了吗？会从清单移除，但这次的判断会留在数据库里。')) return;
    await api.updateWatch(id, 'dropped');
    await loadWatchlist();
    toast('已放弃，这次冲动记下了');
  }
}

// -------------------- 编辑 / 删除 --------------------

function openEdit(id) {
  const position = state.portfolio?.positions.find((p) => p.id === id);
  if (!position) return;
  document.getElementById('editId').value = String(id);
  document.getElementById('editTarget').value = String(Math.round(position.targetProfit * 100));
  document.getElementById('editStop').value = String(Math.round(position.stopLoss * 100));
  document.getElementById('editNote').value = position.note || '';
  document.getElementById('editStrategy').value = position.strategy || 'auto';
  document.getElementById('modalTitle').textContent = `编辑 ${position.name}`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('editTarget').focus();
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

async function handleEditSave(event) {
  event.preventDefault();
  const id = Number(document.getElementById('editId').value);
  const payload = {
    targetProfit: Number(document.getElementById('editTarget').value) / 100,
    stopLoss: Number(document.getElementById('editStop').value) / 100,
    note: document.getElementById('editNote').value.trim(),
    strategy: document.getElementById('editStrategy').value,
  };
  try {
    await api.updateHolding(id, payload);
    closeModal();
    toast('已保存', 'success');
    await loadPortfolio(true, true);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteHolding(id) {
  const position = state.portfolio?.positions.find((p) => p.id === id);
  const label = position ? `${position.name}（${position.code}）` : `#${id}`;
  if (!window.confirm(`确定删除这笔持仓吗？\n${label}\n删除后无法恢复。`)) return;
  try {
    await api.deleteHolding(id);
    toast('持仓已删除', 'success');
    await loadPortfolio(true, true);
    await loadReviews();
  } catch (error) {
    toast(error.message, 'error');
  }
}

// -------------------- 同步 / 复盘 --------------------

async function syncNow() {
  if (state.syncing) return;
  state.syncing = true;
  const button = document.getElementById('btnSync');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '同步中…';

  try {
    const before = await api.jobLatest('sync').catch(() => null);
    await api.sync();
    toast('同步任务已启动，正在等待净值更新', 'warn');

    const deadline = Date.now() + 90 * 1000;
    let job = null;
    while (Date.now() < deadline) {
      await sleep(2000);
      job = await api.jobLatest('sync').catch(() => null);
      if (job && job.status !== 'running' && (!before || job.id > before.id)) break;
      job = null;
    }

    if (!job) {
      toast('同步仍在进行，稍后会自动刷新', 'warn');
    } else if (job.status === 'success') {
      toast(`同步完成：成功 ${job.stats?.succeeded ?? 0} 只`, 'success');
    } else if (job.status === 'partial') {
      toast(`部分成功：失败 ${job.stats?.failed ?? 0} 只，已回退历史净值`, 'warn');
    } else if (job.status === 'skipped') {
      toast('暂无持仓，无需同步', 'warn');
    } else {
      toast(`同步失败：${job.message || '未知错误'}`, 'error');
    }

    state.history.clear();
    await loadPortfolio(true, true);
    await loadAlerts();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.syncing = false;
    button.disabled = false;
    button.textContent = original;
  }
}

async function generateReview() {
  const button = document.getElementById('btnReview');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '生成中…';
  try {
    const result = await api.generateReview(state.reviewType);
    if (result.status === 'skipped') {
      toast(result.message || '暂无持仓，无法生成复盘', 'warn');
    } else {
      toast('复盘已生成', 'success');
      await loadReviews();
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function handleReviewTab(event) {
  const tab = event.target.closest('[data-type]');
  if (!tab) return;
  state.reviewType = tab.dataset.type;
  document.querySelectorAll('#reviewTabs .tab').forEach((el) => el.classList.toggle('active', el === tab));
  loadReviews();
}



// -------------------- 复盘 → 今日建议 --------------------

function renderReviewLink() {
  const box = document.getElementById('reviewLink');
  const check = state.portfolio?.reviewCheck || state.portfolio?.advice?.reviewCheck;
  if (!box) return;
  if (!check) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const statusText = check.changed ? '情况有变' : '仍然有效';
  const rows = (check.items || []).map((item) => {
    if (item.status === 'new') {
      return `<li><b>${escapeHtml(item.name)}</b>：复盘里没有，今天新出现「${escapeHtml(item.after || '')}」</li>`;
    }
    if (item.status === 'cleared') {
      return `<li><b>${escapeHtml(item.name)}</b>：复盘时是「${escapeHtml(item.before || '')}」，今天已不在操作区</li>`;
    }
    if (item.status === 'changed') {
      return `<li><b>${escapeHtml(item.name)}</b>：复盘「${escapeHtml(item.before || '')}」→ 今天「${escapeHtml(item.after || '')}」</li>`;
    }
    return `<li><b>${escapeHtml(item.name)}</b>：还是「${escapeHtml(item.after || '')}」，按今天这条执行</li>`;
  });
  const flags = (check.newFlags || []).length
    ? `<p>新出现：${check.newFlags.map((t) => escapeHtml(t)).join('、')}</p>`
    : '';
  box.innerHTML = `
    <div class="review-link-head">
      <b>${escapeHtml(check.reviewDate || '')} 的复盘，对今天还有效吗</b>
      <span class="chip ${check.changed ? 'warn' : 'good'}">${statusText}</span>
    </div>
    <p>${escapeHtml(check.headline || '')}</p>
    ${rows.length ? `<ul>${rows.join('')}</ul>` : ''}
    ${flags}
    <p>只对比结论有没有变，不代表你昨天已经照着做了。</p>`;
  box.classList.remove('hidden');
}

// -------------------- 深度分析 --------------------

const stateAnalysis = { loaded: false, loading: false, view: 'dca', peerLoaded: false, peerLoading: false };

function initAnalysis() {
  const tabs = document.getElementById('analysisTabs');
  if (!tabs) return;
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-view]');
    if (!tab) return;
    showAnalysisView(tab.dataset.view);
  });
  document.getElementById('dcaRun').addEventListener('click', runDca);
  document.getElementById('dcaCode').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); runDca(); }
  });
  const peerRun = document.getElementById('peerRun');
  if (peerRun) {
    peerRun.addEventListener('click', runPeer);
    document.getElementById('peerCode').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); runPeer(); }
    });
  }
}

function showAnalysisView(view) {
  stateAnalysis.view = view;
  document.querySelectorAll('#analysisTabs .tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('#analysisBody .analysis-view').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.view !== view);
  });
  if (view !== 'dca' && view !== 'peer' && !stateAnalysis.loaded) loadOverview();
}

async function runPeer() {
  if (stateAnalysis.peerLoading) return;
  const code = document.getElementById('peerCode').value.trim();
  const box = document.getElementById('peerResult');
  if (!/^\d{6}$/.test(code)) {
    box.className = 'analysis-result empty';
    box.textContent = '请输入 6 位基金代码';
    return;
  }
  stateAnalysis.peerLoading = true;
  box.className = 'analysis-result empty';
  box.textContent = '正在拉取同类基金数据，首次约 10~20 秒…';
  try {
    const data = await api.peer(code);
    stateAnalysis.peerLoaded = true;
    renderPeer(data, box);
  } catch (error) {
    box.className = 'analysis-result empty';
    box.textContent = `分析失败：${error.message}`;
  } finally {
    stateAnalysis.peerLoading = false;
  }
}

function renderPeer(data, box) {
  const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
  const me = data.me;

  const rows = [
    ['近 1 年收益', pct(me.m1y), data.rank.r1, data.quantile.q1],
    ['近 3 年年化', pct(me.m3y), data.rank.r3, data.quantile.q3],
    ['最大回撤', pct(me.mdd3y), data.rank.mdd, data.quantile.qd],
  ].map(([label, value, rank, q]) => {
    const color = q >= 67 ? '#0f766e' : q >= 33 ? '#b45309' : '#b91c1c';
    const rk = rank && rank[0] ? `第 ${rank[0]}/${rank[1]}` : '样本不足';
    return `
      <div class="peer-row">
        <span class="peer-label">${label}</span>
        <span class="peer-value">${value}</span>
        <span class="peer-rank">${rk}</span>
        <span class="peer-track"><i style="width:${q || 0}%;background:${color}"></i></span>
      </div>`;
  }).join('');

  const alts = data.alternatives.length ? data.alternatives.slice(0, 3).map((a) => {
    const gap = a.gap;
    const cum = Math.pow(1 + gap, 3) - 1;
    const net = cum - data.config.roundTrip;
    const bad = net <= 0 || !a.qualified;
    const money = Math.round(net * 100000);
    const verdict = !a.qualified
      ? '成立不满 3 年或规模过小，年化被放大，<b>不能直接比</b>。'
      : bad
        ? `摩擦成本吃掉全部超额（净 ${(net * 100).toFixed(1)}%），<b>不值得换</b>。`
        : `年化差 ${(gap * 100).toFixed(1)} 个点 → 3 年累计 ${(cum * 100).toFixed(1)}%，` +
          `扣摩擦后净 <b>${(net * 100).toFixed(1)}%</b>，每 10 万约 <b>${money >= 0 ? '+' : ''}${money.toLocaleString()} 元</b>。`;
    return `
      <div class="peer-alt">
        <div class="peer-alt-head">
          <b>${escapeHtml(a.peer.name)}</b>
          <span class="code">${a.peer.code}</span>
          <span class="peer-pill">重叠 ${(a.overlap * 100).toFixed(0)}%</span>
          <span class="peer-pill">相关性 ${a.peer.corr == null ? '—' : a.peer.corr.toFixed(2)}</span>
        </div>
        <div class="peer-alt-facts">
          <span>3年年化 <b>${pct(a.peer.m3y)}</b></span>
          <span>回撤 <b>${pct(a.peer.mdd3y)}</b></span>
          <span>规模 <b>${a.peer.size ? a.peer.size.toFixed(0) + ' 亿' : '—'}</b></span>
        </div>
        <p class="peer-verdict ${bad ? 'bad' : ''}">${verdict}</p>
        ${a.caveats.length ? `<p class="peer-caveat">要留意：${escapeHtml(a.caveats.join('；'))}</p>` : ''}
      </div>`;
  }).join('') : '<div class="empty">没有重仓重叠 ≥50% 的可替代品——同类里没有「换了等于没换」的选项。</div>';

  box.className = 'analysis-result';
  box.innerHTML = `
    <div class="peer-head">
      <div>
        <b>${escapeHtml(data.name)}</b>
        <span class="hint">${data.code} · 同类 ${data.n} 只（已剔除 ${data.dropped} 只走势不像的）</span>
      </div>
      <span class="peer-quad">${escapeHtml(data.quadrant)}</span>
    </div>
    <div class="peer-rows">${rows}</div>
    <p class="analysis-tip">分位越高越好；历史不足 2.5 年的不参与 3 年排名。数据截至 ${data.as_of}</p>
    <h3 class="peer-sub">可替代与换基测算</h3>
    <p class="analysis-tip">前十大重仓重叠 ≥50% 才算「换了等于没换」。</p>
    ${alts}
    <p class="analysis-tip">历史数据，不构成投资建议。</p>`;
}

function fmtRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function fmtPlainRate(rate, digits = 2) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

async function loadOverview(force = false) {
  if (stateAnalysis.loading || (stateAnalysis.loaded && !force)) return;
  stateAnalysis.loading = true;
  const benchEl = document.getElementById('benchmarkResult');
  const attrEl = document.getElementById('attributionResult');
  if (benchEl) benchEl.innerHTML = '<div class="empty">正在拉沪深300历史行情…</div>';
  if (attrEl) attrEl.innerHTML = '<div class="empty">正在算归因…</div>';
  try {
    const data = await api.analysisOverview();
    stateAnalysis.loaded = true;
    renderBenchmark(data.benchmark, data.reason);
    renderAttribution(data.attribution, data.benchmark, data.reason);
  } catch (error) {
    if (benchEl) benchEl.innerHTML = `<div class="empty">对比加载失败：${escapeHtml(error.message)}</div>`;
    if (attrEl) attrEl.innerHTML = `<div class="empty">归因加载失败：${escapeHtml(error.message)}</div>`;
  } finally {
    stateAnalysis.loading = false;
  }
}

function renderBenchmark(bench, reason) {
  const el = document.getElementById('benchmarkResult');
  if (!el) return;
  if (!bench) {
    el.className = 'analysis-result empty';
    el.textContent = reason || '还没有持仓，先添加一笔再来对比。';
    return;
  }
  el.className = 'analysis-result';
  const win = bench.excess >= 0;
  el.innerHTML = `
    <div class="bench-head">
      <div class="bench-cell">
        <label>你的组合（真实收益）</label>
        <strong class="${signClass(bench.portfolioReturn)}">${fmtRate(bench.portfolioReturn)}</strong>
        <small>按买入金额加权</small>
      </div>
      <div class="bench-cell">
        <label>沪深300 同期</label>
        <strong class="${signClass(bench.indexReturn)}">${fmtRate(bench.indexReturn)}</strong>
        <small>指数截至 ${escapeHtml(bench.toDate || '')}${bench.fromDate && bench.fromDate > bench.toDate ? '（买入日未收盘）' : ''}</small>
      </div>
      <div class="bench-cell">
        <label>超额</label>
        <strong class="${signClass(bench.excess)}">${fmtRate(bench.excess)}</strong>
        <small>${win ? '跑赢大盘' : '跑输大盘'}</small>
      </div>
    </div>
    <div class="analysis-verdict">
      ${win
        ? `同期你比沪深300多赚了 ${fmtPlainRate(Math.abs(bench.excess))}，这部分是选基带来的。`
        : `同期你比沪深300少赚了 ${fmtPlainRate(Math.abs(bench.excess))}。不是大盘的问题，是你选的基金没跟上。`}
      逐笔对比看下表，超额金额按你的买入金额估算。
    </div>
    <div class="analysis-table-wrap">
      <table class="analysis-table">
        <thead><tr><th>基金</th><th>买入日</th><th>你的收益</th><th>指数同期</th><th>超额</th><th>金额</th></tr></thead>
        <tbody>
          ${(bench.perPosition || []).map((item) => `
            <tr>
              <td>${escapeHtml(item.name)}<br><span class="muted">${escapeHtml(item.code)}</span></td>
              <td>${escapeHtml(item.buyDate || '—')}</td>
              <td class="${signClass(item.realRate)}">${fmtRate(item.realRate)}</td>
              <td class="${signClass(item.indexReturn)}">${fmtRate(item.indexReturn)}</td>
              <td class="${signClass(item.excess)}">${fmtRate(item.excess)}</td>
              <td class="${signClass(item.excessAmount)}">${signedMoney(item.excessAmount)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderAttribution(attr, bench, reason) {
  const el = document.getElementById('attributionResult');
  if (!el) return;
  if (!attr || !attr.rows || !attr.rows.length) {
    el.className = 'analysis-result empty';
    el.textContent = reason || '还没有持仓，先添加一笔再来看归因。';
    return;
  }
  el.className = 'analysis-result';
  const feeTotal = (attr.totalPurchaseFee || 0) + (attr.totalRedemptionFee || 0);
  const best = attr.rows[0];
  const worst = attr.rows[attr.rows.length - 1];
  el.innerHTML = `
    <div class="analysis-stats">
      <div class="analysis-stat"><label>累计投入</label><strong>¥${money(attr.totalInvest)}</strong><span>${attr.rows.length} 只基金</span></div>
      <div class="analysis-stat"><label>账面盈亏</label><strong class="${signClass(attr.totalBookProfit)}">${signedMoney(attr.totalBookProfit)}</strong><span>没算费用</span></div>
      <div class="analysis-stat"><label>费用合计</label><strong class="neg">¥${money(feeTotal)}</strong><span>申购 + 假设现在赎回</span></div>
      <div class="analysis-stat"><label>净收益</label><strong class="${signClass(attr.totalNetProfit)}">${signedMoney(attr.totalNetProfit)}</strong><span>${fmtRate(attr.totalNetRate)}</span></div>
    </div>
    <div class="analysis-verdict">
      ${best ? `${escapeHtml(best.name)} 贡献最多（${signedMoney(best.netProfit)}）` : ''}${worst && worst !== best ? `，${escapeHtml(worst.name)} 拖后腿（${signedMoney(worst.netProfit)}）` : ''}。
      费用吃掉约 ¥${money(feeTotal)}，短期赎回尤其贵；持有时间越短，赎回费越高。
    </div>
    <div class="analysis-table-wrap">
      <table class="analysis-table">
        <thead><tr><th>基金</th><th>账面盈亏</th><th>申购费</th><th>赎回费</th><th>净收益</th><th>占投入</th><th>相对指数</th></tr></thead>
        <tbody>
          ${attr.rows.map((item) => `
            <tr>
              <td>${escapeHtml(item.name)}<br><span class="muted">${escapeHtml(item.code)}</span></td>
              <td class="${signClass(item.bookProfit)}">${signedMoney(item.bookProfit)}</td>
              <td>¥${money(item.purchaseFee)}</td>
              <td>¥${money(item.redemptionFee)}</td>
              <td class="${signClass(item.netProfit)}">${signedMoney(item.netProfit)}</td>
              <td>${fmtPlainRate(item.weight, 1)}</td>
              <td class="${item.excess === null ? '' : signClass(item.excess)}">${item.excess === null ? '—' : fmtRate(item.excess)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="analysis-tip">“相对指数”只在拉到沪深300 对比后才有；它回答的是：这只基金本身有没有跑赢大盘。</p>`;
}

async function runDca() {
  const btn = document.getElementById('dcaRun');
  const code = document.getElementById('dcaCode').value.trim();
  const amount = Number(document.getElementById('dcaAmount').value);
  const months = Number(document.getElementById('dcaMonths').value);
  const box = document.getElementById('dcaResult');
  if (!/^\d{6}$/.test(code)) { toast('基金代码要 6 位数字', 'error'); return; }
  if (!Number.isFinite(amount) || amount < 100) { toast('每月金额至少 100 元', 'error'); return; }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测算中…';
  box.className = 'analysis-result empty';
  box.textContent = '正在拉这只基金的历史净值并逐月模拟…';
  try {
    const data = await api.analysisDca(code, amount, months);
    if (!data.ok) {
      box.textContent = data.reason || '这只基金历史数据不够，算不了。';
      return;
    }
    renderDca(data);
  } catch (error) {
    box.textContent = `测算失败：${error.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderDca(data) {
  const box = document.getElementById('dcaResult');
  box.className = 'analysis-result';
  const better = data.dcaEdge >= 0;
  box.innerHTML = `
    <div class="analysis-stats">
      <div class="analysis-stat"><label>累计投入</label><strong>¥${money(data.invested)}</strong><span>${data.purchases} 期 · 每月 ¥${money(data.monthlyAmount, 0)}</span></div>
      <div class="analysis-stat"><label>期末市值</label><strong>¥${money(data.finalValue)}</strong><span>${escapeHtml(data.toDate || '')} 净值 ${data.latestNav}</span></div>
      <div class="analysis-stat"><label>净收益</label><strong class="${signClass(data.profit)}">${signedMoney(data.profit)}</strong><span>${fmtRate(data.profitRate)}</span></div>
      <div class="analysis-stat"><label>最大回撤</label><strong class="neg">${fmtRate(data.maxDrawdown)}</strong><span>过程中最难受的一段</span></div>
    </div>
    <div class="analysis-verdict">
      从 ${escapeHtml(data.fromDate || '')} 起每月投 ¥${money(data.monthlyAmount, 0)}，投了 ${data.purchases} 期：
      现在 ${signedMoney(data.profit)}（${fmtRate(data.profitRate)}）。
      同样的钱如果一开始一次性买入，是 ${fmtRate(data.lumpSum.rate)}；
      ${better ? `定投多赚了 ${fmtPlainRate(Math.abs(data.dcaEdge))}。` : `定投反而少赚了 ${fmtPlainRate(Math.abs(data.dcaEdge))}，这只基金这段时间是单边上涨。`}
      ${data.positiveMonths} 期买点低于现价，${data.negativeMonths} 期买贵了。
    </div>
    <div class="analysis-table-wrap">
      <table class="analysis-table">
        <thead><tr><th>买入日</th><th>净值</th><th>累计投入</th><th>当期市值</th><th>累计收益率</th></tr></thead>
        <tbody>
          ${data.monthly.map((item) => `
            <tr>
              <td>${escapeHtml(item.date)}</td>
              <td>${item.netValue}</td>
              <td>¥${money(item.invested)}</td>
              <td>¥${money(item.valueAtBuy)}</td>
              <td class="${signClass(item.rateAtBuy)}">${fmtRate(item.rateAtBuy)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="analysis-tip">历史回测，不含未来判断；申购费已扣，赎回费没算。每月只投固定金额，不预测高低点。</p>`;
}

// -------------------- 手机访问 --------------------

function initMobileAccess() {
  const box = document.getElementById('mobileAccess');
  if (box) {
    box.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-copy]');
      if (!btn) return;
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('地址已复制');
      } catch (error) {
        toast('复制失败，长按地址手动复制', 'error');
      }
    });
  }
}

function renderMobileAccess() {
  const box = document.getElementById('mobileAccess');
  if (!box) return;
  const meta = state.meta;
  if (!meta) return;
  const lan = meta.lanUrls || [];
  const primary = lan.length ? lan[0].url : '';
  const others = lan.slice(1);
  const isLocalhost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  const current = isLocalhost && primary ? primary : window.location.origin;

  box.innerHTML = `
    <div class="mobile-url">
      <span>${escapeHtml(current)}</span>
      <button type="button" class="link-btn" data-copy="${escapeHtml(current)}">复制</button>
    </div>
    ${others.length ? `<p class="mobile-note">本机还有：${others.map((item) => `<code>${escapeHtml(item.url)}</code>`).join('、')}</p>` : ''}
    <ol class="mobile-steps">
      <li><b>同一个 Wi-Fi</b>：手机连家里的 Wi-Fi，浏览器输入上面的地址，就能看到和电脑一样的页面。</li>
      <li><b>加到手机桌面</b>：Safari 点分享 → 添加到主屏幕；安卓 Chrome 点右上角 → 添加到主屏幕。以后点图标直接进，像 App。</li>
      <li><b>在外网（不买服务器）</b>：电脑和手机都装 <b>Tailscale</b>，用同一个账号登录；然后手机浏览器打开 <code>100.x.x.x:${meta.port || 3000}</code>。电脑上运行 <code>tailscale ip -4</code> 就能看到这个地址，免费、不用端口映射。</li>
    </ol>
    <p class="mobile-note">前提只有一个：电脑开机、这个服务在跑。电脑关机或关了窗口，手机就打不开——这是“不买服务器”的代价。页面是 PWA，加到桌面后能全屏，但离线看不了实时数据。</p>`;
}

// -------------------- AI 设置 --------------------

const AI_PRESETS = {
  doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615', label: '豆包方舟' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '通义千问' },
};
let aiConfig = null;

function initAiSettings() {
  document.getElementById('aiClose').addEventListener('click', closeAiSettings);
  document.getElementById('aiModal').addEventListener('click', (event) => {
    if (event.target.id === 'aiModal') closeAiSettings();
  });
  document.getElementById('aiPreset').addEventListener('change', (event) => {
    const preset = AI_PRESETS[event.target.value];
    if (!preset) return;
    document.getElementById('aiBaseUrl').value = preset.baseUrl;
    document.getElementById('aiModel').value = preset.model;
    setAiStatus(`已填入${preset.label}的地址和模型，填上 Key 后保存即可。`, '');
  });
  document.getElementById('aiSave').addEventListener('click', saveAiSettings);
  document.getElementById('aiTest').addEventListener('click', testAi);
  document.getElementById('aiClear').addEventListener('click', clearAiKey);
}

async function openAiSettings() {
  document.getElementById('aiModal').classList.remove('hidden');
  setAiStatus('正在读取当前配置…', '');
  try {
    aiConfig = await api.aiGet();
    fillAiForm(aiConfig);
    renderAiStatus(aiConfig);
  } catch (error) {
    setAiStatus(`读取失败：${error.message}`, 'err');
  }
}

function closeAiSettings() {
  document.getElementById('aiModal').classList.add('hidden');
}

function fillAiForm(config) {
  document.getElementById('aiBaseUrl').value = config.baseUrl || '';
  document.getElementById('aiModel').value = config.model || '';
  document.getElementById('aiKey').value = '';
  document.getElementById('aiPreset').value = AI_PRESETS[config.provider] ? config.provider : '';
}

function renderAiStatus(config) {
  if (!config) return;
  const keyText = config.hasKey ? `Key ${config.keyMasked}` : '还没有 Key';
  const source = config.keySource === 'env' ? '（来自 .env）' : config.keySource === 'db' ? '（已保存在本机）' : '';
  if (config.ready) {
    setAiStatus(`已配置：${config.provider || '自定义'} · ${config.model} · ${keyText}${source}。问一问会优先用 AI，失败自动回退规则。`, 'ok');
  } else if (config.hasKey && !config.baseUrl) {
    setAiStatus('有 Key 但没填接口地址，AI 还用不了。', 'warn');
  } else if (!config.hasKey && config.baseUrl) {
    setAiStatus(`接口和模型已填好，但缺 API Key。补上 Key 并保存后即可启用；不填也能用本地规则。`, 'warn');
  } else {
    setAiStatus('未配置 AI：问一问用本地规则回答，照样能体检、看纪律线。想自由切换 AI，选个预设、填 Key、保存。', '');
  }
}

function setAiStatus(text, type) {
  const el = document.getElementById('aiStatus');
  el.textContent = text;
  el.className = `ai-state ${type || ''}`.trim();
}

function aiPayload(extra = {}) {
  const baseUrl = document.getElementById('aiBaseUrl').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  const apiKey = document.getElementById('aiKey').value.trim();
  const preset = document.getElementById('aiPreset').value;
  const body = { baseUrl, model, provider: preset || (aiConfig?.provider || 'custom'), ...extra };
  if (apiKey) body.apiKey = apiKey;
  return body;
}

async function saveAiSettings() {
  const btn = document.getElementById('aiSave');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    aiConfig = await api.aiSave(aiPayload());
    fillAiForm(aiConfig);
    renderAiStatus(aiConfig);
    document.getElementById('aiKey').value = '';
    toast(aiConfig.ready ? 'AI 已启用，下一句提问就生效' : '已保存，当前仍用本地规则');
  } catch (error) {
    setAiStatus(`保存失败：${error.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function testAi() {
  const btn = document.getElementById('aiTest');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测试中…';
  setAiStatus('正在发一句最小对话给模型…', '');
  try {
    const result = await api.aiTest();
    setAiStatus(`连接成功：${result.model}，往返 ${result.ms}ms，模型回复「${result.reply}」。`, 'ok');
  } catch (error) {
    setAiStatus(`连接失败：${error.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function clearAiKey() {
  if (!window.confirm('确定清除已保存的 AI Key？清除后问一问回到本地规则。')) return;
  try {
    aiConfig = await api.aiSave({ clearKey: true });
    document.getElementById('aiKey').value = '';
    renderAiStatus(aiConfig);
    toast('已清除 Key');
  } catch (error) {
    setAiStatus(`清除失败：${error.message}`, 'err');
  }
}

// -------------------- 问一问 --------------------

const ASK_CHIPS = ['110022 能不能买', '现在该卖吗', '我的仓位有问题吗', '赎回费怎么算'];

function initAsk() {
  initAiSettings();
  renderAskChips();
  const styleSelect = document.getElementById('askStyle');
  if (styleSelect) {
    styleSelect.value = answerStyle();
    styleSelect.addEventListener('change', () => {
      try {
        localStorage.setItem(ASK_STYLE_KEY, styleSelect.value);
      } catch (error) {
        /* localStorage 不可用时只在本次生效 */
      }
      toast(styleSelect.value === 'brief' ? '已切换为直接结论' : '已切换为详细教练');
    });
  }
  document.getElementById('askFab').addEventListener('click', openAsk);
  document.getElementById('askClose').addEventListener('click', closeAsk);
  document.getElementById('askMask').addEventListener('click', closeAsk);
  document.getElementById('askForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('askInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    askQuestion(text);
  });
  document.getElementById('askQuick').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-q]');
    if (chip) askQuestion(chip.dataset.q);
  });
  document.getElementById('askMessages').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-watch-add]');
    if (!btn) return;
    document.getElementById('watchCode').value = btn.dataset.code || '';
    document.getElementById('watchNav').value = '';
    document.getElementById('watchReason').value = '';
    closeAsk();
    document.getElementById('watchCode').closest('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('watchReason').focus(), 300);
    toast('代码已带入，写一句为什么想买，再点加入冷静期');
  });
  const checkButton = document.getElementById('btnCheckBuy');
  if (checkButton) checkButton.addEventListener('click', handleCheckBuy);
}

function renderAskChips() {
  const box = document.getElementById('askQuick');
  box.innerHTML = ASK_CHIPS
    .map((text) => `<button type="button" class="ask-chip" data-q="${escapeHtml(text)}">${escapeHtml(text)}</button>`)
    .join('');
}

function openAsk() {
  document.getElementById('askPanel').classList.remove('hidden');
  if (window.innerWidth <= 720) document.getElementById('askMask').classList.remove('hidden');
  state.ask.open = true;
  if (!state.ask.greeted) {
    state.ask.greeted = true;
    appendAsk('bot', '买之前先发我 6 位基金代码，我帮你体检；也可以问「现在该卖吗」「我的仓位有问题吗」。我只按你的持仓和纪律线回答，不预测涨跌。右上角“AI 设置”可以随时切换模型，配了 Key 我会用 AI 说得更细。', { title: '我能做什么' });
  }
  setTimeout(scrollAskBottom, 0);
}

function closeAsk() {
  document.getElementById('askPanel').classList.add('hidden');
  document.getElementById('askMask').classList.add('hidden');
  state.ask.open = false;
}

function scrollAskBottom() {
  const box = document.getElementById('askMessages');
  box.scrollTop = box.scrollHeight;
}

function setAskBusy(busy) {
  state.ask.busy = busy;
  const send = document.getElementById('askSend');
  send.disabled = busy;
  send.textContent = busy ? '回答中…' : '发送';
}

function appendAsk(role, text, meta = {}) {
  const list = document.getElementById('askMessages');
  const row = document.createElement('div');
  row.className = `ask-msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'ask-bubble';
  if (role === 'bot' && meta.title) {
    const title = document.createElement('strong');
    title.textContent = meta.title;
    bubble.appendChild(title);
  }
  const body = document.createElement('p');
  body.textContent = text;
  bubble.appendChild(body);
  if (meta.check) {
    bubble.insertAdjacentHTML('beforeend', renderCheckCard(meta.check));
  }
  if (meta.modeLabel) {
    const tag = document.createElement('span');
    tag.className = 'ask-tag';
    tag.textContent = meta.modeLabel;
    bubble.appendChild(tag);
  }
  row.appendChild(bubble);
  list.appendChild(row);
  scrollAskBottom();
  return row;
}

function appendTyping() {
  const list = document.getElementById('askMessages');
  const row = document.createElement('div');
  row.className = 'ask-msg bot';
  row.innerHTML = '<div class="ask-bubble typing">正在按你的数据算…</div>';
  list.appendChild(row);
  scrollAskBottom();
  return row;
}

function renderConstitutionBlock(constitution) {
  if (!constitution || !constitution.enabled) return '';
  const failed = (constitution.rules || []).filter((item) => item.applicable && !item.passed);
  return `
    <div class="check-constitution ${constitution.passed ? '' : 'block'}">
      <div class="check-constitution-head">
        <b>投资宪法</b>
        <span>${constitution.passed ? '通过' : '不通过'}</span>
      </div>
      <p>${escapeHtml(constitution.headline || '')}</p>
      ${failed.length ? `<ul>${failed.map((item) => `<li><b>${escapeHtml(item.label)}</b>：${escapeHtml(item.detail)}</li>`).join('')}</ul>` : ''}
    </div>
  `;
}

function renderCheckCard(check) {
  const score = check.score === null || check.score === undefined ? null : Number(check.score);
  const tone = ['good', 'warn', 'danger', 'info'].includes(check.tone) ? check.tone : 'info';
  const constitution = check.constitution;
  const blocked = Boolean(constitution && constitution.enabled && !constitution.passed);
  const displayTone = blocked ? 'danger' : tone;
  const displayLabel = blocked ? '宪法不通过' : (check.gradeLabel || '');
  const reasons = (check.reasons || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const risks = (check.risks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const plan = check.plan
    ? `<div class="check-plan"><b>怎么买</b>${check.plan.lines.map((line) => `· ${escapeHtml(line)}`).join('<br>')}</div>`
    : '';
  const firstAmount = Number(check.plan?.firstAmount || 0);
  const stopLoss = Number(check.plan?.stopLoss || 0);
  const riskMoney = firstAmount > 0 && stopLoss > 0
    ? `<div class="check-money">先买 ${firstAmount} 元，若触发 -${Math.round(stopLoss * 100)}% 止损，约亏 ${Math.round(firstAmount * stopLoss * 100) / 100} 元。这个数能接受，再决定买。</div>`
    : '';
  return `
    <div class="check-card ${blocked ? 'const-blocked' : ''}">
      <div class="check-head">
        <b>${escapeHtml(check.name || '')}</b>
        <span class="chip ${displayTone}">${escapeHtml(displayLabel)}</span>
      </div>
      ${score === null ? '' : `<div class="check-score">纪律分 ${score}/100</div><div class="check-bar"><i class="${displayTone}" style="width:${Math.max(2, Math.min(100, score))}%"></i></div>`}
      <ul class="check-list">${reasons}</ul>
      ${risks ? `<ul class="check-list">${risks}</ul>` : ''}
      ${renderConstitutionBlock(constitution)}
      ${blocked ? '' : plan}
      ${blocked ? '' : riskMoney}
      ${check.code ? `<button type="button" class="btn ghost check-watch-btn" data-watch-add data-code="${escapeHtml(check.code)}" data-name="${escapeHtml(check.name || '')}">${blocked ? '先放 24 小时（宪法未过）' : '先放 24 小时再决定'}</button>` : ''}
    </div>
  `;
}

async function askQuestion(text) {
  const question = String(text || '').trim();
  if (!question || state.ask.busy) return;
  openAsk();
  appendAsk('user', question);
  setAskBusy(true);
  const typing = appendTyping();
  try {
    const result = await api.assistantAsk(question, null, answerStyle());
    typing.remove();
    appendAsk('bot', result.answer, {
      title: result.title,
      modeLabel: result.mode === 'ai' ? 'AI 回答' : '本地规则回答',
      check: result.check,
    });
    setText('askMode', result.aiReady ? 'AI 已接入，回答由模型生成' : '本地规则 · 配 Key 可接 AI');
  } catch (error) {
    typing.remove();
    appendAsk('bot', `出错了：${error.message}`);
  } finally {
    setAskBusy(false);
  }
}

function handleCheckBuy() {
  const code = document.getElementById('fundCode').value.trim();
  if (!/^\d{6}$/.test(code)) {
    toast('先填写 6 位基金代码，再点买前体检', 'warn');
    document.getElementById('fundCode').focus();
    return;
  }
  askQuestion(`${code} 能不能买`);
}

// -------------------- 通用 --------------------

function renderNoticeFromPortfolio() {
  const notices = [];
  const portfolio = state.portfolio;
  if (!portfolio) return;

  if (portfolio.meta.unpricedCount > 0) {
    notices.push({ type: 'error', text: `有 ${portfolio.meta.unpricedCount} 笔持仓拿不到净值，卡片里用的是买入净值估算，结论不可直接用于决策。` });
  }
  if (portfolio.meta.staleCount > 0) {
    notices.push({ type: 'warn', text: `有 ${portfolio.meta.staleCount} 笔持仓用了历史净值（数据未更新），收益为估算值。` });
  }
  if (!state.meta?.tradingDay) {
    notices.push({ type: 'info', text: '今天不是交易日，净值不会更新；页面显示的是最近一个交易日的净值。' });
  }
  showNotice(notices);
}

let noticeTimer = null;
function showNotice(items) {
  const bar = document.getElementById('noticeBar');
  clearTimeout(noticeTimer);

  if (!items.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  bar.className = `notice ${items[0].type}`;
  bar.innerHTML = items.map((item) => `<div>${escapeHtml(item.text)}</div>`).join('');
}

function clearNotice() {
  const bar = document.getElementById('noticeBar');
  bar.classList.add('hidden');
  bar.innerHTML = '';
}

let toastTimer = null;
function toast(message, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 3200);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return el;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 主导航标签页切换
// ============================================================

function initTabNavigation() {
  const tabs = document.querySelectorAll('.main-tab');
  const sections = document.querySelectorAll('section[data-page]');
  
  // 默认显示总览页
  sections.forEach(section => {
    section.classList.toggle('active', section.dataset.page === 'overview');
  });
  
  // 标签页点击事件
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPage = tab.dataset.page;
      
      // 更新激活状态
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 显示/隐藏对应页面
      sections.forEach(section => {
        section.classList.toggle('active', section.dataset.page === targetPage);
      });
      
      // 滚动到顶部
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

