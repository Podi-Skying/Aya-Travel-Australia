/* Display helpers ported from site/js/app.js. Dates are calendar dates without a time zone. */

export const WD = ["日", "一", "二", "三", "四", "五", "六"];

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function weekday(s: string): number {
  return parseDate(s).getDay();
}

export function fmtMD(s: string): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDay(s: string): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

export function money(n: number): string {
  return "AUD $" + Math.round(n).toLocaleString("en-AU");
}

export function mins(m: number | undefined): string {
  if (!m) return "0 分";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return (h ? h + " 小時" : "") + (r ? r + " 分" : "");
}

export function fmtTs(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function todayStr(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function dayDiff(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}
