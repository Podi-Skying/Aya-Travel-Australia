"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTrip } from "./TripApp";
import { Icon, iconPath } from "./Icon";
import { PendingButton, useReducedMotion } from "./ui";
import { commonsFor } from "@/client/photos";
import { cardSrc } from "./PlaceGallery";
import { DayMap } from "./MapViews";
import { CATEGORY_META } from "./Places";
import ChromaGrid from "./chroma-grid/ChromaGrid";
import { driveMinutes, km, LONG_DAY_DRIVE_MIN, LONG_DRIVE_MIN, minutesFrom, orderStops, overnightNear, quizCost, quizPlaces, REGIONS, splitTwoDays, type QuizPlace } from "@/domain/quiz";
import { MiniMap } from "./MiniMap";
import { homeStayKey } from "@/domain/stay";
import { stayPin, type StayPin } from "@/domain/home-pins";
import { effectiveDay } from "@/domain/effective-day";
import { PALETTES, INK_PALETTE } from "@/domain/options";
import { fmtDay, mins, money } from "@/domain/format";
import type { Day, Item } from "@/domain/schema";

/*
 * 旅遊規劃小測驗 (Kai, 2026-10-26): a step-by-step one-day plan from the home base — pick a region,
 * pick places (photo grid, React Bits ChromaGrid with a selection extension), pick how to travel, and
 * see the ordered route on a map. Owner and share links only (it starts from Kai's residence).
 */

const STEPS = ["起點", "區域", "景點", "交通", "結果"] as const;

// Card images are data URIs while a place's photos load (a pulsing drawn camera) or when it has none
// (its category icon on a tint) — never a blank placeholder (Kai 2026-10-26).
const svgUri = (body: string) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">${body}</svg>`);
const CAMERA = "M4 8h3l1.5-2h7L17 8h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z";
const loadingImg = (still: boolean) =>
  svgUri(
    `<rect width="300" height="200" fill="#f3eee3"/><g transform="translate(126 76) scale(2)" fill="none" stroke="#625e55" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${CAMERA}">${still ? "" : '<animate attributeName="opacity" values=".35;1;.35" dur="1.4s" repeatCount="indefinite"/>'}</path></g>`,
  );
const emptyImg = (cat?: string) =>
  svgUri(`<rect width="300" height="200" fill="#e9e1cf"/><g transform="translate(126 76) scale(2)" fill="none" stroke="#3e3b34" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPath(cat ? `cat-${cat}` : "pin")}"/></g>`);


const accents = [...PALETTES.map((p) => p.deep), INK_PALETTE.deep];
const hours = (m: number) => `${Math.round(m / 30) / 2} 小時`;
const at = (i: Item): [number, number] => [i.lat!, i.lng!];
const accentFor = (k: string) => accents[[...k].reduce((a, c) => a + c.charCodeAt(0), 0) % accents.length];

