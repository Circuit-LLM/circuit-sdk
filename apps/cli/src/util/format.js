// Pure formatting helpers — numbers, money, time, mints. No colour here.

export function num(n, dp = 2) {
  if (n == null || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

// Compact money: $1.2M / $34k / $12.34 / $0.00004321
export function money(n, { sign = '$' } = {}) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${(n / 1e3).toFixed(1)}k`;
  if (a >= 1) return `${sign}${n.toFixed(2)}`;
  if (a === 0) return `${sign}0`;
  return `${sign}${n.toPrecision(3)}`;
}

export function pct(n, dp = 2) {
  if (n == null || !isFinite(n)) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(dp)}%`;
}

export function tokenAmount(n, dp = 4) {
  if (n == null || !isFinite(n)) return '—';
  if (n === 0) return '0';
  if (Math.abs(n) >= 1) return num(n, dp);
  return n.toPrecision(4);
}

export function shortMint(m, head = 4, tail = 4) {
  if (!m) return '—';
  return m.length <= head + tail + 1 ? m : `${m.slice(0, head)}…${m.slice(-tail)}`;
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
