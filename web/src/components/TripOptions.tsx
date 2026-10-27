"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTrip } from "./TripApp";
import { AvatarStack } from "./People";
import { Badge, PendingButton, useReducedMotion } from "./ui";
import { useSyncExternalStore } from "react";

/** Matches the reel's CSS breakpoint so its tablist orientation is announced correctly. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia("(max-width: 720px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia("(max-width: 720px)").matches,
    () => false,
  );
}
import { ShareButton } from "./Share";
import { PlanReel } from "./PlanReel";
import { PlaceGallery, cardSrc } from "./PlaceGallery";
import { Icon } from "./Icon";
import { legLabel, routeStops, useLegs, type Leg } from "./useLegs";
import { stayPin, type StayPin } from "@/domain/home-pins";
import { homeStayKey } from "@/domain/stay";
import type { Item } from "@/domain/schema";
import { dayNightLabel, INK_PALETTE, optionCard, optionPalette, type OptionCard } from "@/domain/options";
import { OPTION_THEMES } from "@/domain/schema";
import { fmtDay, fmtMD, mins, money } from "@/domain/format";
import { t as tt } from "@/i18n/current";

/*
 * 行程方案 (renamed from 推薦行程方案 on 2026-10-26, filters removed; PLAN-2026-10-26 §3; reel in PLAN-2026-10-26-plan-reel): overnight trips as photo slices with
 * their own colour; the owner picks one and it replaces those days in one undoable version.
 */

export const THEME: Record<(typeof OPTION_THEMES)[number], string> = { aurora: "極光", bio: "藍眼淚", hike: "健行", food: "美食", wildlife: "野生動物", town: "小鎮" };

export function TripOptions() {
  const { doc, mode } = useTrip();
  const N = doc.partySize;
  const cards = useMemo(() => (doc.tripOptions ?? []).map((o) => optionCard(doc, o, N)), [doc, N]);
  const shown = cards;
  const [picked, setPicked] = useState<string | null>(null);
  // A clicked plan opens at its 第 1 天 (Kai 2026-10-26); arrow keys stay on the reel.
  const [jump, setJump] = useState<{ key: string; n: number } | null>(null);
  const narrow = useNarrow();
  // Bookable Tasmanian tours (Kai 2026-10-27) sit in the reel beside the multi-day plans, as unscheduled cards.
  const tours = useMemo(() => doc.attractionPool.filter((p) => p.seg === "tas").flatMap((p) => p.items.filter((i) => i.tour).map((i) => ({ key: `tour-${i.id}`, item: i, pkg: p.key }))), [doc]);
  const tour = tours.find((t) => t.key === picked) ?? null;
  const current = tour ? null : (shown.find((c) => c.option.key === picked) ?? shown.find((c) => c.option.chosen) ?? shown[0]);
  const pal = current ? optionPalette(current.option) : null;

  return (
    <div className="plan-stage" style={pal ? { ["--plan-tint" as string]: pal.tint, ["--plan-deep" as string]: pal.deep } : undefined}>
      <div className="card plan-intro">
        <h2>行程方案</h2>
        <p className="muted">
          兩天一夜、三天兩夜的行程，和需要預訂的塔州跟團遊船，點一張照片看詳細內容。{mode === "owner" ? "按「套用」會把那幾天目前的活動移回待安排，換成方案的內容；沒選的方案會保留，之後可以換回來。" : "擁有者選定的方案會標示「目前採用」。"}
        </p>
      </div>
      {!cards.length && <p className="section muted">還沒有方案。</p>}
      {(current || tour) && (
        <>
          <div className="section">
            <PlanReel
              orientation={narrow ? "vertical" : "horizontal"}
              label="行程方案"
              panelId="plan-detail"
              active={tour ? tour.key : current!.option.key}
              onSelect={(k, via) => {
                setPicked(k);
                setJump(via === "click" ? { key: k, n: (jump?.n ?? 0) + 1 } : null);
              }}
              slices={shown.map((c) => ({
                key: c.option.key,
                title: c.option.title,
                caption: `${dayNightLabel(c)}・${c.option.region || "塔斯馬尼亞"}・${fmtMD(c.dates[0])}–${fmtMD(c.dates.at(-1)!)}`,
                badge: c.option.chosen ? "目前採用" : undefined,
                image: c.photo?.url,
                imagePos: c.photo?.pos,
                deep: optionPalette(c.option).deep,
              })).concat(
                tours.map((t) => ({
                  key: t.key,
                  title: t.item.name.replace(/（.*?）/g, ""),
                  caption: `跟團・需預訂・${mins(t.item.dur ?? 60)}`,
                  badge: "跟團",
                  image: t.item.photo?.url,
                  imagePos: t.item.photo?.pos,
                  deep: INK_PALETTE.deep,
                })),
              )}
            />
          </div>
          {tour ? <TourDetail key={tour.key} item={tour.item} /> : <OptionDetail key={current!.option.key} c={current!} jump={jump?.key === current!.option.key ? jump.n : 0} />}
        </>
      )}
    </div>
  );
}