export function PlanQuiz({ active }: { active: boolean }) {
  const { doc, mode, online, runOpUndoable, ask, token } = useTrip();
  const [step, setStep] = useState(0);
  const [region, setRegion] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [travel, setTravel] = useState<"drive" | "transit">("drive");
  const [start, setStart] = useState("09:00");

  const homeKey = homeStayKey(doc);
  const home = homeKey ? stayPin(doc, homeKey) : null;
  const homeName = home?.name === "住處" || !homeKey ? "住處" : (doc.stays[homeKey]?.name ?? "住處");
  const places = useMemo(() => quizPlaces(doc), [doc]);
  const reduce = useReducedMotion();
  // Places without their own photo use their cached Commons photos (they had shown a blank tile before).
  const [commons, setCommons] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!active || !(mode === "owner" || token)) return;
    const need = places.filter((p) => !p.item.photo && !p.item.gallery?.length && !(p.item.id in commons));
    if (!need.length) return;
    let live = true;
    void (async () => {
      for (let k = 0; k < need.length && live; k += 6) {
        const part = need.slice(k, k + 6);
        const lists = await Promise.all(part.map((p) => commonsFor({ id: p.item.id, name: p.item.name, lat: p.item.lat, lng: p.item.lng }, token)));
        if (live) setCommons((c) => ({ ...c, ...Object.fromEntries(part.map((p, j) => [p.item.id, lists[j][0]?.url ?? null])) }));
      }
    })();
    return () => {
      live = false;
    };
    // `commons` only filters what is still missing; refetching on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, places, mode, token]);
  // Each photo is loaded off-screen first: the card shows the camera until it arrives, the category if it fails.
  const [probe, setProbe] = useState<Record<string, "ok" | "err">>({});
  const wanted = (i: Item) => {
    const own = i.photo?.url ?? i.gallery?.[0]?.url;
    return own ? cardSrc(own) : commons[i.id] ? cardSrc(commons[i.id]!) : null;
  };
  const photoOf = (i: Item) => {
    const url = wanted(i);
    if (url) return probe[url] === "ok" ? url : probe[url] === "err" ? emptyImg(i.cat) : loadingImg(reduce);
    return commons[i.id] === undefined && (mode === "owner" || token) ? loadingImg(reduce) : emptyImg(i.cat);
  };
  const regions = REGIONS.map((r) => ({ r, list: places.filter((p) => p.region === r.key) })).filter((x) => x.list.length);
  const inRegion = places.filter((p) => p.region === region);
  const shown = step === 1 ? regions.map(({ list }) => list.find((p) => p.item.photo)?.item ?? list[0].item) : step === 2 ? inRegion.map((p) => p.item) : [];
  const toProbe = shown.map(wanted).filter((u): u is string => !!u && !(u in probe));
  const probeKey = toProbe.join("|");
  const probing = useRef(new Set<string>());
  useEffect(() => {
    if (!active || !probeKey) return;
    // Results land whenever each image answers; a URL is asked once (no cancelling, so none is left loading).
    for (const u of probeKey.split("|")) {
      if (probing.current.has(u)) continue;
      probing.current.add(u);
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      im.onload = () => setProbe((p) => ({ ...p, [u]: "ok" }));
      im.onerror = () => setProbe((p) => ({ ...p, [u]: "err" }));
      im.src = u;
    }
  }, [active, probeKey]);
  const chosen = inRegion.filter((p) => picked.includes(p.item.id));
  const reg = REGIONS.find((r) => r.key === region);
  const homeAt: [number, number] | null = home ? [home.lat, home.lng] : null;
  const oneWay = (i: Item) => (homeAt ? minutesFrom(homeAt, i) : 0);
  const zoomOf = (key: string) => (key === "hobart" ? "hobart" : "tas") as "hobart" | "tas";

  const back = () => setStep((s) => Math.max(0, s - 1));
  const go = (s: number) => setStep(s);

  return (
    <div className="quiz">
      <div className="card">
        <h2>旅遊規劃小測驗</h2>
        <p className="muted small">回答幾個問題，排出從住處出發、回到住處的一日行程。</p>
        <ol className="quiz-steps" aria-label="步驟">
          {STEPS.map((s, k) => (
            <li key={s} className={k === step ? "on" : k < step ? "done" : ""} aria-current={k === step ? "step" : undefined}>
              <span aria-hidden="true" />
              {s}
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <section className="card section quiz-step" aria-labelledby="q0">
          <h3 id="q0">起點</h3>
          <p className="quiz-home">
            <span className="home-pin base" aria-hidden="true" dangerouslySetInnerHTML={{ __html: HOUSE }} /> 從<strong>{homeName}</strong>出發，最後回到這裡。
          </p>
          <div className="quiz-nav">
            <button type="button" className="btn" onClick={() => go(1)}>
              開始
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="card section quiz-step" aria-labelledby="q1">
          <h3 id="q1">想去塔州哪個區域？</h3>
          <ChromaGrid
            theme="light"
            grayscale={0}
            dim={0}
            columns={3}
            radius={260}
            selectedLabel="選這裡"
            selected={regions.map((x) => x.r.key === region)}
            onToggle={(k) => {
              const key = regions[k].r.key;
              if (key !== region) setPicked([]);
              setRegion(key);
            }}
            items={regions.map(({ r, list }) => {
              const long = list.filter((p) => oneWay(p.item) > LONG_DRIVE_MIN).length > list.length / 2;
              return {
                image: photoOf(list.find((p) => p.item.photo)?.item ?? list[0].item),
                title: r.name,
                subtitle: [`${list.length} 個景點`, r.car ? "需要開車" : "公車可到", r.note, long ? "建議過夜" : "", r.far].filter(Boolean).join("・"),
                accent: accentFor(r.key),
                inset: <MiniMap places={list.map((p) => at(p.item))} home={homeAt} zoom={zoomOf(r.key)} />,
                insetLabel: `位置：${r.name}`,
              };
            })}
          />
          <QuizNav onBack={back} next={region ? () => go(2) : undefined} />
        </section>
      )}

      {step === 2 && reg && (
        <section className="card section quiz-step" aria-labelledby="q2">
          <h3 id="q2">在{reg.name}想去哪些景點？（可多選）</h3>
          {reg.far && <p className="small quiz-warn">{reg.far}</p>}
          <ChromaGrid
            theme="light"
            grayscale={0}
            dim={0}
            columns={3}
            radius={260}
            selected={inRegion.map((p) => picked.includes(p.item.id))}
            onToggle={(k) => {
              const id = inRegion[k].item.id;
              setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
            }}
            items={inRegion.map((p) => {
              const m = oneWay(p.item);
              return {
                image: photoOf(p.item),
                title: p.item.name,
                subtitle: [p.item.cat ? CATEGORY_META[p.item.cat].t : "", p.date ? `已排在 ${fmtDay(p.date)}` : "", m > LONG_DRIVE_MIN ? `單程約 ${hours(m)}・建議過夜` : ""].filter(Boolean).join("・"),
                accent: accentFor(p.item.cat ?? "other"),
                inset: <MiniMap places={[at(p.item)]} home={homeAt} zoom={zoomOf(reg.key)} />,
                insetLabel: `位置：${reg.name}`,
              };
            })}
          />
          <p className="small" role="status">
            已選 {chosen.length} 個
          </p>
          <QuizNav onBack={back} next={chosen.length ? () => go(3) : undefined} />
        </section>
      )}

      {step === 3 && (
        <section className="card section quiz-step" aria-labelledby="q3">
          <h3 id="q3">怎麼去？幾點出發？</h3>
          <div className="quiz-choices" role="radiogroup" aria-label="交通方式">
            {(
              [
                ["drive", "開車"],
                ["transit", "大眾運輸"],
              ] as const
            ).map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={travel === k} className={`chip${travel === k ? " on" : ""}`} onClick={() => setTravel(k)}>
                {t}
              </button>
            ))}
          </div>
          {travel === "transit" && reg?.car && <p className="small quiz-warn">{reg.name}大多要開車；公車班次少或到不了，結果僅供參考。</p>}
          <div className="quiz-choices" role="radiogroup" aria-label="出發時間">
            {["08:00", "09:00", "10:00"].map((t) => (
              <button key={t} type="button" role="radio" aria-checked={start === t} className={`chip${start === t ? " on" : ""}`} onClick={() => setStart(t)}>
                {t} 出發
              </button>
            ))}
          </div>
          <QuizNav onBack={back} next={() => go(4)} nextLabel="排出路線" />
        </section>
      )}

      {step === 4 && home && (
        <Result
          active={active}
          home={home}
          homeName={homeName}
          stops={orderStops([home.lat, home.lng], chosen)}
          travel={travel}
          start={start}
          onRestart={() => {
            setPicked([]);
            setRegion(null);
            go(1);
          }}
          onBack={back}
          owner={mode === "owner" && online}
          addToDay={async (date, refs, nextRefs) => runOpUndoable({ op: "addQuizPlan", date, refs, nextRefs }, "已加入，可以按「復原」")}
          stays={doc.stays}
          ask={ask}
          days={doc.days.filter((d) => d.seg === "tas")}
          party={doc.partySize}
        />
      )}
      {step === 4 && !home && <p className="section muted">住處的位置還沒設定，無法畫出路線。</p>}
    </div>
  );
}

