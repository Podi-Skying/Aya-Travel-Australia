/*
 * Hand-drawn "walk the day's route" engine, ported from prototypes/route-walk/index.html
 * (design spec: prototypes/route-walk/DESIGN.md). No libraries. One sticky 100vh stage per
 * day; vertical scroll moves a sketched walker along a hand-drawn path, line art is drawn
 * stroke by stroke as the walker approaches. Returns a cleanup function.
 */

export type WalkItem = {
  time: string;
  dur: number;
  name: string;
  en?: string;
  pri: "must" | "pref" | "repl";
  mode: string;
  travel?: Partial<Record<string, number>>;
};
export type WalkDay = { date: string; seg: string; segName: string; title: string; driveHrs: number; needsDriver: boolean; driverOk: boolean; items: WalkItem[] };

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const MODE: Record<string, string> = { walk: "步行", bus: "公車", drive: "開車", ferry: "渡輪", train: "火車", flight: "飛行" };

function esc(s: unknown) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function md(d: string) {
  const p = d.split("-").map(Number);
  return p[1] + "/" + p[2];
}
function wd(d: string) {
  const p = d.split("-").map(Number);
  return WD[new Date(p[0], p[1] - 1, p[2]).getDay()];
}
function mins(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return (h ? h + " 小時 " : "") + (r ? r + " 分" : "");
}

