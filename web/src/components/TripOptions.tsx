"use client";

import { useEffect, useMemo, useState } from "react";
import { useTrip } from "./TripApp";
import { AvatarStack } from "./People";
import { Badge, PendingButton, useHydrated } from "./ui";
import { ShareButton } from "./Share";
import { dayNightLabel, optionCard, type OptionCard } from "@/domain/options";
import { OPTION_THEMES } from "@/domain/schema";
import { fmtDay, fmtMD, money } from "@/domain/format";

/*
 * 多日行程方案 (PLAN-2026-10-26 §3, chictrip review P1): overnight trips as cards that can be
 * compared side by side; the owner picks one and it replaces those days in one undoable version.
 */

export const THEME: Record<(typeof OPTION_THEMES)[number], string> = { aurora: "極光", bio: "藍眼淚", hike: "健行", food: "美食", wildlife: "野生動物", town: "小鎮" };

type Filters = { days: number | 0; theme: string; region: string };

/* ---- URL state: ?tab=options&optDays=3&optTheme=hike&optRegion=東海岸 ---- */
function readFilters(): Filters {
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  const n = Number(q.get("optDays"));
  return { days: [1, 2, 3].includes(n) ? n : 0, theme: q.get("optTheme") ?? "", region: q.get("optRegion") ?? "" };
}
function writeFilters(f: Filters) {
  const q = new URLSearchParams(location.search);
  const set = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k));
  set("optDays", f.days ? String(f.days) : "");
  set("optTheme", f.theme);
  set("optRegion", f.region);
  history.replaceState(history.state, "", `${location.pathname}?${q.toString()}${location.hash}`);
}

export function TripOptions() {
  const { doc, mode } = useTrip();
  const N = doc.partySize;
  const cards = useMemo(() => (doc.tripOptions ?? []).map((o) => optionCard(doc, o, N)), [doc, N]);
  const [state, setF] = useState<Filters>(readFilters);
  // The server renders without the URL's filters; apply them only after hydration.
  const f = useHydrated() ? state : { days: 0, theme: "", region: "" };
  useEffect(() => writeFilters(state), [state]);
  const regions = [...new Set(cards.map((c) => c.option.region).filter(Boolean))];
  const themes = OPTION_THEMES.filter((t) => cards.some((c) => c.option.themes.includes(t)));
  const shown = cards.filter((c) => (!f.days || c.tripDays === f.days) && (!f.theme || c.option.themes.includes(f.theme as never)) && (!f.region || c.option.region === f.region));
  const groups = [...new Set(shown.map((c) => c.option.group))];
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <>
      <div className="card">
        <h2>多日行程方案</h2>
        <p className="muted">
          兩天一夜、三天兩夜的行程整理成方案，可以並排比較。{mode === "owner" ? "按「套用」會把那幾天目前的活動移回待安排，換成方案的內容；沒選的方案會保留，之後可以換回來。" : "擁有者選定的方案會標示「目前採用」。"}
        </p>
        <div className="opt-filters" role="group" aria-label="篩選方案">
          <div className="chips">
            {chip(!f.days, "全部天數", () => setF({ ...f, days: 0 }))}
            {[1, 2, 3].map((n) => chip(f.days === n, `${n} 天`, () => setF({ ...f, days: f.days === n ? 0 : n })))}
          </div>
          {themes.length > 0 && <div className="chips">{themes.map((t) => chip(f.theme === t, THEME[t], () => setF({ ...f, theme: f.theme === t ? "" : t })))}</div>}
          {regions.length > 1 && <div className="chips">{regions.map((r) => chip(f.region === r, r, () => setF({ ...f, region: f.region === r ? "" : r })))}</div>}
        </div>
      </div>
      {!cards.length && <p className="section muted">還沒有方案。</p>}
      {cards.length > 0 && !shown.length && <p className="section muted">沒有符合篩選的方案。</p>}
      {groups.map((g) => {
        const gs = shown.filter((c) => c.option.group === g);
        const all = cards.filter((c) => c.option.group === g).flatMap((c) => c.dates).sort();
        return (
          <section key={g} className="section opt-group" aria-label={`${fmtMD(all[0])}–${fmtMD(all.at(-1)!)} 的方案`}>
            <h3>
              {fmtMD(all[0])}–{fmtMD(all.at(-1)!)}・{gs.length} 個方案
            </h3>
            <div className="opt-grid">
              {gs.map((c) => (
                <OptionCardView key={c.option.key} c={c} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function LineArt() {
  // Fallback cover: one ink line of hills and sea, in the walk's hand-drawn style.
  return (
    <svg viewBox="0 0 320 160" aria-hidden="true" className="opt-art">
      <path d="M0 118 C40 96 62 70 96 84 S150 40 188 62 S250 98 320 72" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M0 136 C30 130 60 140 90 134 S150 128 180 136 S260 142 320 132" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
      <circle cx="248" cy="38" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function OptionCardView({ c }: { c: OptionCard }) {
  const { doc, mode, online, runOpUndoable, ask, counts, gotoDay } = useTrip();
  const [open, setOpen] = useState(false);
  const o = c.option;
  const ids = new Set(o.days.flatMap((d) => d.itemIds));
  // Votes follow the activity: include votes recorded on a date it has since moved away from.
  const wants = counts ? [...counts.current, ...counts.moved].filter((x) => ids.has(x.itemId)).reduce((a, x) => a + x.count, 0) : null;
  const range = `${fmtMD(c.dates[0])}–${fmtMD(c.dates.at(-1)!)}`;
  const firstIdx = doc.days.findIndex((d) => d.date === c.dates[0]);
  return (
    <article className={`card opt-card${o.chosen ? " chosen" : ""}`}>
      <div className="opt-cover">
        {c.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked place photo
          <img src={c.photo} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <LineArt />
        )}
        {o.region && <span className="opt-region">{o.region}</span>}
        {o.chosen && <span className="opt-chosen">目前採用</span>}
      </div>
      <h4>{o.title}</h4>
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
      <button type="button" className="btn ghost small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "收起每日內容" : "看每日內容"}
      </button>
      {open && (
        <ol className="opt-days">
          {o.days.map((d, i) => (
            <li key={i}>
              <strong>
                {fmtDay(c.dates[i])} {d.title}
              </strong>
              <span className="small muted">（開車約 {d.driveHrs} 小時）</span>
              {c.items[i].length ? <ul>{c.items[i].map((it) => <li key={it.id}>{it.time} {it.name}</li>)}</ul> : <p className="small muted">沒有排活動</p>}
            </li>
          ))}
        </ol>
      )}
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
