"use client";

import { useMemo, useState } from "react";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { PendingButton } from "./ui";
import { DayMap } from "./MapViews";
import { CATEGORY_META } from "./Places";
import ChromaGrid from "./chroma-grid/ChromaGrid";
import { driveMinutes, km, orderStops, quizCost, quizPlaces, REGIONS, type QuizPlace } from "@/domain/quiz";
import { homeStayKey } from "@/domain/stay";
import { stayPin } from "@/domain/home-pins";
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

const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f3eee3"/><path d="M0 140 C40 118 62 92 96 106 S150 62 188 84 S250 120 300 94" fill="none" stroke="#625e55" stroke-width="3" stroke-linecap="round"/></svg>',
  );

const photoOf = (i: Item) => i.photo?.url ?? i.gallery?.[0]?.url ?? PLACEHOLDER;
const accents = [...PALETTES.map((p) => p.deep), INK_PALETTE.deep];
const accentFor = (k: string) => accents[[...k].reduce((a, c) => a + c.charCodeAt(0), 0) % accents.length];

export function PlanQuiz({ active }: { active: boolean }) {
  const { doc, mode, online, runOpUndoable, ask } = useTrip();
  const [step, setStep] = useState(0);
  const [region, setRegion] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [travel, setTravel] = useState<"drive" | "transit">("drive");
  const [start, setStart] = useState("09:00");

  const homeKey = homeStayKey(doc);
  const home = homeKey ? stayPin(doc, homeKey) : null;
  const homeName = home?.name === "住處" || !homeKey ? "住處" : (doc.stays[homeKey]?.name ?? "住處");
  const places = useMemo(() => quizPlaces(doc), [doc]);
  const regions = REGIONS.map((r) => ({ r, list: places.filter((p) => p.region === r.key) })).filter((x) => x.list.length);
  const inRegion = places.filter((p) => p.region === region);
  const chosen = inRegion.filter((p) => picked.includes(p.item.id));
  const reg = REGIONS.find((r) => r.key === region);

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
            columns={3}
            radius={260}
            selectedLabel="選這裡"
            selected={regions.map((x) => x.r.key === region)}
            onToggle={(k) => {
              const key = regions[k].r.key;
              if (key !== region) setPicked([]);
              setRegion(key);
            }}
            items={regions.map(({ r, list }) => ({
              image: photoOf(list.find((p) => p.item.photo)?.item ?? list[0].item),
              title: r.name,
              subtitle: [`${list.length} 個景點`, r.car ? "需要開車" : "公車可到", r.far].filter(Boolean).join("・"),
              accent: accentFor(r.key),
            }))}
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
            columns={3}
            radius={260}
            selected={inRegion.map((p) => picked.includes(p.item.id))}
            onToggle={(k) => {
              const id = inRegion[k].item.id;
              setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
            }}
            items={inRegion.map((p) => ({
              image: photoOf(p.item),
              title: p.item.name,
              subtitle: [p.item.cat ? CATEGORY_META[p.item.cat].t : "", p.date ? `已排在 ${fmtDay(p.date)}` : ""].filter(Boolean).join("・"),
              accent: accentFor(p.item.cat ?? "other"),
            }))}
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
          addToDay={async (date, refs) => runOpUndoable({ op: "addQuizPlan", date, refs }, "已加入，可以按「復原」")}
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
}: {
  active: boolean;
  home: { key: string; name: string; lat: number; lng: number; home: boolean };
  homeName: string;
  stops: QuizPlace[];
  travel: "drive" | "transit";
  start: string;
  onRestart: () => void;
  onBack: () => void;
  owner: boolean;
  addToDay: (date: string, refs: { key: string; itemId: string }[]) => Promise<boolean>;
  ask: ReturnType<typeof useTrip>["ask"];
  days: Day[];
  party: number;
}) {
  // Legs: home → stops → home, estimated from straight-line distance (the map draws cached roads where known).
  const pts: [number, number][] = [[home.lat, home.lng], ...stops.map((s) => [s.item.lat!, s.item.lng!] as [number, number]), [home.lat, home.lng]];
  const legMin = pts.slice(1).map((p, k) => driveMinutes(km(pts[k], p)));
  const stayMin = stops.reduce((a, s) => a + (s.item.dur ?? 60), 0);
  const total = legMin.reduce((a, b) => a + b, 0) + stayMin;
  const [h, m] = start.split(":").map(Number);
  const backAt = h * 60 + m + total;
  const fakeDay = effectiveDay({ date: "quiz", seg: "tas", title: "", stay: "", driveHrs: 0, items: stops.map((s) => ({ ...s.item, mode: travel === "drive" ? "drive" : "bus" })) } as Day);
  const addable = stops.filter((s) => s.pkg);
  return (
    <section className="card section quiz-step quiz-result" aria-labelledby="q4">
      <h3 id="q4">你的一日路線</h3>
      <DayMap day={fakeDay} active={active} focusId={null} ends={{ start: home, end: home }} />
      <ol className="quiz-route">
        <li>
          <span className="home-pin" aria-hidden="true" dangerouslySetInnerHTML={{ __html: HOUSE }} /> {start} 從{homeName}出發
        </li>
        {stops.map((s, k) => (
          <li key={s.item.id}>
            <span className="small muted">
              <Icon name={travel === "drive" ? "car" : "bus"} size={14} /> 約 {mins(legMin[k])}（估計）
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
            <Icon name={travel === "drive" ? "car" : "bus"} size={14} /> 約 {mins(legMin.at(-1) ?? 0)}（估計）
          </span>
          <br />
          <span className="home-pin" aria-hidden="true" dangerouslySetInnerHTML={{ __html: HOUSE }} /> 約 {String(Math.floor(backAt / 60) % 24).padStart(2, "0")}:{String(backAt % 60).padStart(2, "0")} 回到{homeName}
        </li>
      </ol>
      <p className="small">
        全程約 <strong>{mins(total)}</strong>・門票等花費約 <strong>{money(quizCost(stops.map((s) => s.item), party))}</strong>（{party} 人，估計）
      </p>
      <p className="muted small">車程依直線距離估算；地圖上已算過的路段會沿實際道路畫出。{travel === "transit" ? "大眾運輸的時間可能更長，出發前請查班次。" : ""}</p>
      <div className="quiz-nav">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← 上一步
        </button>
        <button type="button" className="btn ghost" onClick={onRestart}>
          重新規劃
        </button>
        {owner && addable.length > 0 && (
          <PendingButton
            className="btn"
            pendingLabel="加入中…"
            onAction={async () => {
              const v = await ask("加入哪一天？", {
                body: <p className="small muted">會把 {addable.length} 個待安排景點加入那天，狀態是「待確認」；已排在別天的景點不會移動。</p>,
                fields: [{ name: "date", label: "日期", type: "select", value: days[0]?.date, options: days.map((d) => ({ value: d.date, label: fmtDay(d.date) })) }],
              });
              if (!v) return null;
              return addToDay(v.date, addable.map((s) => ({ key: s.pkg!, itemId: s.item.id })));
            }}
          >
            加入某一天
          </PendingButton>
        )}
      </div>
    </section>
  );
}