/* ---------- line-art library (stroke only), from the prototype ---------- */
const ART: Record<string, string> = {
  opera: '<path d="M8 82 H142"/><path d="M22 82 Q30 40 56 30 Q50 56 56 82"/><path d="M50 82 Q62 36 92 28 Q82 56 86 82"/><path d="M82 82 Q96 50 122 46 Q114 64 118 82"/><path d="M16 92 Q30 88 44 92 T72 92 T100 92 T128 92" class="accent"/>',
  bridge: '<path d="M6 70 Q75 4 144 70"/><path d="M6 60 H144"/><path d="M30 60 V36 M52 60 V22 M75 60 V16 M98 60 V22 M120 60 V36"/><path d="M12 84 Q32 80 52 84 T92 84 T132 84" class="accent"/>',
  lighthouse: '<path d="M62 92 L68 30 H82 L88 92 Z"/><path d="M64 70 H86 M66 50 H84"/><path d="M66 30 V22 H84 V30"/><path d="M75 22 V14"/><path d="M90 24 L118 16 M90 28 L120 30" class="accent"/><path d="M30 92 Q52 86 75 92 T120 92"/>',
  mountain: '<path d="M6 90 L44 36 L60 54 L84 18 L120 70 L144 90"/><path d="M76 30 L84 18 L92 30 L86 27 L80 31 Z"/><path d="M30 90 Q42 76 56 84"/><path d="M102 80 Q112 72 124 80" class="accent"/>',
  waterfall: '<path d="M20 30 Q40 26 60 30 L64 92"/><path d="M90 92 L94 30 Q112 26 130 30"/><path d="M66 32 Q70 60 68 92 M74 32 Q78 60 76 92 M82 32 Q86 60 84 92" class="accent"/><path d="M40 92 Q75 84 110 92"/>',
  beach: '<circle cx="112" cy="30" r="12" class="accent"/><path d="M6 64 Q24 56 42 64 T78 64 T114 64 T150 64"/><path d="M14 78 Q32 70 50 78 T86 78 T122 78"/><path d="M6 92 Q60 84 144 92"/><path d="M30 40 L36 44 L42 40 M50 34 L55 37 L60 34"/>',
  boat: '<path d="M30 70 H124 L110 86 H42 Z"/><path d="M52 70 V50 H96 V70"/><path d="M60 50 V60 H70 V50 M78 50 V60 H88 V50"/><path d="M74 50 V36 L96 44 L74 46" class="accent"/><path d="M8 94 Q24 88 40 94 T72 94 T104 94 T136 94"/>',
  market: '<path d="M14 92 V56 L40 38 L66 56 V92"/><path d="M66 92 V60 L92 42 L118 60 V92"/><path d="M20 60 H60 M72 64 H112"/><path d="M8 26 Q40 40 75 24 T144 26" /><path d="M24 30 l4 8 4 -7 M52 32 l4 8 4 -8 M84 26 l4 8 4 -8 M112 26 l4 8 4 -7" class="accent"/>',
  museum: '<path d="M20 44 L75 18 L130 44 Z"/><path d="M24 92 H126 M20 84 H130"/><path d="M34 50 V84 M56 50 V84 M94 50 V84 M116 50 V84"/><circle cx="75" cy="66" r="10" class="accent"/>',
  plane: '<path d="M30 60 L104 46 Q126 42 128 48 Q130 54 108 58 L34 72 Z"/><path d="M66 54 L52 30 H62 L86 50"/><path d="M70 64 L60 86 H70 L88 60"/><path d="M36 60 L28 46 H36 L46 58"/><path d="M8 88 Q40 84 60 90" class="accent" stroke-dasharray="3 6"/>',
  cave: '<path d="M10 92 Q14 30 75 24 Q136 30 140 92"/><path d="M36 92 Q40 50 75 46 Q110 50 114 92"/><path d="M56 48 L60 60 L64 48 M80 46 L84 62 L88 47 M96 52 L99 60 L102 54" class="accent"/>',
  forest: '<path d="M36 92 V56"/><path d="M36 60 Q18 54 22 36 Q28 20 40 22 Q56 22 54 40 Q54 56 36 60"/><path d="M80 92 V40"/><path d="M80 46 Q58 40 62 20 Q70 4 84 8 Q102 10 98 28 Q98 44 80 46"/><path d="M118 92 V62"/><path d="M118 66 Q104 62 106 50 Q110 40 120 42 Q132 44 130 54 Q130 64 118 66"/><path d="M14 92 H140"/><path d="M90 30 Q96 36 92 44" class="accent"/>',
  animal: '<path d="M30 76 Q28 46 66 44 Q104 42 112 66 Q116 80 100 82 H40 Q30 82 30 76 Z"/><path d="M104 56 Q120 50 124 62 Q124 70 112 70"/><circle cx="116" cy="60" r="1.6"/><path d="M44 82 V90 M60 82 V90 M88 82 V90 M100 82 V90"/><path d="M110 52 L108 46 L114 50" /><path d="M14 92 H140"/><path d="M50 56 Q60 50 72 54" class="accent"/>',
  town: '<path d="M14 92 V58 L34 42 L54 58 V92"/><path d="M54 92 V50 L78 32 L102 50 V92"/><path d="M102 92 V64 L120 52 L138 64 V92"/><path d="M28 70 H40 V82 H28 Z M70 62 H86 V92 H70"/><path d="M72 26 Q78 18 84 26" class="accent"/><path d="M8 92 H144"/>',
  food: '<ellipse cx="75" cy="78" rx="50" ry="12"/><path d="M40 74 Q46 52 75 50 Q104 52 110 74"/><path d="M60 40 Q56 32 62 26 M76 38 Q72 28 78 20 M92 40 Q88 32 94 26" class="accent"/><path d="M10 92 H140"/>'
};

const WASH: Record<string, string> = { opera: "--wash-syd", bridge: "--wash-syd", lighthouse: "--wash-sea", plane: "--wash-sun", waterfall: "--wash-sea", cave: "--wash-sun", boat: "--wash-sea", market: "--wash-sun", museum: "--wash-syd", animal: "--wash-leaf", food: "--wash-sun", forest: "--wash-leaf", beach: "--wash-sea", mountain: "--wash-leaf", town: "--wash-syd" };

