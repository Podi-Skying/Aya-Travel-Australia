import { CATEGORIES, MODES, PRIORITIES, COST_STATUS, COST_UNITS, COST_CATS, TIME_RE, validWindow } from "./schema";
import type { Cost, Day, Item, Package, TripDoc } from "./schema";
import { effectiveDay } from "./effective-day";
import { fmtDay } from "./format";

/*
 * Owner operations. Each takes the current document and returns a new document
 * plus a version summary, or an error with an HTTP status. The server applies
 * them and stores the result as a new version (PLAN.md 4.5, 4.9).
 */

export type OpResult = { ok: true; doc: TripDoc; summary: string } | { ok: false; status: 400 | 404; error: string };

export type Op =
  | { op: "setPriority"; date: string; itemId: string; pri: string }
  | { op: "toggleVerify"; date: string; itemId: string; today: string }
  | { op: "confirmDriver"; date: string; window: string }
  | { op: "clearDriver"; date: string }
  | { op: "setPartySize"; partySize: number }
  | { op: "setParticipants"; date: string; costIndex: number; participants: number }
  | { op: "editItem"; date: string; itemId: string; fields: ItemFields }
  | { op: "addItem"; date: string; fields: ItemFields; newId: string }
  | { op: "removeItem"; date: string; itemId: string; confirmMustName?: string }
  | { op: "schedulePackage"; key: string; date: string }
  | { op: "scheduleItem"; key: string; itemId: string; date: string }
  | { op: "unscheduleItem"; date: string; itemId: string }
  | { op: "snapshot"; summary: string };

export type ItemFields = {
  time?: string;
  dur?: number;
  name?: string;
  note?: string;
  mode?: string;
  cost?: { amount: number; unit: string; status: string; cat?: string } | null;
  /** Owner-supplied photo URL; empty string removes the photo. */
  photoUrl?: string;
  /** Place category; empty string removes it. */
  cat?: string;
};

const clone = <T>(o: T): T => structuredClone(o);
const err = (status: 400 | 404, error: string): OpResult => ({ ok: false, status, error });

function findDay(doc: TripDoc, date: string): Day | undefined {
  return doc.days.find((d) => d.date === date);
}

function findItem(day: Day, itemId: string): Item | undefined {
  return day.items.find((i) => i.id === itemId);
}

function sortItems(day: Day) {
  day.items.sort((a, b) => a.time.localeCompare(b.time));
}

function applyFields(it: Item, f: ItemFields): string | null {
  if (f.time !== undefined) {
    if (!TIME_RE.test(f.time)) return "時間需為 00:00–23:59";
    it.time = f.time;
  }
  if (f.dur !== undefined) {
    if (!Number.isInteger(f.dur) || f.dur < 0 || f.dur > 1440) return "停留時間不正確";
    it.dur = f.dur;
  }
  if (f.name !== undefined) {
    const n = f.name.trim();
    if (!n || n.length > 120) return "活動名稱需為 1–120 字";
    it.name = n;
  }
  if (f.note !== undefined) {
    const n = f.note.trim();
    if (n.length > 500) return "備註最多 500 字";
    if (n) it.note = n;
    else delete it.note;
  }
  if (f.mode !== undefined) {
    if (!(MODES as readonly string[]).includes(f.mode)) return "交通方式不正確";
    it.mode = f.mode as Item["mode"];
  }
  if (f.photoUrl !== undefined && f.photoUrl.trim() !== (it.photo?.url ?? "")) {
    const u = f.photoUrl.trim();
    if (!u) delete it.photo;
    else {
      let url: URL;
      try {
        url = new URL(u);
      } catch {
        return "照片網址不正確";
      }
      if (url.protocol !== "https:" || u.length > 2000) return "照片網址需為 https 開頭";
      it.photo = { url: u, page: u, site: url.hostname.replace(/^www\./, ""), kind: "custom" };
    }
  }
  if (f.cat !== undefined) {
    if (!f.cat) delete it.cat;
    else if (!(CATEGORIES as readonly string[]).includes(f.cat)) return "分類不正確";
    else it.cat = f.cat as Item["cat"];
  }
  if (f.cost !== undefined) {
    if (f.cost === null) delete it.cost;
    else {
      const c = f.cost;
      if (!(COST_UNITS as readonly string[]).includes(c.unit) || !(COST_STATUS as readonly string[]).includes(c.status)) return "費用格式不正確";
      if (!(c.amount >= 0 && c.amount <= 100000)) return "金額不正確";
      const cat = c.cat ?? it.cost?.cat ?? "tickets";
      if (!(COST_CATS as readonly string[]).includes(cat)) return "費用分類不正確";
      it.cost = { ...(it.cost ?? {}), cat: cat as Cost["cat"], amount: c.amount, unit: c.unit as Cost["unit"], status: c.status as Cost["status"] };
    }
  }
  return null;
}

