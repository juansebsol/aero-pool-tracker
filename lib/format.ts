import { formatUnits } from 'viem';
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export function amount(value: string | null, decimals: number | null) {
  if (value === null) return '—';
  if (decimals === null) return `${value} raw units`;
  const formatted = formatUnits(BigInt(value), decimals);
  const n = Number(formatted);
  if (!Number.isFinite(n) || (n !== 0 && Math.abs(n) < 0.0001)) return formatted;
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
export function age(timestamp: number, now: number) {
  const s = Math.max(0, Math.floor(now / 1000) - timestamp);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"','""')}"`;
}