const PERSON =
  '<g class="person">' +
  '<path class="legL" d="M35 54 L35 76"/><path class="legR" d="M35 54 L35 76"/>' +
  '<path class="fillp" d="M27 34 Q27 28 35 28 Q43 28 43 34 V54 H27 Z"/>' +
  '<path d="M24 34 Q20 36 21 48 L27 50" />' +
  '<path class="arm" d="M43 36 L46 48"/>' +
  '<circle class="fillp" cx="35" cy="19" r="7"/>' +
  '<path d="M28 17 Q30 10 35 10 Q41 10 42 16"/>' +
  '<path class="scarf" d="M29 28 Q35 32 41 28 M40 29 L44 37"/>' +
  '</g>';
const RIDES: Record<string, string> = {
  car: '<g class="ride car"><path class="fillp" d="M6 66 Q6 56 16 56 L24 46 H48 L58 56 Q66 56 66 64 V68 H6 Z"/><path d="M27 48 V56 M44 48 V56"/><circle class="fillp wheel" cx="18" cy="70" r="6"/><circle class="fillp wheel" cx="54" cy="70" r="6"/><path class="scarf" d="M10 62 H16"/></g>',
  boat: '<g class="ride boat"><path class="fillp" d="M4 62 H66 L58 74 H12 Z"/><path class="fillp" d="M20 62 V50 H48 V62"/><path class="scarf" d="M34 50 V38 L46 44 L34 46"/><path class="wave" d="M0 80 Q8 76 16 80 T32 80 T48 80 T64 80 T80 80"/></g>',
  plane: '<g class="ride plane"><path class="fillp" d="M8 52 L56 42 Q68 40 69 44 Q70 48 58 51 L12 62 Z"/><path d="M34 48 L26 30 H32 L46 46"/><path d="M36 56 L30 70 H36 L46 54"/><path class="scarf" d="M12 54 L6 44 H12 L18 52"/></g>',
  bus: '<g class="ride bus"><rect class="fillp" x="6" y="44" width="58" height="26" rx="5"/><path d="M12 50 H22 V58 H12 Z M28 50 H38 V58 H28 Z M44 50 H54 V58 H44 Z"/><circle class="fillp wheel" cx="18" cy="72" r="5"/><circle class="fillp wheel" cx="52" cy="72" r="5"/><path class="scarf" d="M6 64 H64"/></g>'
};
const WALKER = '<svg viewBox="0 0 70 80">' + PERSON + RIDES.car + RIDES.boat + RIDES.plane + RIDES.bus + "</svg>";

export function artFor(it: { name: string; en?: string }): string {
  const s = (it.name + " " + (it.en || "")).toLowerCase();
  const rules: [RegExp, string][] = [
    [/opera|歌劇院/, "opera"], [/bridge|大橋|橋/, "bridge"], [/lighthouse|燈塔/, "lighthouse"], [/airport|flight|航班|機場|飛抵/, "plane"],
    [/falls|瀑布/, "waterfall"], [/cave|洞/, "cave"], [/ferry|渡輪|船/, "boat"], [/market|市集/, "market"], [/museum|mona|tmag|博物館|美術館/, "museum"],
    [/wildlife|devil|wombat|袋|保護區|動物/, "animal"], [/cheese|oyster|午餐|晚餐|brunch|早午餐|咖啡|bakery|麵包/, "food"],
    [/airwalk|walk|步道|樹|forest|garden|植物園|gorge|峽谷/, "forest"], [/beach|bay|灣|海|coast|cliff|懸崖|lake|湖/, "beach"],
    [/mount|kunanyi|cradle|山|echo|三姊妹/, "mountain"],
  ];
  for (const [re, k] of rules) if (re.test(s)) return k;
  return "town";
}

type Ride = "person" | "car" | "boat" | "plane" | "bus";
function rideFor(mode: string | undefined): Ride {
  return mode === "drive" ? "car" : mode === "ferry" ? "boat" : mode === "flight" ? "plane" : mode === "bus" || mode === "train" ? "bus" : "person";
}

