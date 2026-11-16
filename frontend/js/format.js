const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 所有进入 innerHTML 的外部字符串（基金名、备注、复盘内容）都必须先过这里 */
export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function money(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signedMoney(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}¥${abs}`;
}

/** rate 是小数（0.169 -> +16.90%） */
export function percentFromRate(rate, digits = 2) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

/** value 已经是百分数（2.35 -> +2.35%） */
export function percentFromNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function signClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shortDate(value) {
  if (!value) return '—';
  return String(value).slice(5);
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const PALETTE = ['#0e7490', '#7c3aed', '#b45309', '#0f766e', '#be123c', '#1d4ed8', '#4d7c0f', '#a16207'];

export function colorAt(index) {
  return PALETTE[index % PALETTE.length];
}

/** 生成 30 日净值折线（SVG path），数据不足时返回空 */
export function sparklinePath(rows, width = 300, height = 44) {
  if (!Array.isArray(rows) || rows.length < 2) return '';
  const values = rows.map((row) => Number(row.netValue)).filter((n) => Number.isFinite(n));
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = (index * step).toFixed(2);
    const y = (height - 4 - ((value - min) / span) * (height - 8)).toFixed(2);
    return `${x},${y}`;
  });
  return { points: points.join(' '), rising: values[values.length - 1] >= values[0] };
}
