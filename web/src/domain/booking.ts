import type { Item } from "./schema";

/* Kai's rule (2026-11-02): what needs booking but is not booked always shows a warning icon. */

export type BookingFlag = { level: "required" | "recommended"; label: "未訂票" | "未訂位" | "未訂房" | "確認中" | "上車地點待確認" };

export function bookingFlag(i: Pick<Item, "name" | "book" | "status" | "cat" | "flag">): BookingFlag | null {
  if (i.flag && i.status !== "confirmed") return { level: "required", label: i.flag === "pending" ? "確認中" : "上車地點待確認" };
  if (!i.book || i.book === "none" || i.status === "confirmed") return null;
  const label = i.name.startsWith("住宿：") ? "未訂房" : i.cat === "food" ? "未訂位" : "未訂票";
  return { level: i.book, label };
}

/** The ⚠ opens this page while the item still needs booking; an awaited order or pickup has nothing left to book. */
export function bookingHref(i: Pick<Item, "name" | "book" | "status" | "cat" | "flag" | "bookingUrl">): string | null {
  const flag = bookingFlag(i);
  return flag && flag.label.startsWith("未訂") && i.bookingUrl ? i.bookingUrl : null;
}

/** The calendar title's warning, in English like the rest of the calendar. */
export function calendarPrefix(i: Pick<Item, "name" | "book" | "status" | "cat" | "flag">): string {
  const flag = bookingFlag(i);
  if (flag?.level !== "required") return "";
  return flag.label === "確認中" ? "⚠ Pending confirmation: " : flag.label === "上車地點待確認" ? "⚠ Pickup to confirm: " : "⚠ Not booked: ";
}
