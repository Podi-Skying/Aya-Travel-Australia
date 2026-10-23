import { z } from "zod";

/*
 * Trip document schema. Mirrors window.TRIP_DATA in site/js/data.js, plus the
 * owner-mutable state the prototype kept in localStorage (party size, driver
 * confirmation) and the attraction pool / journey data added in PLAN.md 4.9–4.11.
 */

export const PRIORITIES = ["must", "pref", "repl"] as const;
export const MODES = ["walk", "bus", "drive", "ferry", "train", "flight"] as const;
export const COST_CATS = ["transport", "stay", "food", "tickets", "other"] as const;
export const COST_UNITS = ["pp", "group", "shared", "night"] as const;
export const COST_STATUS = ["estimate", "quote", "confirmed", "unknown"] as const;
export const VERIFY = ["verified", "partial", "unverified"] as const;
export const LEG_KEYS = ["drive", "walk", "wait", "ferry", "transit", "flight"] as const;

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateStr = z.string().refine(isRealDate, "日期需為存在的日期（YYYY-MM-DD）");
const shortText = (max: number) => z.string().max(max);

export const costSchema = z.object({
  cat: z.enum(COST_CATS),
  amount: z.number().min(0).max(100000),
  unit: z.enum(COST_UNITS),
  status: z.enum(COST_STATUS),
  note: shortText(300).optional(),
  participants: z.number().int().min(1).max(50).optional(),
  label: shortText(120).optional(),
});

export const travelSchema = z.partialRecord(z.enum(LEG_KEYS), z.number().min(0).max(24 * 60));

export const packageContextSchema = z.object({
  key: shortText(40),
  title: shortText(120).optional(),
  needsDriver: shortText(40).optional(),
  driveHrs: z.number().min(0).max(24),
  alt: shortText(500).optional(),
  ferry: z.boolean().optional(),
  hike: z.boolean().optional(),
  transfer: z.boolean().optional(),
});

/*
 * A photo of the place, hotlinked from where it was found (official or tourism site, Wikimedia
 * Commons, or a URL the owner typed). Only the owner and share-link viewers receive it (privacy.ts).
 */
export const PHOTO_KINDS = ["og", "commons", "custom"] as const;
export const photoSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  w: z.number().int().min(1).max(20000).optional(),
  h: z.number().int().min(1).max(20000).optional(),
  page: z.url({ protocol: /^https?$/ }),
  site: shortText(80),
  kind: z.enum(PHOTO_KINDS),
  credit: shortText(200).optional(),
  license: shortText(60).optional(),
});

/* Place categories for browsing unscheduled places on the map (DESIGN.md「地圖與待安排景點」). */
export const CATEGORIES = ["nature", "beach", "lookout", "wildlife", "food", "market", "town", "history", "art", "activity"] as const;
export type Category = (typeof CATEGORIES)[number];

export const itemSchema = z.object({
  id: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, "活動 id 只能使用英數字、- 與 _"),
  time: z.string().regex(TIME_RE, "時間需為 00:00–23:59"),
  dur: z.number().int().min(0).max(24 * 60),
  name: z.string().min(1).max(120),
  en: shortText(160).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  pri: z.enum(PRIORITIES),
  major: z.boolean(),
  mode: z.enum(MODES),
  travel: travelSchema,
  src: z.object({ label: shortText(120), url: z.url({ protocol: /^https?$/ }) }).optional(),
  verify: z.enum(VERIFY),
  checked: dateStr.optional(),
  note: shortText(500).optional(),
  cost: costSchema.optional(),
  originPackage: shortText(40).optional(),
  packageContext: packageContextSchema.optional(),
  photo: photoSchema.optional(),
  cat: z.enum(CATEGORIES).optional(),
  /** Booking state: confirmed (locked against moves) or pending; absent = planned. Driver days add "tentative" (effective-day.ts). */
  status: z.enum(["confirmed", "pending"]).optional(),
  /** Owner-only detail (flight numbers, workplace); removed from every public document. */
  ownerNote: shortText(500).optional(),
});

/* "08:30–18:00" (en dash) or "08:30-18:00"; start must be before end. */
export const WINDOW_RE = /^([01]\d|2[0-3]):([0-5]\d)\s*[–-]\s*([01]\d|2[0-3]):([0-5]\d)$/;
export function validWindow(w: string): boolean {
  const m = WINDOW_RE.exec(w.trim());
  if (!m) return false;
  return Number(m[1]) * 60 + Number(m[2]) < Number(m[3]) * 60 + Number(m[4]);
}

export const driverConfirmationSchema = z.object({
  driver: z.string().min(1).max(40),
  window: z.string().refine(validWindow, "時段需為 HH:MM–HH:MM，且開始早於結束"),
});

export const attachmentSchema = z.object({
  key: shortText(40),
  title: shortText(120).optional(),
  costs: z.array(costSchema).max(20),
  needsDriver: shortText(40).optional(),
  driveHrs: z.number().min(0).max(24),
  alt: shortText(500).optional(),
  ferry: z.boolean().optional(),
  hike: z.boolean().optional(),
  transfer: z.boolean().optional(),
});

export const daySchema = z.object({
  date: dateStr,
  seg: z.string().min(1).max(20),
  title: z.string().min(1).max(120),
  stay: z.string().min(1).max(40),
  driveHrs: z.number().min(0).max(24),
  needsDriver: shortText(40).optional(),
  alt: shortText(500).optional(),
  ferry: z.boolean().optional(),
  hike: z.boolean().optional(),
  transfer: z.boolean().optional(),
  open: z.boolean().optional(),
  items: z.array(itemSchema).max(40),
  costs: z.array(costSchema).max(20).optional(),
  attached: z.array(attachmentSchema).max(10).optional(),
  driverConfirmation: driverConfirmationSchema.optional(),
});

