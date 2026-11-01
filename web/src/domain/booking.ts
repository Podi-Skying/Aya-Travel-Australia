import type { Item } from "./schema";

/* Kai's rule (2026-11-02): what needs booking but is not booked always shows a warning icon. */

export type BookingFlag = { level: "required" | "recommended"; label: "未訂票" | "未訂位" | "未訂房" };

export function bookingFlag(i: Pick<Item, "name" | "book" | "status" | "cat">): BookingFlag | null {
  if (!i.book || i.book === "none" || i.status === "confirmed") return null;
  const label = i.name.startsWith("住宿：") ? "未訂房" : i.cat === "food" ? "未訂位" : "未訂票";
  return { level: i.book, label };
}
