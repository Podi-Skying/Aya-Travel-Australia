import { getLang } from "@/i18n/current";

/* Display helpers ported from site/js/app.js. Dates are calendar dates without a time zone. */

export const WD = ["日", "一", "二", "三", "四", "五", "六"];
const WD_L = { zh: WD, en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], ja: ["日", "月", "火", "水", "木", "金", "土"] };

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
  const l = getLang();
  return l === "en" ? `${WD_L.en[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}` : `${d.getMonth() + 1}/${d.getDate()}（${WD_L[l][d.getDay()]}）`;
}

export function money(n: number): string {
  return "AUD $" + Math.round(n).toLocaleString("en-AU");
}

export function mins(m: number | undefined): string {
  const l = getLang();
  const [H, M] = l === "en" ? [" h", " min"] : l === "ja" ? ["時間", "分"] : [" 小時", " 分"];
  if (!m) return "0" + M;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return (h ? h + H : "") + (h && r && l === "en" ? " " : "") + (r ? r + M : "");
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
