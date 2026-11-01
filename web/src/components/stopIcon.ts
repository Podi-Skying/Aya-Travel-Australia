import { isLogistics } from "@/domain/day-title";
import type { Item } from "@/domain/schema";
import { MODE_ICON } from "./Icon";
import { CATEGORY_META } from "./Places";

/** The picture for a stop with no photo: what it is, else how you get there. */
export function iconOf(i?: Item): string {
  if (!i) return "calendar";
  if (i.name.startsWith("住宿：")) return "bed";
  if (/熱氣球|balloon/i.test(`${i.name} ${i.en ?? ""}`)) return "balloon";
  if (/酒莊|winery/i.test(`${i.name} ${i.en ?? ""}`)) return "glass";
  if (isLogistics(i)) return MODE_ICON[i.mode] ?? "route";
  return i.cat ? CATEGORY_META[i.cat].icon : (MODE_ICON[i.mode] ?? "pin");
}
