/*
 * "Walk the day's route" page, ported from prototypes/route-walk/route-walk.html
 * (no libraries). Each day is a tall section with a sticky stage; vertical scroll
 * moves the walker along an SVG path through the day's stops. Returns a cleanup.
 */

export type WalkItem = {
  time: string;
  dur: number;
  name: string;
  en?: string;
  pri: "must" | "pref" | "repl";
  mode: string;
  travel?: Partial<Record<string, number>>;
  cost?: { amount: number; unit: string; status: string };
};
export type WalkDay = { date: string; seg: string; segName: string; title: string; driveHrs: number; needsDriver: boolean; driverOk: boolean; items: WalkItem[] };

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const MODE: Record<string, string> = { walk: "步行", bus: "大眾運輸", drive: "開車", ferry: "渡輪", train: "火車", flight: "飛機" };
const PRI: Record<string, string> = { must: "必去", pref: "優先", repl: "可替換" };

function esc(s: unknown) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function fmt(d: string) {
  const p = d.split("-").map(Number);
  const dt = new Date(p[0], p[1] - 1, p[2]);
  return p[1] + "/" + p[2] + "（" + WD[dt.getDay()] + "）";
}
function mins(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return (h ? h + " 小時" : "") + (r ? r + " 分" : "") || "0 分";
}