/** Details of the selected plan, with each stop's photo for comparison. */
function OptionDetail({ c, jump }: { c: OptionCard; jump: number }) {
  const { doc, mode, online, runOpUndoable, ask, counts, gotoDay } = useTrip();
  const reduce = useReducedMotion();
  const firstDay = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const h = firstDay.current;
    if (!jump || !h) return;
    h.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    h.focus({ preventScroll: true });
    // Each click asks again (jump counts clicks); other renders leave the scroll alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);
  const o = c.option;
  const ids = new Set(o.days.flatMap((d) => d.itemIds));
  // Votes follow the activity: include votes recorded on a date it has since moved away from.
  const wants = counts ? [...counts.current, ...counts.moved].filter((x) => ids.has(x.itemId)).reduce((a, x) => a + x.count, 0) : null;
  const range = `${fmtMD(c.dates[0])}–${fmtMD(c.dates.at(-1)!)}`;
  const firstIdx = doc.days.findIndex((d) => d.date === c.dates[0]);
  return (
    <article className={`card opt-card plan-detail${o.chosen ? " chosen" : ""}`} id="plan-detail" role="tabpanel" aria-labelledby={`reel-${o.key}`}>
      <h3>{o.title}</h3>
      <p className="opt-tags">
        <Badge t={dayNightLabel(c)} c="b-line" /> {o.themes.map((t) => <Badge key={t} t={THEME[t]} c="b-info" />)}
      </p>
      <p className="small">{c.route}</p>
      <dl className="opt-facts">
        <div>
          <dt>日期</dt>
          <dd>{range}</dd>
        </div>
        <div>
          <dt>開車</dt>
          <dd>約 {c.driveHrs} 小時</dd>
        </div>
        <div>
          <dt>估計花費（{doc.partySize} 人）</dt>
          <dd>{c.cost == null ? "—" : money(c.cost)}</dd>
        </div>
        {mode === "owner" && wants != null && (
          <div>
            <dt>想去</dt>
            <dd>{wants}</dd>
          </div>
        )}
      </dl>
      {c.stays.length > 0 && (
        <ul className="opt-stays small">
          {c.stays.map((s) => (
            <li key={s.key}>
              {s.name}：{money(s.nightly)} × {s.nights} 晚
            </li>
          ))}
        </ul>
      )}
      <p className="opt-people">
        <AvatarStack people={c.people} size={26} />
      </p>
      {o.summary && <p className="small muted">{o.summary}</p>}
      <ol className="opt-days">
        {o.days.map((d, i) => (
          <li key={i}>
            <h4 ref={i === 0 ? firstDay : undefined} tabIndex={i === 0 ? -1 : undefined} className="opt-day-h">
              {tt("第 {n} 天", { n: i + 1 })}・{fmtDay(c.dates[i])} {d.title}
              <span className="small muted">（開車約 {d.driveHrs} 小時）</span>
            </h4>
            {c.items[i].length ? (
              <PlanDayTimeline items={c.items[i]} start={i ? stayPin(doc, o.days[i - 1].stay) : (homeStayKey(doc) ? stayPin(doc, homeStayKey(doc)!) : null)} end={stayPin(doc, d.stay)} />
            ) : (
              <p className="small muted">沒有排活動</p>
            )}
          </li>
        ))}
      </ol>
      <div className="opt-actions">
        {mode === "owner" ? (
          <PendingButton
            className={o.chosen ? "btn ghost" : "btn"}
            disabled={!online}
            pendingLabel="套用中…"
            onAction={async () => {
              const ok = await ask(`採用「${o.title}」？`, {
                body: <p>會把 {range} 目前的活動移回待安排（已確認的預訂和航班不動），換成這個方案的內容。可以按「復原」或之後改選其他方案。</p>,
                ok: "套用",
              });
              if (!ok) return null;
              return runOpUndoable({ op: "applyOption", key: o.key }, `已套用「${o.title}」`);
            }}
          >
            {o.chosen ? `重新套用到 ${range}` : `套用到 ${range}`}
          </PendingButton>
        ) : (
          <ShareButton title={o.title} />
        )}
        <a className="btn ghost" href={`?tab=map&mday=${c.dates[0]}`}>
          在地圖上看
        </a>
        {firstIdx >= 0 && o.chosen && (
          <button type="button" className="btn ghost" onClick={() => gotoDay(firstIdx)}>
            看每日行程
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * One plan day as a vertical timeline (Kai 2026-10-27, apple-design): fixed time column, title, a small
 * thumbnail only for main sights (tap opens the photos with their credits below the row), and muted
 * driving rows between stops from the stored road legs.
 */
function PlanDayTimeline({ items, start, end }: { items: Item[]; start: StayPin | null; end: StayPin | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const route = routeStops(items, { start, end });
  const legs = useLegs(route);
  const legInto = (id: string) => {
    const k = route.findIndex((r) => r.itemId === id);
    return k > 0 && route[k].drive ? (legs?.[k - 1] ?? null) : null;
  };
  const back = route.at(-1)?.kind === "end" && route.at(-1)!.drive ? (legs?.[route.length - 2] ?? null) : null;
  const driveRow = (l: Leg | null, key: string) =>
    l && l.durationS > 0 ? (
      <li key={key} className="pt-leg" aria-label={`開車 ${legLabel(l)}`}>
        <span className="pt-time" />
        <span className="pt-leg-t">
          <Icon name="car" size={14} /> {legLabel(l)}
        </span>
      </li>
    ) : null;
  return (
    <ol className="plan-timeline">
      {items.map((it) => {
        // Main sights with a photo of their own get a thumbnail; everything else stays a clean text row.
        const thumb = it.major && !!(it.photo || it.gallery?.length);
        return (
          <Fragment key={it.id}>
            {driveRow(legInto(it.id), `leg-${it.id}`)}
            <li className={`pt-stop${it.major ? " is-major" : ""}`}>
              <span className="pt-time">{it.time}</span>
              <span className="pt-title">{it.name}</span>
              {thumb && (
                <button type="button" className="pt-thumb" aria-expanded={open === it.id} aria-label={`看 ${it.name} 的照片`} onClick={() => setOpen(open === it.id ? null : it.id)}>
                  <PlanThumb item={it} />
                </button>
              )}
              {open === it.id && (
                <div className="pt-photos">
                  <PlaceGallery item={it} />
                </div>
              )}
            </li>
          </Fragment>
        );
      })}
      {driveRow(back, "leg-back")}
    </ol>
  );
}

/** The main sight's first photo as a small square (no credit here; it shows when the photos open). */
function PlanThumb({ item }: { item: Item }) {
  const p = item.photo ?? item.gallery?.[0];
  return p ? (
    // eslint-disable-next-line @next/next/no-img-element -- photos from several hosts
    <img src={cardSrc(p.url)} alt="" loading="lazy" referrerPolicy="no-referrer" style={p.pos ? { objectPosition: p.pos } : undefined} />
  ) : null;
}

/**
 * A bookable tour as a plan card (Kai 2026-10-27): price for each person and for Kai＋Aya, length,
 * where and when it leaves, the booking page, and the day as a timeline from and back to the home base.
 * Nothing is scheduled or booked here; Kai places it on a day himself.
 */
function TourDetail({ item }: { item: Item }) {
  const { doc } = useTrip();
  const home = homeStayKey(doc) ? stayPin(doc, homeStayKey(doc)!) : null;
  const pp = item.cost && item.cost.status !== "unknown" && item.cost.unit === "pp" ? item.cost.amount : null;
  const N = 2; // Kai and Aya (friends are not counted for tours)
  return (
    <article className="card opt-card plan-detail tour-detail" id="plan-detail" role="tabpanel" aria-labelledby={`reel-tour-${item.id}`}>
      <h3>{item.name}</h3>
      <p className="opt-tags">
        <Badge t="跟團" c="b-line" /> <Badge t="需預訂" c="b-warn" />
      </p>
      <dl className="opt-facts">
        <div>
          <dt>價格</dt>
          <dd>{pp != null ? `每人 ${money(pp)}・Kai＋Aya ${money(pp * N)}` : "價格待查"}</dd>
        </div>
        <div>
          <dt>時間</dt>
          <dd>約 {mins(item.dur ?? 60)}</dd>
        </div>
        <div className="wide">
          <dt>出發</dt>
          <dd>
            {item.tour?.depart}
            <br />
            <span className="small muted">{item.tour?.when}</span>
          </dd>
        </div>
      </dl>
      {item.src && (
        <p>
          <a className="btn" href={item.src.url} target="_blank" rel="noopener noreferrer">
            預訂頁面（{item.src.label}）
          </a>
        </p>
      )}
      {item.note && <p className="small muted">{item.note}</p>}
      <h4 className="opt-day-h">當天行程（從住處出發、回到住處）</h4>
      {/* The tour itself is a boat or a plane; getting to where it leaves is a drive. */}
      <PlanDayTimeline items={[{ ...item, major: true, mode: "drive" }]} start={home} end={home} />
      <p className="small muted">還沒排進任何一天，也沒有預訂；要去的話由 Kai 排進某一天後再預訂。</p>
    </article>
  );
}