const HOUSE =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 11.5 12 4.5l8 7M6.5 9.8V19.5h11V9.8M10 19.5v-5h4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function QuizNav({ onBack, next, nextLabel = "下一步" }: { onBack: () => void; next?: () => void; nextLabel?: string }) {
  return (
    <div className="quiz-nav">
      <button type="button" className="btn ghost" onClick={onBack}>
        ← 上一步
      </button>
      <button type="button" className="btn" disabled={!next} onClick={next}>
        {nextLabel}
      </button>
    </div>
  );
}

type Stop = QuizPlace;
const clock = (t: number) => `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** One day of the route: legs from `from` through the stops to `to`, with times. */
function dayPlan(from: [number, number], stops: Stop[], to: [number, number], startMin: number) {
  const pts: [number, number][] = [from, ...stops.map((s) => at(s.item)), to];
  const legs = pts.slice(1).map((p, k) => driveMinutes(km(pts[k], p)));
  const drive = legs.reduce((a, b) => a + b, 0);
  const total = drive + stops.reduce((a, s) => a + (s.item.dur ?? 60), 0);
  return { legs, drive, total, end: startMin + total };
}

function Result({
  active,
  home,
  homeName,
  stops,
  travel,
  start,
  onRestart,
  onBack,
  owner,
  addToDay,
  ask,
  days,
  party,
  stays,
}: {
  active: boolean;
  home: StayPin;
  homeName: string;
  stops: QuizPlace[];
  travel: "drive" | "transit";
  start: string;
  onRestart: () => void;
  onBack: () => void;
  owner: boolean;
  addToDay: (date: string, refs: { key: string; itemId: string }[], nextRefs?: { key: string; itemId: string }[]) => Promise<boolean>;
  ask: ReturnType<typeof useTrip>["ask"];
  days: Day[];
  party: number;
  stays: Parameters<typeof overnightNear>[0]["stays"];
}) {
  const homeAt: [number, number] = [home.lat, home.lng];
  const [h, m] = start.split(":").map(Number);
  const startMin = h * 60 + m;
  const oneDay = dayPlan(homeAt, stops, homeAt, startMin);
  // Long drives (Kai 2026-10-26): a place over 3 h one way, or over 6 h of driving in the day, asks first.
  const long = stops.some((s) => minutesFrom(homeAt, s.item) > LONG_DRIVE_MIN) || oneDay.drive > LONG_DAY_DRIVE_MIN;
  const [choice, setChoice] = useState<"day" | "overnight" | null>(null);
  const mode = long ? choice : "day";
  const icon = travel === "drive" ? "car" : "bus";
  const addable = stops.filter((s) => s.pkg);
  const cost = <p className="small">門票等花費約 <strong>{money(quizCost(stops.map((s) => s.item), party))}</strong>（{party} 人，估計）</p>;
  const ref = (s: Stop) => ({ key: s.pkg!, itemId: s.item.id });

  const [d1, d2] = splitTwoDays(homeAt, stops);
  const far = d1.at(-1);
  const night = far ? overnightNear({ stays }, at(far.item)) : null;
  const nightPin: StayPin | null = night ? { key: "quiz-night", name: night.name, lat: night.lat, lng: night.lng, home: false } : null;

  const mapDay = (list: Stop[]) => effectiveDay({ date: "quiz", seg: "tas", title: "", stay: "", driveHrs: 0, items: list.map((s) => ({ ...s.item, mode: travel === "drive" ? "drive" : "bus" })) } as Day);
  const route = (list: Stop[], legs: number[], from: ReactNode, to: ReactNode) => (
    <ol className="quiz-route">
      <li>{from}</li>
      {list.map((s, k) => (
        <li key={s.item.id}>
          <span className="small muted">
            <Icon name={icon} size={14} /> 約 {mins(legs[k])}（估計）
          </span>
          <br />
          <strong>
            {k + 1}. {s.item.name}
          </strong>{" "}
          <span className="small muted">停留約 {mins(s.item.dur ?? 60)}</span>
        </li>
      ))}
      <li>
        <span className="small muted">
          <Icon name={icon} size={14} /> 約 {mins(legs.at(-1) ?? 0)}（估計）
        </span>
        <br />
        {to}
      </li>
    </ol>
  );
  const homeMark = <span className="home-pin" aria-hidden="true" dangerouslySetInnerHTML={{ __html: HOUSE }} />;

  const addButton = (overnight: boolean) =>
    owner && addable.length > 0 && (
      <PendingButton
        className="btn"
        pendingLabel="加入中…"
        onAction={async () => {
          const choices = overnight ? days.filter((d, k) => days[k + 1] && Date.parse(days[k + 1].date) - Date.parse(d.date) === 86_400_000) : days;
          const v = await ask(overnight ? "從哪一天開始？" : "加入哪一天？", {
            body: (
              <p className="small muted">
                {overnight ? `第一天的景點加入那天、第二天的加入隔天，狀態是「待確認」；${night?.needsBooking ? `住宿（${night.name}附近）還沒訂。` : ""}` : `會把 ${addable.length} 個待安排景點加入那天，狀態是「待確認」；`}已排在別天的景點不會移動。
              </p>
            ),
            fields: [{ name: "date", label: "日期", type: "select", value: choices[0]?.date, options: choices.map((d) => ({ value: d.date, label: fmtDay(d.date) })) }],
          });
          if (!v) return null;
          return overnight ? addToDay(v.date, d1.filter((s) => s.pkg).map(ref), d2.filter((s) => s.pkg).map(ref)) : addToDay(v.date, addable.map(ref));
        }}
      >
        {overnight ? "加入連續兩天" : "加入某一天"}
      </PendingButton>
    );
  const nav = (overnight: boolean) => (
    <div className="quiz-nav">
      <button type="button" className="btn ghost" onClick={onBack}>
        ← 上一步
      </button>
      <button type="button" className="btn ghost" onClick={onRestart}>
        重新規劃
      </button>
      {long && mode && (
        <button type="button" className="btn ghost" onClick={() => setChoice(null)}>
          改成{mode === "day" ? "過夜" : "當天來回"}
        </button>
      )}
      {addButton(overnight)}
    </div>
  );

  if (!mode) {
    return (
      <section className="card section quiz-step quiz-result" aria-labelledby="q4">
        <h3 id="q4">這趟要過夜嗎？</h3>
        <p>
          {stops.filter((s) => minutesFrom(homeAt, s.item) > LONG_DRIVE_MIN).map((s) => s.item.name).join("、") || "這些景點"}
          單程開車超過 3 小時；一天來回總共要開約 <strong>{mins(oneDay.drive)}</strong>。
        </p>
        <div className="quiz-choices" role="group" aria-label="過夜或當天來回">
          <button type="button" className="chip" onClick={() => setChoice("day")}>
            當天來回
          </button>
          <button type="button" className="chip" onClick={() => setChoice("overnight")}>
            安排過夜（兩天）
          </button>
        </div>
        <div className="quiz-nav">
          <button type="button" className="btn ghost" onClick={onBack}>
            ← 上一步
          </button>
        </div>
      </section>
    );
  }

  if (mode === "overnight" && night && nightPin) {
    const p1 = dayPlan(homeAt, d1, [night.lat, night.lng], startMin);
    const p2 = dayPlan([night.lat, night.lng], d2, homeAt, startMin);
    const nightLabel = (
      <>
        <strong>在 {night.name} 過夜</strong> <span className="small muted">{night.needsBooking ? "（待找住宿）" : "（行程裡的住宿）"}</span>
      </>
    );
    return (
      <section className="card section quiz-step quiz-result" aria-labelledby="q4">
        <h3 id="q4">你的兩天一夜路線</h3>
        <h4>第一天</h4>
        <DayMap day={mapDay(d1)} active={active} focusId={null} ends={{ start: home, end: nightPin }} />
        {route(d1, p1.legs, <>{homeMark} {start} 從{homeName}出發</>, <>約 {clock(p1.end)} {nightLabel}</>)}
        <h4>第二天</h4>
        <DayMap day={mapDay(d2)} active={active} focusId={null} ends={{ start: nightPin, end: home }} />
        {route(d2, p2.legs, <>{start} 從 {night.name} 出發</>, <>{homeMark} 約 {clock(p2.end)} 回到{homeName}</>)}
        <p className="small">
          開車：第一天約 <strong>{mins(p1.drive)}</strong>、第二天約 <strong>{mins(p2.drive)}</strong>
        </p>
        {cost}
        <p className="muted small">車程依直線距離估算。{night.needsBooking ? "過夜的城鎮是建議，住宿還沒訂。" : ""}</p>
        {nav(true)}
      </section>
    );
  }

  return (
    <section className="card section quiz-step quiz-result" aria-labelledby="q4">
      <h3 id="q4">你的一日路線</h3>
      {long && (
        <p className="small quiz-warn" role="note">
          當天來回要開約 {mins(oneDay.drive)}，約 {clock(oneDay.end)} 才回到{homeName}；請注意疲勞駕駛和夜間動物。
        </p>
      )}
      <DayMap day={mapDay(stops)} active={active} focusId={null} ends={{ start: home, end: home }} />
      {route(stops, oneDay.legs, <>{homeMark} {start} 從{homeName}出發</>, <>{homeMark} 約 {clock(oneDay.end)} 回到{homeName}</>)}
      <p className="small">
        全程約 <strong>{mins(oneDay.total)}</strong>
      </p>
      {cost}
      <p className="muted small">車程依直線距離估算；地圖上已算過的路段會沿實際道路畫出。{travel === "transit" ? "大眾運輸的時間可能更長，出發前請查班次。" : ""}</p>
      {nav(false)}
    </section>
  );
}