/* ---------- procedural silhouettes ---------- */
function rnd(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
function mountains(w: number, h: number, seed: number, base: number, amp: number, color: string) {
  const r = rnd(seed);
  let d = "M0 " + h + " L0 " + (h - base);
  let x = 0;
  while (x < w) {
    x += 60 + r() * 120;
    d += " L" + x.toFixed(0) + " " + (h - base - r() * amp).toFixed(0);
  }
  return '<path d="' + d + " L" + w + " " + h + 'Z" fill="' + color + '"/>';
}
function skyline(w: number, h: number, seed: number, color: string) {
  const r = rnd(seed);
  let out = "";
  let x = 0;
  while (x < w) {
    const bw = 30 + r() * 70;
    const bh = 60 + r() * 180;
    out += '<rect x="' + x.toFixed(0) + '" y="' + (h - bh).toFixed(0) + '" width="' + bw.toFixed(0) + '" height="' + bh.toFixed(0) + '" fill="' + color + '"/>';
    if (r() > 0.85) out += '<path d="M' + (x + bw * 0.2) + " " + (h - bh) + " Q" + (x + bw / 2) + " " + (h - bh - 50) + " " + (x + bw * 0.8) + " " + (h - bh) + 'Z" fill="' + color + '"/>';
    x += bw + 6 + r() * 30;
  }
  return out;
}
function trees(w: number, h: number, seed: number, color: string) {
  const r = rnd(seed);
  let out = "";
  let x = 20;
  while (x < w) {
    const th = 50 + r() * 70;
    out += '<path d="M' + x + " " + h + " L" + x + " " + (h - th * 0.4) + '" stroke="' + color + '" stroke-width="4"/>';
    out += '<ellipse cx="' + x + '" cy="' + (h - th * 0.6) + '" rx="' + (14 + r() * 14) + '" ry="' + th * 0.35 + '" fill="' + color + '"/>';
    x += 40 + r() * 160;
  }
  return out;
}

const WALKER =
  '<svg viewBox="-32 -64 64 70"><ellipse class="shadow" cx="0" cy="2" rx="14" ry="3"/>' +
  '<g class="person"><line class="legL" x1="0" y1="-20" x2="0" y2="0" stroke="#1f2a2b" stroke-width="4" stroke-linecap="round"/>' +
  '<line class="legR" x1="0" y1="-20" x2="0" y2="0" stroke="#1f2a2b" stroke-width="4" stroke-linecap="round"/>' +
  '<rect x="-8" y="-40" width="16" height="22" rx="6" fill="#e0231c"/>' +
  '<rect x="-15" y="-38" width="9" height="15" rx="3" fill="#7a5a3a"/>' +
  '<line class="armR" x1="5" y1="-36" x2="5" y2="-24" stroke="#1f2a2b" stroke-width="3.5" stroke-linecap="round"/>' +
  '<circle cx="0" cy="-48" r="8" fill="#f2c9a5"/><path d="M-9 -50 Q0 -62 9 -50 Z" fill="#2c2c2c"/></g>' +
  '<g class="car" style="display:none"><rect x="-26" y="-22" width="52" height="16" rx="5" fill="#1f7a6d"/><path d="M-16 -22 L-10 -34 L12 -34 L18 -22 Z" fill="#1f7a6d"/><rect x="-8" y="-32" width="9" height="8" fill="#cfe7ef"/><rect x="3" y="-32" width="9" height="8" fill="#cfe7ef"/><circle class="wheel" cx="-14" cy="-5" r="6" fill="#1f2a2b"/><circle class="wheel" cx="14" cy="-5" r="6" fill="#1f2a2b"/></g>' +
  '<g class="boat" style="display:none"><path d="M-28 -12 L28 -12 L18 0 L-18 0 Z" fill="#1f5f8b"/><rect x="-10" y="-26" width="22" height="14" rx="2" fill="#fff" stroke="#1f5f8b" stroke-width="2"/><path class="wave" d="M-34 4 Q-26 0 -18 4 T-2 4 T14 4 T30 4" stroke="#7fb8d6" stroke-width="2" fill="none"/></g>' +
  '<g class="plane" style="display:none"><path d="M-28 -30 L22 -30 Q32 -30 32 -26 Q32 -22 22 -22 L-28 -22 Z" fill="#fff" stroke="#1f2a2b" stroke-width="2"/><path d="M-4 -26 L-16 -6 L-8 -6 L8 -26 Z" fill="#c2643a"/><path d="M-26 -30 L-32 -42 L-24 -42 L-18 -30 Z" fill="#c2643a"/></g>' +
  '<g class="bus" style="display:none"><rect x="-26" y="-34" width="52" height="28" rx="5" fill="#d9a441"/><rect x="-20" y="-30" width="10" height="9" fill="#fff"/><rect x="-6" y="-30" width="10" height="9" fill="#fff"/><rect x="8" y="-30" width="10" height="9" fill="#fff"/><circle class="wheel" cx="-14" cy="-5" r="6" fill="#1f2a2b"/><circle class="wheel" cx="14" cy="-5" r="6" fill="#1f2a2b"/></g></svg>';

type Vehicle = "person" | "car" | "boat" | "plane" | "bus";
function vehicleFor(mode: string | undefined): Vehicle {
  return mode === "drive" ? "car" : mode === "ferry" ? "boat" : mode === "flight" ? "plane" : mode === "bus" || mode === "train" ? "bus" : "person";
}

type DayState = {
  d: WalkDay;
  sec: HTMLElement;
  track: HTMLElement;
  road: SVGSVGElement;
  far: HTMLElement;
  mid: HTMLElement;
  bars: HTMLElement[];
  nav: HTMLAnchorElement;
  W: number;
  vw: number;
  path: SVGPathElement;
  len: number;
  stopLen: number[];
  stops: HTMLElement[];
  walker: HTMLElement;
  bubble: HTMLElement;
  parts: Record<Vehicle, HTMLElement>;
  legL: Element;
  legR: Element;
  arm: Element;
  wheels: NodeListOf<Element>;
};

export function startWalk(root: HTMLElement, days: WalkDay[]): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const container = root.querySelector<HTMLElement>("#rw-days")!;
  const nav = root.querySelector<HTMLElement>("#rw-daynav")!;
  container.innerHTML = "";
  nav.innerHTML = "";

  const D: DayState[] = days.map((d, di) => {
    const sec = document.createElement("section");
    sec.className = "day " + d.seg;
    sec.id = "d" + d.date;
    sec.setAttribute("aria-label", fmt(d.date) + " " + d.title);
    const items = d.items;
    sec.innerHTML =
      '<div class="stage"><div class="sky"></div>' +
      '<div class="layer far"></div><div class="layer mid"></div>' +
      '<div class="track"><svg class="road" aria-hidden="true"></svg></div>' +
      '<div class="head"><div class="dno">DAY ' + (di + 1) + "　" + fmt(d.date) + "　" + esc(d.segName) + "</div><h2>" + esc(d.title) + "</h2>" +
      '<div class="meta"><span>' + items.length + " 個點</span>" + (d.driveHrs ? "<span>開車約 " + d.driveHrs + " 小時</span>" : "") +
      (d.needsDriver ? "<span>" + (d.driverOk ? "朋友開車（已確認）" : "需朋友開車（未確認）") + "</span>" : "") + "</div></div>" +
      '<div class="pbar" aria-hidden="true">' + (items.length ? items.map(() => "<i><b></b></i>").join("") : "<i><b></b></i>") + "</div></div>";
    container.appendChild(sec);
    const a = document.createElement("a");
    a.href = "#" + sec.id;
    a.textContent = di + 1 + "｜" + fmt(d.date).replace(/（.）/, "");
    if (d.seg === "syd") a.className = "syd";
    nav.appendChild(a);
    return {
      d,
      sec,
      track: sec.querySelector<HTMLElement>(".track")!,
      road: sec.querySelector<SVGSVGElement>(".road")!,
      far: sec.querySelector<HTMLElement>(".far")!,
      mid: sec.querySelector<HTMLElement>(".mid")!,
      bars: Array.from(sec.querySelectorAll<HTMLElement>(".pbar b")),
      nav: a,
    } as DayState;
  });

  function layout() {
    const vw = innerWidth;
    const vh = innerHeight;
    const gap = Math.max(300, Math.min(520, vw * 0.62));
    D.forEach((o) => {
      const items = o.d.items;
      const n = items.length;
      // The last stop lands at 42% of the screen, where the camera follows.
      const W = n ? vw * 0.45 + gap * (n - 0.5) + vw * 0.58 : vw;
      o.W = W;
      o.vw = vw;
      // Section height = horizontal distance + one screen, so scroll equals the walk.
      o.sec.style.height = (n ? W - vw + vh * 1.6 : vh * 1.4) + "px";
      o.track.style.width = W + "px";
      const seg = o.d.seg;
      const seed = Number(o.d.date.replace(/-/g, "")) % 9973;
      const fw = W * 0.4 + vw;
      const mw = W * 0.7 + vw;
      o.far.style.width = fw + "px";
      o.mid.style.width = mw + "px";
      o.far.innerHTML =
        '<svg viewBox="0 0 ' + fw + " " + vh + '" width="' + fw + '" height="' + vh + '" preserveAspectRatio="none">' +
        (seg === "syd" ? skyline(fw, vh * 0.72, seed, "#e9c7b0") : mountains(fw, vh * 0.72, seed, vh * 0.12, vh * 0.22, "#bcd3cf")) + "</svg>";
      o.mid.innerHTML =
        '<svg viewBox="0 0 ' + mw + " " + vh + '" width="' + mw + '" height="' + vh + '" preserveAspectRatio="none">' +
        (seg === "syd" ? skyline(mw, vh * 0.8, seed + 5, "#d9a98c") : mountains(mw, vh * 0.8, seed + 5, vh * 0.06, vh * 0.12, "#9dbbb4") + trees(mw, vh * 0.8, seed + 9, "#6f958c")) + "</svg>";

      const pts: [number, number][] = [[0, vh * 0.66]];
      items.forEach((_, k) => pts.push([vw * 0.45 + gap * (k + 0.5), vh * (k % 2 ? 0.72 : 0.58)]));
      pts.push([W, vh * 0.66]);
      let dStr = "M" + pts[0][0] + " " + pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const mx = (p0[0] + p1[0]) / 2;
        dStr += " C" + mx + " " + p0[1] + " " + mx + " " + p1[1] + " " + p1[0] + " " + p1[1];
      }
      o.road.setAttribute("width", String(W));
      o.road.setAttribute("height", String(vh));
      o.road.setAttribute("viewBox", "0 0 " + W + " " + vh);
      o.road.innerHTML =
        '<path d="' + dStr + '" fill="none" stroke="rgba(31,42,43,.12)" stroke-width="22" stroke-linecap="round"/>' +
        '<path d="' + dStr + '" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="10 12"/>' +
        '<path class="walked" d="' + dStr + '" fill="none" stroke="#e0231c" stroke-width="4" stroke-linecap="round"/>';
      o.path = o.road.querySelector<SVGPathElement>(".walked")!;
      o.len = o.path.getTotalLength();
      o.path.style.strokeDasharray = String(o.len);
      o.path.style.strokeDashoffset = String(o.len);

      const lenAtX = (x: number) => {
        let lo = 0;
        let hi = o.len;
        for (let j = 0; j < 30; j++) {
          const m = (lo + hi) / 2;
          if (o.path.getPointAtLength(m).x < x) lo = m;
          else hi = m;
        }
        return lo;
      };
      o.stopLen = items.map((_, k) => lenAtX(pts[k + 1][0]));

      o.track.querySelectorAll(".stop,.leg,.walker,.rest").forEach((el) => el.remove());
      o.stops = items.map((it, k) => {
        const el = document.createElement("div");
        el.className = "stop " + (k % 2 ? "down" : "up");
        el.style.left = pts[k + 1][0] + "px";
        el.style.top = pts[k + 1][1] + "px";
        const cost = it.cost && it.cost.status !== "unknown" && it.cost.amount ? '<span class="tag">約 AUD $' + it.cost.amount + (it.cost.unit === "pp" ? "／人" : "") + "</span>" : "";
        el.innerHTML =
          '<span class="pin"></span><div class="card"><div class="t">' + esc(it.time) + "・停留 " + mins(it.dur) + "</div><h3>" + esc(it.name) + '</h3><div class="en">' + esc(it.en || "") +
          '</div><div class="tags"><span class="tag ' + it.pri + '">' + PRI[it.pri] + "</span>" + cost + "</div></div>";
        o.track.appendChild(el);
        const t = it.travel || {};
        const total = Object.values(t).reduce<number>((acc, v) => acc + (v || 0), 0);
        if (total) {
          const lg = document.createElement("div");
          lg.className = "leg";
          lg.style.left = (pts[k][0] + pts[k + 1][0]) / 2 + "px";
          lg.style.top = (pts[k][1] + pts[k + 1][1]) / 2 + (k % 2 ? -46 : 46) + "px";
          lg.textContent = (MODE[it.mode] || "") + " 約 " + mins(total);
          o.track.appendChild(lg);
        }
        return el;
      });
      if (!n) {
        const rest = document.createElement("div");
        rest.className = "rest";
        rest.innerHTML = "<b>" + esc(o.d.title) + "</b>今天沒有排行程，慢慢休息。";
        o.track.appendChild(rest);
      }
      const wk = document.createElement("div");
      wk.className = "walker";
      wk.innerHTML = WALKER + '<div class="bubble"></div>';
      o.track.appendChild(wk);
      o.walker = wk;
      o.bubble = wk.querySelector<HTMLElement>(".bubble")!;
      o.parts = {
        person: wk.querySelector<HTMLElement>(".person")!,
        car: wk.querySelector<HTMLElement>(".car")!,
        boat: wk.querySelector<HTMLElement>(".boat")!,
        plane: wk.querySelector<HTMLElement>(".plane")!,
        bus: wk.querySelector<HTMLElement>(".bus")!,
      };
      o.legL = wk.querySelector(".legL")!;
      o.legR = wk.querySelector(".legR")!;
      o.arm = wk.querySelector(".armR")!;
      o.wheels = wk.querySelectorAll(".wheel");
    });
    update();
  }

  let last: DayState | null = null;
  function update() {
    const vh = innerHeight;
    let current: DayState | null = null;
    D.forEach((o) => {
      if (!o.path) return;
      const top = o.sec.offsetTop;
      const h = o.sec.offsetHeight;
      const run = h - vh;
      const raw = (scrollY - top) / Math.max(1, run);
      const p = Math.min(1, Math.max(0, raw));
      if (scrollY + vh * 0.5 >= top && scrollY + vh * 0.5 < top + h) current = o;
      if (raw < -1 || raw > 2) return;

      const n = o.d.items.length;
      // Short pause at the start; stop exactly at the last stop.
      const q = Math.min(1, Math.max(0, (p - 0.04) / 0.9));
      const Lmax = n ? o.stopLen[n - 1] : o.len;
      const L = Lmax * q;
      const pt = o.path.getPointAtLength(L);
      const ahead = o.path.getPointAtLength(Math.min(o.len, L + 4));
      const cam = Math.min(o.W - o.vw, Math.max(0, pt.x - o.vw * 0.42));
      o.track.style.transform = "translate3d(" + (-cam).toFixed(1) + "px,0,0)";
      o.far.style.transform = "translate3d(" + (-cam * 0.4).toFixed(1) + "px,0,0)";
      o.mid.style.transform = "translate3d(" + (-cam * 0.7).toFixed(1) + "px,0,0)";
      o.path.style.strokeDashoffset = (o.len - L).toFixed(1);

      // The next stop's transport mode decides what the walker becomes.
      let idx = 0;
      while (idx < n && L >= o.stopLen[idx] - 2) idx++;
      let nearStop = -1;
      for (let k = 0; k < n; k++) if (Math.abs(L - o.stopLen[k]) < 40) nearStop = k;
      const nextItem = o.d.items[Math.min(idx, n - 1)];
      const veh: Vehicle = nearStop >= 0 || !n ? "person" : vehicleFor(nextItem?.mode);
      (Object.keys(o.parts) as Vehicle[]).forEach((key) => {
        o.parts[key].style.display = key === veh ? "" : "none";
      });
      const tilt = (Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180) / Math.PI;
      const a0 = o.stopLen[idx - 1] || 0;
      const a1 = o.stopLen[idx] || o.len;
      const lift = veh === "plane" ? -Math.sin(Math.PI * Math.min(1, Math.max(0, (L - a0) / Math.max(1, a1 - a0)))) * 120 : 0;
      o.walker.style.transform = "translate3d(" + pt.x.toFixed(1) + "px," + (pt.y + lift).toFixed(1) + "px,0) rotate(" + (veh === "person" ? 0 : tilt * 0.5).toFixed(1) + "deg)";

      const ph = reduce ? 0 : Math.sin(L / 9);
      o.legL.setAttribute("x2", (ph * 7).toFixed(1));
      o.legR.setAttribute("x2", (-ph * 7).toFixed(1));
      o.arm.setAttribute("x2", (5 - ph * 5).toFixed(1));
      o.wheels.forEach((w) => w.setAttribute("transform", "rotate(" + ((L * 3) % 360) + " " + w.getAttribute("cx") + " " + w.getAttribute("cy") + ")"));

      o.stops.forEach((el, k) => {
        el.classList.toggle("done", L >= o.stopLen[k] + 40);
        el.classList.toggle("here", k === nearStop);
      });
      o.bars.forEach((b, k) => {
        const a = k === 0 ? 0 : o.stopLen[k - 1];
        const z = n ? o.stopLen[k] : o.len;
        b.style.transform = "scaleX(" + Math.min(1, Math.max(0, (L - a) / Math.max(1, z - a))).toFixed(3) + ")";
      });
      o.bubble.classList.toggle("below", nearStop >= 0 && nearStop % 2 === 0);
      if (nearStop >= 0) {
        o.bubble.textContent = "抵達：" + o.d.items[nearStop].name;
        o.bubble.classList.add("show");
      } else if (q >= 0.999) {
        o.bubble.textContent = "今天走完了！";
        o.bubble.classList.add("show");
      } else o.bubble.classList.remove("show");
    });
    D.forEach((o) => o.nav.classList.toggle("on", o === current));
    if (current && current !== last) {
      last = current;
      (current as DayState).nav.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }

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
  const onNav = (e: Event) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const sec = root.querySelector<HTMLElement>(a.getAttribute("href")!);
    if (sec) scrollTo({ top: sec.offsetTop + 2, behavior: reduce ? "auto" : "smooth" });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  nav.addEventListener("click", onNav);
  layout();
  let alive = true;
  if (document.fonts?.ready) void document.fonts.ready.then(() => alive && layout());

  return () => {
    alive = false;
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onResize);
    nav.removeEventListener("click", onNav);
    clearTimeout(rt);
  };
}
