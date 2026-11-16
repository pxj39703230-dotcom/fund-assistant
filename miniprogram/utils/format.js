function num(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function money(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '¥—';
  return `¥${n.toFixed(digits)}`;
}

function signedMoney(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '¥—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—%';
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—%';
  const v = (n * 100).toFixed(digits);
  return `${n > 0 ? '+' : ''}${v}%`;
}

function signedPctRaw(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—%';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'neutral';
  return n > 0 ? 'positive' : 'negative';
}

function shortDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function dateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { num, money, signedMoney, pct, signedPct, signedPctRaw, tone, shortDate, dateTime };