export const packageSchema = z.object({
  key: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  seg: z.string().min(1).max(20),
  items: z.array(itemSchema).max(40),
  costs: z.array(costSchema).max(20),
  needsDriver: shortText(40).optional(),
  driveHrs: z.number().min(0).max(24),
  alt: shortText(500).optional(),
  ferry: z.boolean().optional(),
  hike: z.boolean().optional(),
  transfer: z.boolean().optional(),
  suggestion: z.object({ date: dateStr.optional(), reason: shortText(300) }).optional(),
});

export const tripDocSchema = z
  .object({
    meta: z.object({
      title: z.string().min(1).max(120),
      subtitle: shortText(200),
      start: dateStr,
      end: dateStr,
      currency: z.string().min(3).max(3),
      defaultPartySize: z.number().int().min(1).max(10),
      draftCreated: dateStr.optional(),
      lastSync: z.string().optional(),
      /** Legacy daily meal estimate; no longer added to the budget (meals are activities). */
      foodPerPersonPerDay: z.record(z.string(), z.number().min(0).max(1000)).default({}),
    }),
    partySize: z.number().int().min(1).max(10),
    segments: z.record(
      z.string(),
      z.object({ name: z.string(), en: z.string(), range: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
    ),
    drivers: z.record(
      z.string(),
      z.object({ weekdays: z.array(z.number().int().min(0).max(6)), label: shortText(80), note: shortText(300) }),
    ),
    stays: z.record(
      z.string(),
      z.object({
        name: shortText(120),
        area: shortText(120),
        address: shortText(300),
        nightly: z.number().min(0).max(100000),
        status: z.enum(COST_STATUS),
        note: shortText(300),
      }),
    ),
    alertsSources: z.array(z.object({ name: shortText(120), url: z.url({ protocol: /^https?$/ }), kind: shortText(40) })).max(50),
    days: z.array(daySchema).min(1).max(120),
    attractionPool: z.array(packageSchema).max(60).default([]),
    journey: z
      .object({
        chapters: z.array(z.object({ key: shortText(40), title: shortText(80), itemIds: z.array(z.string()).max(30) })).max(12),
      })
      .optional(),
  })
  .superRefine((doc, ctx) => {
    const seen = new Map<string, string>();
    const note = (id: string, where: string, path: (string | number)[]) => {
      const prev = seen.get(id);
      if (prev) ctx.addIssue({ code: "custom", message: `活動 id「${id}」重複（${prev} 與 ${where}）`, path });
      else seen.set(id, where);
    };
    const dates = new Set<string>();
    doc.days.forEach((d, di) => {
      if (dates.has(d.date)) ctx.addIssue({ code: "custom", message: `日期 ${d.date} 重複`, path: ["days", di, "date"] });
      dates.add(d.date);
      if (!doc.segments[d.seg]) ctx.addIssue({ code: "custom", message: `未知的目的地 ${d.seg}`, path: ["days", di, "seg"] });
      if (!doc.stays[d.stay]) ctx.addIssue({ code: "custom", message: `未知的住宿 ${d.stay}`, path: ["days", di, "stay"] });
      if (d.needsDriver && !doc.drivers[d.needsDriver])
        ctx.addIssue({ code: "custom", message: `未知的司機 ${d.needsDriver}`, path: ["days", di, "needsDriver"] });
      if (d.driverConfirmation && !doc.drivers[d.driverConfirmation.driver])
        ctx.addIssue({ code: "custom", message: `未知的司機 ${d.driverConfirmation.driver}`, path: ["days", di, "driverConfirmation", "driver"] });
      d.items.forEach((it, ii) => note(it.id, d.date, ["days", di, "items", ii, "id"]));
      // Package contexts sharing a key on one day must agree (they describe the same package).
      const byKey = new Map<string, string>();
      const contexts = [...(d.attached ?? []).map((a) => ({ ...a, costs: undefined, title: undefined })), ...d.items.flatMap((i) => (i.packageContext ? [{ ...i.packageContext, title: undefined }] : []))];
      for (const c of contexts) {
        const sig = JSON.stringify([c.needsDriver ?? null, c.driveHrs, c.alt ?? null, !!c.ferry, !!c.hike, !!c.transfer]);
        const prev = byKey.get(c.key);
        if (prev !== undefined && prev !== sig)
          ctx.addIssue({ code: "custom", message: `${d.date} 的景點組「${c.key}」資料不一致`, path: ["days", di] });
        byKey.set(c.key, sig);
      }
    });
    doc.attractionPool.forEach((p, pi) => {
      if (!doc.segments[p.seg]) ctx.addIssue({ code: "custom", message: `未知的目的地 ${p.seg}`, path: ["attractionPool", pi, "seg"] });
      p.items.forEach((it, ii) => note(it.id, `待安排「${p.key}」`, ["attractionPool", pi, "items", ii, "id"]));
    });
    const keys = new Set<string>();
    doc.attractionPool.forEach((p, pi) => {
      if (keys.has(p.key)) ctx.addIssue({ code: "custom", message: `景點組 ${p.key} 重複`, path: ["attractionPool", pi, "key"] });
      keys.add(p.key);
    });
  });

export type Cost = z.infer<typeof costSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Day = z.infer<typeof daySchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Package = z.infer<typeof packageSchema>;
export type PackageContext = z.infer<typeof packageContextSchema>;
export type TripDoc = z.infer<typeof tripDocSchema>;

export type ParseResult = { ok: true; doc: TripDoc } | { ok: false; errors: { path: string; message: string }[] };

export function parseTripDoc(input: unknown): ParseResult {
  const r = tripDocSchema.safeParse(input);
  if (r.success) return { ok: true, doc: r.data };
  return {
    ok: false,
    errors: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