/* ---------- distant lines: Sydney skyline, Tasmania ridges ---------- */
function rnd(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
function ridge(w: number, y: number, seed: number, amp: number) {
  const r = rnd(seed);
  let d = "M0 " + y;
  let x = 0;
  while (x < w) {
    const nx = x + 90 + r() * 160;
    const py = y - r() * amp;
    d += " Q" + (x + (nx - x) / 2).toFixed(0) + " " + (py - amp * 0.3).toFixed(0) + " " + nx.toFixed(0) + " " + (y - r() * amp * 0.3).toFixed(0);
    x = nx;
  }
  return d;
}
function skylineLine(w: number, y: number, seed: number) {
  const r = rnd(seed);
  let d = "M0 " + y;
  let x = 0;
  while (x < w) {
    if (r() > 0.55) {
      const bw = 26 + r() * 50;
      const bh = 30 + r() * 110;
      d += " L" + x.toFixed(0) + " " + (y - bh).toFixed(0) + " L" + (x + bw).toFixed(0) + " " + (y - bh).toFixed(0) + " L" + (x + bw).toFixed(0) + " " + y;
      x += bw;
    }
    x += 20 + r() * 80;
    d += " L" + x.toFixed(0) + " " + y;
  }
  return d;
}
function birds(w: number, h: number, seed: number) {
  const r = rnd(seed);
  let out = "";
  for (let x = 200; x < w; x += 500 + r() * 700) {
    const y = h * (0.12 + r() * 0.2);
    const s = 5 + r() * 4;
    out += '<path d="M' + x + " " + y + " q" + s + " -" + s * 0.7 + " " + s * 2 + " 0 q" + s + " -" + s * 0.7 + " " + s * 2 + ' 0"/>';
  }
  return out;
}
function clouds(w: number, h: number, seed: number) {
  const r = rnd(seed);
  let out = "";
  for (let x = 120; x < w; x += 600 + r() * 600) {
    const y = h * (0.18 + r() * 0.14);
    const s = 1 + r() * 0.6;
    out += '<path d="M' + x + " " + y + " q" + 10 * s + " -" + 16 * s + " " + 28 * s + " -6 q" + 14 * s + " -" + 18 * s + " " + 32 * s + " 2 q" + 18 * s + " -2 " + 16 * s + " " + 10 * s + ' Z"/>';
  }
  return out;
}

type Spot = { el: HTMLElement; wash: HTMLElement; strokes: (SVGGeometryElement & { _l: number })[] };
type DayState = {
  d: WalkDay;
  i: number;
  sec: HTMLElement;
  track: HTMLElement;
  far: HTMLElement;
  title: HTMLElement;
  W: number;
  vw: number;
  vh: number;
  path: SVGPathElement;
  len: number;
  dots: NodeListOf<SVGCircleElement>;
  stopLen: number[];
  L0: number;
  spots: Spot[];
  walker: HTMLElement;
  say: HTMLElement;
  rides: Record<Ride, SVGGElement>;
  legL: Element;
  legR: Element;
  arm: Element;
};

export function startWalk(root: HTMLElement, days: WalkDay[]): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const container = root.querySelector<HTMLElement>("#rw-days")!;
  const jump = root.querySelector<HTMLSelectElement>("#rw-jump")!;
  const nowEl = root.querySelector<HTMLElement>("#rw-now")!;
  const progEl = root.querySelector<HTMLElement>("#rw-prog")!;
  const total = days.length;
  container.innerHTML = "";
  jump.innerHTML = "";
  if (!total) return () => {};

  const D: DayState[] = days.map((d, di) => {
    const sec = document.createElement("section");
    sec.className = "day " + d.seg;
    sec.id = di === 0 ? "rw-top" : "rw-d" + d.date;
    sec.setAttribute("aria-label", "第 " + (di + 1) + " 天 " + md(d.date) + " " + d.title);
    const no = String(di + 1).padStart(2, "0");
    const driver = d.needsDriver ? (d.driverOk ? "・朋友開車（已確認）" : "・需朋友開車（未確認）") : "";
    const segs = [...new Set(days.map((x) => x.segName))];
    const title =
      di === 0
        ? '<div class="title hero"><h1><span>跟著 Aya，</span><br><span>走過南方的<em>每一天</em>。</span></h1><div class="lead">' +
          md(days[0].date) + " – " + md(days[total - 1].date) + "，" + esc(segs.join("，接著")) +
          "。往下捲動，小人會沿著當天路線走過每個景點，走完就換到下一天。</div>" +
          '<div class="cue"><svg viewBox="0 0 18 40"><path d="M9 2 V34 M3 28 L9 36 L15 28" fill="none" stroke="#d2483a" stroke-width="1.4" stroke-linecap="round"/></svg>往下捲動，開始散步</div></div>'
        : '<div class="title"><div class="no">' + no + "<small>DAY</small></div><h2>" + esc(d.title) + "</h2><p>" + md(d.date) + "（" + wd(d.date) + "）・" +
          (d.seg === "syd" ? "SYDNEY " : d.seg === "tas" ? "TASMANIA " : "") + esc(d.segName) + driver + "</p></div>";
    sec.innerHTML = '<div class="stage"><div class="layer far"></div><div class="track"></div>' + title + "</div>";
    container.appendChild(sec);
    const opt = document.createElement("option");
    opt.value = String(di);
    opt.textContent = no + "｜" + md(d.date) + " " + d.title;
    jump.appendChild(opt);
    return { d, i: di, sec, track: sec.querySelector<HTMLElement>(".track")!, far: sec.querySelector<HTMLElement>(".far")!, title: sec.querySelector<HTMLElement>(".title")! } as DayState;
  });

  function layout() {
    const vw = innerWidth;
    const vh = innerHeight;
    const small = vw < 680;
    const gap = small ? Math.max(260, vw * 0.78) : Math.max(340, Math.min(480, vw * 0.36));
    const startX = small ? vw * 0.78 : vw * 0.62; // leave room for the title before the first stop
    D.forEach((o) => {
      const items = o.d.items;
      const n = items.length;
      const lastX = startX + gap * Math.max(0, n - 1);
      const W = n ? lastX + vw * 0.55 : vw;
      o.W = W;
      o.vw = vw;
      o.vh = vh;
      o.sec.style.height = (n ? lastX - vw * 0.42 + vh * 1.7 : vh * 1.5) + "px";
      o.track.style.width = W + "px";
      const seed = Number(o.d.date.replace(/-/g, "")) % 9973;
      const gy = vh * 0.66;

      const fw = W * 0.5 + vw;
      o.far.style.width = fw + "px";
      o.far.innerHTML =
        '<svg class="ink" width="' + fw + '" height="' + vh + '" viewBox="0 0 ' + fw + " " + vh + '"><g class="sketch" fill="none" stroke="#b9b2a4" stroke-width="1.2" stroke-linecap="round">' +
        '<path d="' + (o.d.seg === "syd" ? skylineLine(fw, gy - 10, seed) : ridge(fw, gy - 20, seed, vh * 0.16)) + '"/>' +
        (o.d.seg === "syd" ? "" : '<path d="' + ridge(fw, gy - 4, seed + 3, vh * 0.07) + '" stroke-dasharray="1 7"/>') +
        clouds(fw, vh, seed + 1) + birds(fw, vh, seed + 2) + "</g></svg>";

      const pts: [number, number][] = [[-40, gy]];
      items.forEach((_, k) => pts.push([startX + gap * k, gy + (k % 2 ? 1 : -1) * vh * 0.025]));
      pts.push([W + 40, gy]);
      let dStr = "M" + pts[0][0] + " " + pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const mx = (p0[0] + p1[0]) / 2;
        dStr += " C" + mx + " " + p0[1] + " " + mx + " " + p1[1] + " " + p1[0] + " " + p1[1];
      }
      o.track.innerHTML =
        '<svg class="ink" width="' + W + '" height="' + vh + '" viewBox="0 0 ' + W + " " + vh + '">' +
        '<g class="sketch" fill="none" stroke-linecap="round">' +
        '<path d="' + dStr + '" stroke="#2b2a27" stroke-width="1.4"/>' +
        '<path d="' + dStr + '" stroke="#2b2a27" stroke-width=".6" transform="translate(0 3)" opacity=".5"/>' +
        '<path class="walked" d="' + dStr + '" stroke="#d2483a" stroke-width="2.6"/>' +
        "</g>" +
        items.map((_, k) => '<circle cx="' + pts[k + 1][0] + '" cy="' + pts[k + 1][1] + '" r="4.5" fill="#faf7f0" stroke="#2b2a27" stroke-width="1.4" class="dot"/>').join("") +
        "</svg>";
      o.path = o.track.querySelector<SVGPathElement>(".walked")!;
      o.len = o.path.getTotalLength();
      o.path.style.strokeDasharray = String(o.len);
      o.path.style.strokeDashoffset = String(o.len);
      o.dots = o.track.querySelectorAll<SVGCircleElement>(".dot");

      const lenAtX = (x: number) => {
        let lo = 0;
        let hi = o.len;
        for (let j = 0; j < 28; j++) {
          const m = (lo + hi) / 2;
          if (o.path.getPointAtLength(m).x < x) lo = m;
          else hi = m;
        }
        return lo;
      };
      o.stopLen = items.map((_, k) => lenAtX(pts[k + 1][0]));
      o.L0 = n ? Math.min(lenAtX(small ? vw * 0.22 : vw * 0.3), o.stopLen[0]) : 0; // walker starts on screen

      o.spots = items.map((it, k) => {
        const kind = artFor(it);
        const up = k % 2 === 0;
        const x = pts[k + 1][0];
        const y = pts[k + 1][1];
        const wash = document.createElement("div");
        const ws = small ? 150 : 190;
        wash.className = "wash";
        wash.style.cssText =
          "left:" + x + "px;top:" + (up ? y - ws * 0.62 : y + ws * 0.55) + "px;width:" + ws + "px;height:" + ws * 0.72 + "px;background:radial-gradient(ellipse at 45% 55%, var(" + WASH[kind] + ") 0%, transparent 70%)";
        o.track.appendChild(wash);
        const el = document.createElement("div");
        el.className = "spot" + (up ? "" : " below");
        el.innerHTML =
          '<svg class="art sketch" viewBox="0 0 150 110" aria-hidden="true">' + ART[kind] + "</svg>" +
          '<div class="meta"><div class="time">' + esc(it.time) + "　·　" + mins(it.dur) + "</div><h3>" + esc(it.name) + '</h3><div class="en">' + esc(it.en || "") + "</div>" +
          (it.pri === "must" ? '<span class="must">必 去</span>' : "") + "</div>";
        el.style.left = x + "px";
        if (up) {
          el.style.top = "auto";
          el.style.bottom = vh - y + 14 + "px";
          el.style.display = "flex";
          el.style.flexDirection = "column-reverse";
        } else el.style.top = y + 4 + "px";
        o.track.appendChild(el);
        // Hide every stroke; they are drawn as the walker approaches.
        const strokes = Array.from(el.querySelectorAll<SVGGeometryElement>(".art > *")) as Spot["strokes"];
        strokes.forEach((s) => {
          const l = s.getTotalLength ? s.getTotalLength() : 200;
          s.style.strokeDasharray = String(l);
          s.style.strokeDashoffset = reduce ? "0" : String(l);
          s._l = l;
        });
        return { el, wash, strokes };
      });
      items.forEach((it, k) => {
        const t = it.travel || {};
        const sum = Object.values(t).reduce<number>((a, v) => a + (v || 0), 0);
        if (!sum || k === 0) return;
        const lg = document.createElement("div");
        lg.className = "leg";
        lg.style.left = (pts[k][0] + pts[k + 1][0]) / 2 + "px";
        lg.style.top = gy + vh * 0.075 + "px";
        lg.textContent = (MODE[it.mode] || "") + "　" + mins(sum);
        o.track.appendChild(lg);
      });
      if (!n) {
        const rest = document.createElement("div");
        rest.className = "rest";
        rest.innerHTML =
          '<svg class="sketch" viewBox="0 0 200 130" aria-hidden="true"><path d="M30 100 H170 M40 100 V122 M160 100 V122 M30 86 H170 M36 86 V74 H164 V86"/><path d="M118 74 Q116 60 124 58 H136 Q144 60 142 74"/><path d="M126 52 Q122 44 128 38 M134 52 Q130 44 136 38" stroke="#d2483a"/><circle cx="70" cy="44" r="8"/><path d="M70 52 V74 M62 60 L78 64"/></svg><p>今天不趕路，留給自己。</p>';
        o.track.appendChild(rest);
      }
      const wk = document.createElement("div");
      wk.className = "walker";
      wk.innerHTML = WALKER + '<div class="say"></div>';
      o.track.appendChild(wk);
      o.walker = wk;
      o.say = wk.querySelector<HTMLElement>(".say")!;
      o.rides = {
        person: wk.querySelector<SVGGElement>(".person")!,
        car: wk.querySelector<SVGGElement>(".car")!,
        boat: wk.querySelector<SVGGElement>(".boat")!,
        plane: wk.querySelector<SVGGElement>(".plane")!,
        bus: wk.querySelector<SVGGElement>(".bus")!,
      };
      o.legL = wk.querySelector(".legL")!;
      o.legR = wk.querySelector(".legR")!;
      o.arm = wk.querySelector(".arm")!;
    });
    update();
  }

  let curIdx = 0;
  function update() {
    const vh = innerHeight;
    const mid = scrollY + vh * 0.5;
    D.forEach((o) => {
      if (!o.path) return;
      const top = o.sec.offsetTop;
      const h = o.sec.offsetHeight;
      if (mid >= top && mid < top + h) curIdx = o.i;
      const raw = (scrollY - top) / Math.max(1, h - vh);
      if (raw < -1.2 || raw > 2.2) return;
      const p = Math.min(1, Math.max(0, raw));
      const n = o.d.items.length;
      const q = Math.min(1, Math.max(0, (p - 0.06) / 0.88));
      const Lmax = n ? o.stopLen[n - 1] : 0;
      const L = n ? o.L0 + (Lmax - o.L0) * q : 0;
      const pt = n ? o.path.getPointAtLength(L) : { x: o.vw * 0.3, y: o.vh * 0.66 };
      const cam = Math.min(Math.max(0, o.W - o.vw), Math.max(0, pt.x - o.vw * 0.42));
      o.track.style.transform = "translate3d(" + (-cam).toFixed(1) + "px,0,0)";
      o.far.style.transform = "translate3d(" + (-cam * 0.5).toFixed(1) + "px,0,0)";
      if (n) o.path.style.strokeDashoffset = (o.len - L).toFixed(1);
      // The day title fades out once walking starts.
      const fade = Math.min(1, Math.max(0, 1 - (p - 0.02) / 0.12));
      o.title.style.opacity = fade.toFixed(3);
      o.title.style.transform = "translate3d(" + (-(1 - fade) * 40).toFixed(1) + "px,0,0)";

      let near = -1;
      let idx = 0;
      while (idx < n && L >= o.stopLen[idx] - 2) idx++;
      for (let k = 0; k < n; k++) {
        const dist = L - o.stopLen[k];
        if (Math.abs(dist) < 36) near = k;
        const reveal = reduce ? 1 : Math.min(1, Math.max(0, (dist + o.vw * 0.78) / (o.vw * 0.26)));
        const s = o.spots[k];
        s.strokes.forEach((st) => {
          st.style.strokeDashoffset = (st._l * (1 - reveal)).toFixed(1);
        });
        s.wash.classList.toggle("on", reveal > 0.6);
        s.el.classList.toggle("seen", reduce || dist > -o.vw * 0.25);
        o.dots[k].setAttribute("fill", dist > -6 ? "#d2483a" : "#faf7f0");
      }
      const next = o.d.items[Math.min(idx, n - 1)];
      let ride: Ride = !n || near >= 0 || q === 0 ? "person" : rideFor(next?.mode);
      if (n && idx === 0) ride = "person";
      (Object.keys(o.rides) as Ride[]).forEach((key) => {
        o.rides[key].style.display = key === ride ? "" : "none";
      });
      let lift = 0;
      if (ride === "plane") {
        const a = o.stopLen[idx - 1] || 0;
        const b = o.stopLen[idx] || Lmax;
        lift = -Math.sin(Math.PI * Math.min(1, Math.max(0, (L - a) / Math.max(1, b - a)))) * o.vh * 0.18;
      }
      o.walker.style.transform = "translate3d(" + pt.x.toFixed(1) + "px," + (pt.y + lift).toFixed(1) + "px,0)";
      const ph = reduce ? 0 : Math.sin(L / 10);
      o.legL.setAttribute("d", "M35 54 L" + (35 + ph * 7).toFixed(1) + " 76");
      o.legR.setAttribute("d", "M35 54 L" + (35 - ph * 7).toFixed(1) + " 76");
      o.arm.setAttribute("d", "M43 36 L" + (46 - ph * 4).toFixed(1) + " 48");
      if (near >= 0) {
        o.say.textContent = o.d.items[near].name;
        o.say.classList.add("show");
      } else if (n && q >= 0.999) {
        o.say.textContent = "今天走完了";
        o.say.classList.add("show");
      } else o.say.classList.remove("show");
    });
    const o = D[curIdx];
    const tp = Math.min(1, Math.max(0, (scrollY - o.sec.offsetTop) / Math.max(1, o.sec.offsetHeight - vh)));
    nowEl.innerHTML = "<b>" + String(curIdx + 1).padStart(2, "0") + " / " + total + "</b><span>" + md(o.d.date) + "（" + wd(o.d.date) + "）　" + esc(o.d.title) + "</span>";
    progEl.style.width = (((curIdx + tp) / total) * 100).toFixed(2) + "%";
    if (jump.value !== String(curIdx)) jump.value = String(curIdx);
  }

  function goDay(i: number) {
    i = Math.max(0, Math.min(total - 1, i));
    scrollTo({ top: D[i].sec.offsetTop + 2, behavior: reduce ? "auto" : "smooth" });
  }
  const prev = root.querySelector<HTMLButtonElement>("#rw-prev")!;
  const next = root.querySelector<HTMLButtonElement>("#rw-next")!;
  const onPrev = () => {
    const o = D[curIdx];
    goDay(scrollY - o.sec.offsetTop > innerHeight * 0.3 ? curIdx : curIdx - 1);
  };
  const onNext = () => goDay(curIdx + 1);
  const onJump = () => goDay(Number(jump.value));
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "SELECT") return;
    if (e.key === "]") goDay(curIdx + 1);
    if (e.key === "[") goDay(curIdx - 1);
  };
  let ticking = false;
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    }
  };
  let rt: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(layout, 150);
  };
  prev.addEventListener("click", onPrev);
  next.addEventListener("click", onNext);
  jump.addEventListener("change", onJump);
  addEventListener("keydown", onKey);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  layout();
  let alive = true;
  if (document.fonts?.ready) void document.fonts.ready.then(() => alive && layout());

  return () => {
    alive = false;
    prev.removeEventListener("click", onPrev);
    next.removeEventListener("click", onNext);
    jump.removeEventListener("change", onJump);
    removeEventListener("keydown", onKey);
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onResize);
    clearTimeout(rt);
  };
}
