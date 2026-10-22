import * as THREE from "three";

/*
 * Scroll-driven scene ported from site/landing.html (Three.js r128 → npm three).
 * Returns a cleanup function. Without WebGL, or with reduced motion, content stays
 * readable over a static background (NFR-01, NFR-06).
 */

export type MoodKey = "dusk" | "sunset" | "morning" | "noon" | "fog" | "night";

type Mood = { top: number; hor: number; fog: number; sun: number; sunI: number; amb: number; aur: number; fogD: number };
const MOOD: Record<MoodKey, Mood> = {
  dusk: { top: 0x0d1b2e, hor: 0xd9826a, fog: 0x5a5560, sun: 0xffb38a, sunI: 0.9, amb: 0.35, aur: 0.0, fogD: 0.006 },
  sunset: { top: 0x2b2350, hor: 0xff8a4c, fog: 0x8a5a5a, sun: 0xff9a5c, sunI: 1.1, amb: 0.4, aur: 0.0, fogD: 0.005 },
  morning: { top: 0x3f6f9a, hor: 0xe8d9c2, fog: 0xa9b8c0, sun: 0xfff1d8, sunI: 1.3, amb: 0.55, aur: 0.0, fogD: 0.0042 },
  noon: { top: 0x2a78b8, hor: 0xbfe3ee, fog: 0x9fd0dc, sun: 0xffffff, sunI: 1.5, amb: 0.6, aur: 0.0, fogD: 0.0035 },
  fog: { top: 0x4c5b5f, hor: 0x9aa59e, fog: 0x8d9893, sun: 0xdfe7df, sunI: 0.7, amb: 0.5, aur: 0.0, fogD: 0.0095 },
  night: { top: 0x02060c, hor: 0x0c2a2a, fog: 0x08141a, sun: 0x8fb8ff, sunI: 0.35, amb: 0.22, aur: 1.0, fogD: 0.0045 },
};