/** Driver conflict check shared by package and single-item scheduling. */
function driverConflict(day: Day, needsDriver: string | undefined): string | null {
  if (!needsDriver) return null;
  const eff = effectiveDay(day);
  if (eff.needsDriver && eff.needsDriver !== needsDriver) return `此日已依賴 ${eff.needsDriver} 開車`;
  return null;
}

function contextOf(pkg: Package) {
  return {
    key: pkg.key,
    title: pkg.title,
    needsDriver: pkg.needsDriver,
    driveHrs: pkg.driveHrs,
    alt: pkg.alt,
    ferry: pkg.ferry,
    hike: pkg.hike,
    transfer: pkg.transfer,
  };
}

function strip<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function applyOp(input: TripDoc, op: Op): OpResult {
  const doc = clone(input);
  switch (op.op) {
    case "setPriority": {
      const d = findDay(doc, op.date);
      const it = d && findItem(d, op.itemId);
      if (!d || !it) return err(404, "找不到活動");
      if (!(PRIORITIES as readonly string[]).includes(op.pri)) return err(400, "優先度不正確");
      const label = { must: "必去", pref: "優先", repl: "可替換" } as const;
      const before = label[it.pri];
      it.pri = op.pri as Item["pri"];
      return { ok: true, doc, summary: `${fmtDay(d.date)}「${it.name}」優先度 ${before} → ${label[it.pri]}` };
    }
    case "toggleVerify": {
      const d = findDay(doc, op.date);
      const it = d && findItem(d, op.itemId);
      if (!d || !it) return err(404, "找不到活動");
      const on = it.verify !== "verified";
      it.verify = on ? "verified" : "unverified";
      if (on) it.checked = op.today;
      else delete it.checked;
      return { ok: true, doc, summary: `${fmtDay(d.date)}「${it.name}」${on ? "標記為已查核" : "取消查核"}` };
    }
    case "confirmDriver": {
      const d = findDay(doc, op.date);
      if (!d) return err(404, "找不到日期");
      const eff = effectiveDay(d);
      if (!eff.needsDriver) return err(400, "這天不依賴司機");
      const w = op.window.trim();
      if (!validWindow(w)) return err(400, "時段需為 HH:MM–HH:MM，且開始早於結束");
      d.driverConfirmation = { driver: eff.needsDriver, window: w };
      return { ok: true, doc, summary: `${fmtDay(d.date)} 確認 ${eff.needsDriver} 開車 ${w}` };
    }
    case "clearDriver": {
      const d = findDay(doc, op.date);
      if (!d) return err(404, "找不到日期");
      delete d.driverConfirmation;
      return { ok: true, doc, summary: `${fmtDay(d.date)} 司機改回未確認` };
    }
    case "setPartySize": {
      const n = op.partySize;
      if (!Number.isInteger(n) || n < 1 || n > 10) return err(400, "人數需為 1–10");
      const before = doc.partySize;
      doc.partySize = n;
      return { ok: true, doc, summary: `同行人數 ${before} → ${n}` };
    }
    case "setParticipants": {
      const d = findDay(doc, op.date);
      const c = d?.costs?.[op.costIndex];
      if (!d || !c) return err(404, "找不到費用");
      const p = op.participants;
      if (!Number.isInteger(p) || p < 1 || p > 12) return err(400, "分攤人數需為 1–12");
      const before = c.participants;
      c.participants = p;
      return { ok: true, doc, summary: `${fmtDay(d.date)}「${c.label ?? "費用"}」分攤人數 ${before ?? "—"} → ${p}` };
    }
    case "editItem": {
      const d = findDay(doc, op.date);
      const it = d && findItem(d, op.itemId);
      if (!d || !it) return err(404, "找不到活動");
      const e = applyFields(it, op.fields);
      if (e) return err(400, e);
      sortItems(d);
      return { ok: true, doc, summary: `${fmtDay(d.date)} 修改「${it.name}」` };
    }
    case "addItem": {
      const d = findDay(doc, op.date);
      if (!d) return err(404, "找不到日期");
      const it: Item = {
        id: op.newId,
        time: "10:00",
        dur: 60,
        name: "新活動",
        en: "",
        pri: "pref",
        major: true,
        mode: "walk",
        travel: {},
        verify: "unverified",
        note: "使用者新增，位置未設定",
      };
      const e = applyFields(it, op.fields);
      if (e) return err(400, e);
      d.items.push(it);
      sortItems(d);
      d.open = false;
      return { ok: true, doc, summary: `${fmtDay(d.date)} 新增「${it.name}」` };
    }
    case "removeItem": {
      const d = findDay(doc, op.date);
      const it = d && findItem(d, op.itemId);
      if (!d || !it) return err(404, "找不到活動");
      // FR-04: a Must-do activity is never removed without an explicit confirmation naming it.
      if (it.pri === "must" && op.confirmMustName !== it.name) return err(400, `「${it.name}」是必去活動，需要明確確認才能移除`);
      d.items = d.items.filter((x) => x !== it);
      if (!d.items.length) d.open = true;
      return { ok: true, doc, summary: `${fmtDay(d.date)} 移除「${it.name}」` };
    }
    case "schedulePackage": {
      const pi = doc.attractionPool.findIndex((p) => p.key === op.key);
      const pkg = doc.attractionPool[pi];
      const d = findDay(doc, op.date);
      if (!pkg || !d) return err(404, "找不到景點組或日期");
      if (!pkg.items.length) return err(400, "這組景點已全部排入行程");
      if (d.seg !== pkg.seg) return err(400, "只能排入同一個目的地的日子");
      const conflict = driverConflict(d, pkg.needsDriver);
      if (conflict) return err(400, conflict);
      d.items.push(...pkg.items.map((i) => ({ ...i, originPackage: pkg.key })));
      sortItems(d);
      d.attached = [
        ...(d.attached ?? []),
        strip({ key: pkg.key, title: pkg.title, costs: pkg.costs, needsDriver: pkg.needsDriver, driveHrs: pkg.driveHrs, alt: pkg.alt, ferry: pkg.ferry, hike: pkg.hike, transfer: pkg.transfer }),
      ];
      d.open = false;
      doc.attractionPool.splice(pi, 1);
      return { ok: true, doc, summary: `將「${pkg.title}」排入 ${fmtDay(d.date)}` };
    }
    case "scheduleItem": {
      const pkg = doc.attractionPool.find((p) => p.key === op.key);
      const it = pkg?.items.find((i) => i.id === op.itemId);
      const d = findDay(doc, op.date);
      if (!pkg || !it || !d) return err(404, "找不到景點或日期");
      if (d.seg !== pkg.seg) return err(400, "只能排入同一個目的地的日子");
      const conflict = driverConflict(d, pkg.needsDriver);
      if (conflict) return err(400, conflict);
      pkg.items = pkg.items.filter((x) => x !== it);
      d.items.push({ ...it, originPackage: pkg.key, packageContext: strip(contextOf(pkg)) });
      sortItems(d);
      d.open = false;
      return { ok: true, doc, summary: `將「${it.name}」排入 ${fmtDay(d.date)}` };
    }
    case "unscheduleItem": {
      const d = findDay(doc, op.date);
      const it = d && findItem(d, op.itemId);
      if (!d || !it) return err(404, "找不到活動");
      if (!it.originPackage) return err(400, "這個活動不是來自待安排景點，無法移回");
      const key = it.originPackage;
      const att = d.attached?.find((a) => a.key === key);
      let pkg = doc.attractionPool.find((p) => p.key === key);
      if (!pkg) {
        const src = att ?? it.packageContext;
        pkg = strip({
          key,
          title: src?.title ?? key,
          seg: d.seg,
          items: [],
          costs: att?.costs ?? [],
          needsDriver: src?.needsDriver,
          driveHrs: src?.driveHrs ?? 0,
          alt: src?.alt,
          ferry: src?.ferry,
          hike: src?.hike,
          transfer: src?.transfer,
        }) as Package;
        doc.attractionPool.push(pkg);
      }
      const back: Item = { ...it };
      delete back.packageContext;
      pkg.items.push(back);
      d.items = d.items.filter((x) => x !== it);
      if (att && !d.items.some((x) => x.originPackage === key && !x.packageContext)) {
        d.attached = d.attached!.filter((a) => a !== att);
        if (!d.attached.length) delete d.attached;
      }
      if (!d.items.length) d.open = true;
      return { ok: true, doc, summary: `將「${it.name}」從 ${fmtDay(d.date)} 移回待安排景點` };
    }
    case "snapshot": {
      const s = op.summary.trim();
      if (!s || s.length > 60) return err(400, "版本說明需為 1–60 字");
      return { ok: true, doc, summary: s };
    }
  }
}