export function startJourney(root: HTMLElement, moodKeys: MoodKey[]): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = matchMedia("(max-width: 760px)").matches;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    window.addEventListener(type, fn, opts);
    cleanups.push(() => window.removeEventListener(type, fn));
  };
  let raf = 0;
  let stopped = false;

  /* ---------- loader ---------- */
  let shown = 0;
  let target = 0;
  const setProgress = (p: number) => {
    target = Math.max(target, p);
  };
  const loader = $("#loader");
  const finishLoader = () => loader.classList.add("done");
  (function tick() {
    if (stopped) return;
    shown += (target - shown) * (reduce ? 1 : 0.12);
    if (target - shown < 0.5) shown = target;
    $("#pct").textContent = Math.round(shown) + "%";
    $("#bar").style.width = shown + "%";
    if (shown >= 100) {
      setTimeout(finishLoader, reduce ? 0 : 250);
      return;
    }
    requestAnimationFrame(tick);
  })();
  setProgress(15);
  // Slow devices may get sparse frames: never block content longer than 1.5 s.
  const fallback = setTimeout(() => {
    setProgress(100);
    shown = 100;
    finishLoader();
  }, 1500);
  cleanups.push(() => clearTimeout(fallback));

  /* ---------- procedural SVG foreground ---------- */
  const rnd = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const svg = (vb: string, body: string) => `<svg viewBox="${vb}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const SIL = "#060c0e";
  (function gum() {
    const r = rnd(7);
    let out = "";
    function branch(x: number, y: number, ang: number, len: number, w: number, depth: number) {
      const x2 = x + Math.cos(ang) * len;
      const y2 = y + Math.sin(ang) * len;
      out += `<path d="M${x} ${y} Q${(x + x2) / 2 + 10} ${(y + y2) / 2 - 8} ${x2} ${y2}" stroke="${SIL}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
      const n = Math.floor(len / 22);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const px = x + (x2 - x) * t;
        const py = y + (y2 - y) * t;
        const la = Math.PI / 2 + (r() - 0.5) * 0.9;
        const ll = 34 + r() * 26;
        const lx = px + Math.cos(la) * ll;
        const ly = py + Math.sin(la) * ll;
        const nx = -Math.sin(la) * 6;
        const ny = Math.cos(la) * 6;
        out += `<path d="M${px} ${py} Q${(px + lx) / 2 + nx} ${(py + ly) / 2 + ny} ${lx} ${ly} Q${(px + lx) / 2 - nx} ${(py + ly) / 2 - ny} ${px} ${py}Z" fill="${SIL}"/>`;
      }
      if (depth > 0) {
        branch(x2, y2, ang + 0.35 + r() * 0.2, len * 0.7, w * 0.65, depth - 1);
        branch(x + (x2 - x) * 0.55, y + (y2 - y) * 0.55, ang - 0.15 + r() * 0.2, len * 0.6, w * 0.6, depth - 1);
      }
    }
    branch(-10, 40, 0.28, 260, 9, 3);
    $("#fg-gum").innerHTML = `<svg viewBox="0 0 560 560" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
  })();
  (function fern() {
    const r = rnd(21);
    let out = "";
    for (let f = 0; f < 7; f++) {
      const ang = -Math.PI * (0.55 + f * 0.085) + (r() - 0.5) * 0.1;
      const len = 300 + r() * 160;
      const bx = 560;
      const by = 600;
      const cur = 0.0016 * (r() > 0.5 ? 1 : -1);
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const a = ang + cur * t * len;
        pts.push([bx + Math.cos(a) * len * t, by + Math.sin(a) * len * t + t * t * 60, a]);
      }
      out += `<path d="M${pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L")}" stroke="${SIL}" stroke-width="4" fill="none"/>`;
      for (let j = 2; j < 40; j++) {
        const p = pts[j];
        const s = (1 - j / 40) * 46 + 6;
        for (const side of [1, -1]) {
          const la = p[2] + side * 1.2;
          const ex = p[0] + Math.cos(la) * s;
          const ey = p[1] + Math.sin(la) * s + 6;
          out += `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q${((p[0] + ex) / 2).toFixed(1)} ${((p[1] + ey) / 2 - 5).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${SIL}" stroke-width="${(3.2 - j / 20).toFixed(2)}" fill="none" stroke-linecap="round"/>`;
        }
      }
    }
    $("#fg-fern").innerHTML = `<svg viewBox="0 0 620 620" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
  })();
  (function grass() {
    const r = rnd(3);
    let out = "";
    for (let i = 0; i < (mobile ? 140 : 320); i++) {
      const x = r() * 1440;
      const h = 40 + r() * 150;
      const lean = (r() - 0.5) * 70;
      const w = 2 + r() * 4;
      out += `<path d="M${x - w} 260 Q${x + lean * 0.4} ${260 - h * 0.6} ${x + lean} ${260 - h} Q${x + lean * 0.4 + w} ${260 - h * 0.6} ${x + w} 260Z" fill="${SIL}"/>`;
    }
    $("#fg-grass").innerHTML = svg("0 0 1440 260", out);
  })();
  (function columns() {
    const r = rnd(11);
    let out = "";
    let x = 0;
    for (let i = 0; i < 9; i++) {
      const w = 30 + r() * 18;
      const h = 200 + r() * 300;
      out += `<path d="M${x} 520 L${x} ${520 - h} L${x + w * 0.5} ${520 - h - 10} L${x + w} ${520 - h + 4} L${x + w} 520Z" fill="${SIL}" stroke="#0d1a1d" stroke-width="2"/>`;
      x += w + 1;
    }
    $("#fg-columns").innerHTML = svg("0 0 360 520", out);
  })();
  setProgress(35);

  /* ---------- chapter state ---------- */
  const sections = Array.from(root.querySelectorAll<HTMLElement>(".ch"));
  const navLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>(".nav ul a"));
  const railLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>(".rail a"));
  const io = new IntersectionObserver(
    (es) => {
      es.forEach((e) => {
        e.target.querySelector(".card")?.classList.toggle("in", e.intersectionRatio >= 0.25);
        if (e.intersectionRatio >= 0.25) {
          const id = (e.target as HTMLElement).id;
          [...navLinks, ...railLinks].forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + id));
        }
      });
    },
    { threshold: [0, 0.25] },
  );
  sections.forEach((s) => io.observe(s));
  cleanups.push(() => io.disconnect());

  function progress() {
    const n = sections.length;
    const maxS = document.documentElement.scrollHeight - innerHeight;
    const y = scrollY;
    const anchors = sections.map((sec, k) => {
      if (k === 0) return 0;
      const a = sec.offsetTop + sec.offsetHeight / 2 - innerHeight / 2;
      return k === n - 1 ? Math.min(a, maxS) : a;
    });
    if (y <= 0) return 0;
    for (let k = 1; k < n; k++) if (y < anchors[k]) return (k - 1 + (y - anchors[k - 1]) / Math.max(1, anchors[k] - anchors[k - 1])) / (n - 1);
    return 1;
  }

  /* ---------- foreground parallax ---------- */
  const fg = {
    gum: { el: $("#fg-gum"), speed: -0.35, show: [0, 1, 0.2, 0.9, 0, 0.3] },
    fern: { el: $("#fg-fern"), speed: -0.6, show: [0.9, 0.3, 0, 1, 0, 0.6] },
    grass: { el: $("#fg-grass"), speed: -0.15, show: [1, 0.6, 0.4, 1, 0.2, 1] },
    columns: { el: $("#fg-columns"), speed: -0.45, show: [0, 0, 1, 0.3, 0, 0] },
  };
  function sampleArr(arr: number[], p: number) {
    const f = p * (arr.length - 1);
    const i = Math.floor(f);
    let t = f - i;
    if (i >= arr.length - 1) return arr[arr.length - 1];
    t = t * t * (3 - 2 * t);
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  function updateLayers(p: number) {
    const vh = innerHeight;
    for (const L of Object.values(fg)) {
      const local = (p * 5) % 1;
      const y = reduce ? 0 : (local - 0.5) * L.speed * vh * 0.5;
      const o = sampleArr(L.show, p);
      L.el.style.transform = `translate3d(0,${y.toFixed(1)}px,0) scale(${(1 + (1 - o) * 0.15).toFixed(3)})`;
      L.el.style.opacity = o.toFixed(3);
    }
  }

  const finish = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    cleanups.forEach((f) => f());
  };

  /* ---------- Three.js world ---------- */
  const hasWebGL = (() => {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  })();
  const canvas = $<HTMLCanvasElement>("#world");
  if (!hasWebGL) {
    root.classList.add("no-webgl");
    canvas.style.display = "none";
    on("scroll", () => updateLayers(progress()), { passive: true });
    updateLayers(0);
    setProgress(100);
    return finish;
  }

  // Match the r128 look: no colour management, sRGB-agnostic output, legacy light scale.
  THREE.ColorManagement.enabled = false;
  const LIGHT = Math.PI;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: "high-performance" });
  } catch {
    root.classList.add("no-webgl");
    canvas.style.display = "none";
    setProgress(100);
    return finish;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.3 : 1.75));
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 1400);
  const fogObj = new THREE.FogExp2(0x22313a, 0.0055);
  scene.fog = fogObj;

  const MOODS = (moodKeys.length >= 2 ? moodKeys : (["dusk", "night"] as MoodKey[])).map((k) => MOOD[k]);
  const cA = new THREE.Color();
  const cB = new THREE.Color();
  function moodAt(p: number) {
    const f = p * (MOODS.length - 1);
    const i = Math.min(MOODS.length - 2, Math.floor(f));
    let t = f - i;
    t = t * t * (3 - 2 * t);
    const a = MOODS[i];
    const b = MOODS[i + 1];
    const col = (k: "top" | "hor" | "fog" | "sun") => cA.setHex(a[k]).clone().lerp(cB.setHex(b[k]), t);
    const num = (k: "sunI" | "amb" | "aur" | "fogD") => a[k] + (b[k] - a[k]) * t;
    return { top: col("top"), hor: col("hor"), fog: col("fog"), sun: col("sun"), sunI: num("sunI"), amb: num("amb"), aur: num("aur"), fogD: num("fogD") };
  }

  const skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uTime: { value: 0 }, uAur: { value: 0 }, uStars: { value: 0 } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyU,
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: [
        "uniform vec3 uTop; uniform vec3 uHor; uniform float uTime; uniform float uAur; uniform float uStars; varying vec3 vDir;",
        "float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }",
        "float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }",
        "void main(){",
        "  float y = clamp(vDir.y, -0.2, 1.0);",
        "  vec3 col = mix(uHor, uTop, pow(smoothstep(-0.05, 0.75, y), 0.7));",
        "  vec2 sp = vec2(atan(vDir.z, vDir.x), asin(clamp(vDir.y, -1.0, 1.0))) * 160.0;",
        "  vec2 cell = floor(sp); vec2 off = vec2(h(cell + 7.0), h(cell + 3.0)) - 0.5;",
        "  float d = length(fract(sp) - 0.5 - off * 0.6);",
        "  float st = step(0.965, h(cell)) * smoothstep(0.09, 0.0, d) * smoothstep(0.05, 0.4, y) * uStars;",
        "  col += st * (0.7 + 0.3 * sin(uTime * 2.0 + h(cell) * 40.0));",
        "  float ang = atan(vDir.z, vDir.x);",
        "  float curtain = n(vec2(ang * 3.0 + uTime * 0.05, uTime * 0.08)) * 0.7 + n(vec2(ang * 9.0 - uTime * 0.12, 3.0)) * 0.3;",
        "  float band = smoothstep(0.08, 0.25, y) * (1.0 - smoothstep(0.35, 0.75, y + curtain * 0.25));",
        "  float rays = pow(n(vec2(ang * 40.0, uTime * 0.2)), 2.0);",
        "  vec3 aur = mix(vec3(0.1, 0.95, 0.55), vec3(0.75, 0.25, 0.9), smoothstep(0.2, 0.6, y + curtain * 0.2));",
        "  col += aur * band * (0.35 + rays * 0.9) * curtain * uAur * 1.6;",
        "  gl_FragColor = vec4(col, 1.0);",
        "}",
      ].join("\n"),
    }),
  );
  scene.add(sky);
  setProgress(50);

  function hash(x: number, y: number) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function vnoise(x: number, y: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x: number, y: number) {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < 5; i++) {
      s += a * vnoise(x * f, y * f);
      f *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  function heightAt(x: number, z: number) {
    const base = fbm(x * 0.006 + 3.1, z * 0.006 - 1.7);
    const ridge = 1 - Math.abs(fbm(x * 0.004 + 9, z * 0.004 + 2) * 2 - 1);
    let hgt = Math.pow(base, 1.6) * 90 + Math.pow(ridge, 3) * 70;
    const coast = (x + 40) / 160;
    hgt *= THREE.MathUtils.clamp(1 - coast, 0, 1);
    const valley = Math.exp(-Math.pow((x + 10 + Math.sin(z * 0.01) * 30) / 45, 2));
    hgt *= 1 - valley * 0.75;
    return hgt - 6;
  }
  const SEG = mobile ? 140 : 220;
  const SIZE = 900;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xc9b48a);
  const cGrass = new THREE.Color(0x3f5a32);
  const cForest = new THREE.Color(0x22361f);
  const cRock = new THREE.Color(0x6b6a63);
  const cSnow = new THREE.Color(0xdfe3e2);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    if (y < 1.5) tmp.copy(cSand);
    else if (y < 14) tmp.copy(cGrass).lerp(cForest, (y - 1.5) / 12.5);
    else if (y < 55) tmp.copy(cForest).lerp(cRock, (y - 14) / 41);
    else tmp.copy(cRock).lerp(cSnow, Math.min(1, (y - 55) / 25));
    tmp.offsetHSL(0, 0, (hash(x, z) - 0.5) * 0.04);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  tg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));
  scene.add(terrain);
  setProgress(70);

  const seaU = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x0b3a4a) }, uShallow: { value: new THREE.Color(0x2fa3a8) }, uSky: { value: new THREE.Color() }, uSun: { value: new THREE.Color() } },
  ]);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6, mobile ? 80 : 160, mobile ? 80 : 160).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: seaU,
      fog: true,
      transparent: true,
      vertexShader: [
        "uniform float uTime; varying vec3 vW; varying float vH;",
        "#include <fog_pars_vertex>",
        "void main(){",
        "  vec3 p = position;",
        "  float w = sin(p.x * 0.05 + uTime * 0.9) * 0.6 + sin(p.z * 0.07 - uTime * 1.1) * 0.45 + sin((p.x + p.z) * 0.11 + uTime * 1.7) * 0.2;",
        "  p.y += w; vH = w;",
        "  vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz;",
        "  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;",
        "  #include <fog_vertex>",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun; varying vec3 vW; varying float vH;",
        "#include <fog_pars_fragment>",
        "void main(){",
        "  vec3 v = normalize(cameraPosition - vW);",
        "  float fres = pow(1.0 - max(v.y, 0.0), 3.0);",
        "  vec3 col = mix(uDeep, uShallow, smoothstep(-0.8, 1.0, vH) * 0.6);",
        "  col = mix(col, uSky, fres * 0.7);",
        "  col += uSun * smoothstep(0.7, 1.2, vH) * 0.25;",
        "  gl_FragColor = vec4(col, 0.94);",
        "  #include <fog_fragment>",
        "}",
      ].join("\n"),
    }),
  );
  scene.add(sea);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223322, 0.5 * LIGHT);
  const sun = new THREE.DirectionalLight(0xffffff, LIGHT);
  sun.position.set(-200, 160, -120);
  scene.add(hemi, sun);

  const PN = mobile ? 350 : 900;
  const pg = new THREE.BufferGeometry();
  const pp = new Float32Array(PN * 3);
  const pseed = new Float32Array(PN);
  for (let k = 0; k < PN; k++) {
    const px = (Math.random() - 0.5) * 500;
    const pz = (Math.random() - 0.5) * 700;
    pp[k * 3] = px;
    pp[k * 3 + 1] = Math.max(heightAt(px, pz), 0) + 2 + Math.random() * 25;
    pp[k * 3 + 2] = pz;
    pseed[k] = Math.random() * 100;
  }
  pg.setAttribute("position", new THREE.BufferAttribute(pp, 3));
  pg.setAttribute("seed", new THREE.BufferAttribute(pseed, 1));
  const ptU = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffe6b0) }, uPx: { value: renderer.getPixelRatio() }, uAlpha: { value: 0.6 } };
  const motes = new THREE.Points(
    pg,
    new THREE.ShaderMaterial({
      uniforms: ptU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader:
        "uniform float uTime; uniform float uPx; attribute float seed; varying float vA; void main(){ vec3 p = position; p.y += sin(uTime*0.6 + seed)*1.5; p.x += cos(uTime*0.4 + seed*1.3)*1.2; vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (30.0 / -mv.z) * (0.6 + 0.4*sin(uTime*1.5+seed)); vA = clamp(1.0 - (-mv.z)/260.0, 0.0, 1.0); }",
      fragmentShader:
        "uniform vec3 uColor; uniform float uAlpha; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a * vA * uAlpha); }",
    }),
  );
  scene.add(motes);
  setProgress(85);

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const camPath = new THREE.CatmullRomCurve3([V(120, 22, 330), V(40, 30, 220), V(-20, 46, 120), V(60, 26, 20), V(-30, 60, -80), V(-10, 34, -170), V(30, 80, -260), V(10, 140, -320)], false, "catmullrom", 0.4);
  const lookPath = new THREE.CatmullRomCurve3([V(0, 8, 180), V(-30, 25, 90), V(120, 4, 40), V(-40, 40, -60), V(-40, 50, -200), V(200, 20, -200), V(0, 160, -600), V(0, 260, -700)], false, "catmullrom", 0.4);

  let smooth = progress();
  let mouseX = 0;
  let mouseY = 0;
  let tx = 0;
  let ty = 0;
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  on(
    "pointermove",
    (e) => {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    },
    { passive: true },
  );

  function frame(t?: number) {
    if (stopped) return;
    const time = (t || 0) / 1000;
    const p = progress();
    smooth += (p - smooth) * (reduce ? 1 : 0.06);
    mouseX += (tx - mouseX) * 0.05;
    mouseY += (ty - mouseY) * 0.05;
    camPath.getPointAt(smooth, camPos);
    lookPath.getPointAt(Math.min(1, smooth + 0.02), lookAt);
    if (!reduce) {
      camPos.x += mouseX * 6 + Math.sin(time * 0.3) * 0.8;
      camPos.y += -mouseY * 3 + Math.sin(time * 0.5) * 0.4;
    }
    const ground = Math.max(heightAt(camPos.x, camPos.z), 0);
    if (camPos.y < ground + 8) camPos.y = ground + 8;
    camera.position.copy(camPos);
    camera.lookAt(lookAt);

    const m = moodAt(smooth);
    skyU.uTop.value.copy(m.top);
    skyU.uHor.value.copy(m.hor);
    skyU.uAur.value = m.aur;
    skyU.uStars.value = Math.max(m.aur, 1 - m.sunI);
    skyU.uTime.value = reduce ? 10 : time;
    fogObj.color.copy(m.fog);
    fogObj.density = m.fogD;
    seaU.fogColor.value.copy(m.fog);
    seaU.fogDensity.value = m.fogD;
    seaU.uSky.value.copy(m.hor);
    seaU.uSun.value.copy(m.sun);
    seaU.uTime.value = reduce ? 0 : time;
    sun.color.copy(m.sun);
    sun.intensity = m.sunI * LIGHT;
    hemi.intensity = m.amb * LIGHT;
    hemi.color.copy(m.top).lerp(m.hor, 0.5);
    ptU.uTime.value = reduce ? 0 : time;
    ptU.uColor.value.copy(m.aur > 0.3 ? cA.setHex(0x9fffd0) : m.sun);
    ptU.uAlpha.value = 0.25 + (1 - m.sunI / 1.5) * 0.6;
    sky.position.copy(camera.position);

    updateLayers(smooth);
    renderer.render(scene, camera);
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  on("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    if (reduce) frame(0);
  });
  if (reduce) on("scroll", () => frame(0), { passive: true });

  renderer.compile(scene, camera);
  frame(0);
  setProgress(100);

  cleanups.push(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    renderer.dispose();
  });
  return finish;
}
