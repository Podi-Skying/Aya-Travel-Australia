"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/* Shared UI pieces and labels ported from site/js/app.js. */

export const PRI = { must: { t: "必去", c: "b-must" }, pref: { t: "優先", c: "b-pref" }, repl: { t: "可替換", c: "b-repl" } } as const;
export const MODE: Record<string, string> = { walk: "步行", bus: "大眾運輸", drive: "開車", ferry: "渡輪", train: "火車", flight: "飛機" };
export const LEG: Record<string, string> = { drive: "開車", walk: "步行", wait: "等候", ferry: "渡輪", transit: "乘車", flight: "飛行" };
export const STATUS = { estimate: { t: "估計", c: "b-warn" }, quote: { t: "報價", c: "b-info" }, confirmed: { t: "已確認", c: "b-ok" }, unknown: { t: "未知", c: "b-danger" } } as const;
export const VERIFY = { verified: { t: "已驗證", c: "b-ok" }, partial: { t: "部分驗證", c: "b-info" }, unverified: { t: "未驗證", c: "b-line" } } as const;
export const CATS: Record<string, { t: string; color: string }> = {
  transport: { t: "交通", color: "#1f5f8b" },
  stay: { t: "住宿", color: "#1f7a6d" },
  food: { t: "餐飲", color: "#c2643a" },
  tickets: { t: "門票／活動", color: "#7a4fa0" },
  other: { t: "其他", color: "#6b7a7a" },
};

export function Badge({ t, c }: { t: string; c: string }) {
  return <span className={`badge ${c}`}>{t}</span>;
}

const RM = "(prefers-reduced-motion: reduce)";
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(RM);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(RM).matches,
    () => false,
  );
}

const noSubscribe = () => () => {};

/** Today's date in Hobart, where the trip happens (DESIGN.md: /plan default day). Null on the server. */
export function useHobartToday(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Hobart", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    () => null,
  );
}

/* ---------- ?tab=…&day=… URL state for /plan ---------- */
const URL_EVENT = "aya-url";
let urlCache = { key: "", value: { tab: null as string | null, day: null as string | null } };
function readUrl() {
  const key = location.search;
  if (key !== urlCache.key) {
    const q = new URLSearchParams(key);
    urlCache = { key, value: { tab: q.get("tab"), day: q.get("day") } };
  }
  return urlCache.value;
}
const SERVER_URL = { tab: null, day: null };
export function useUrlState(): { tab: string | null; day: string | null } {
  return useSyncExternalStore(
    (cb) => {
      addEventListener("popstate", cb);
      addEventListener(URL_EVENT, cb);
      return () => {
        removeEventListener("popstate", cb);
        removeEventListener(URL_EVENT, cb);
      };
    },
    readUrl,
    () => SERVER_URL,
  );
}
export function writeUrl(next: { tab: string; day?: string }) {
  const q = new URLSearchParams(location.search);
  q.set("tab", next.tab);
  if (next.day) q.set("day", next.day);
  else q.delete("day");
  history.replaceState(history.state, "", `${location.pathname}?${q.toString()}${location.hash}`);
  dispatchEvent(new Event(URL_EVENT));
}
/** Today's date in the viewer's time zone; null during server rendering. */
export function useToday(): string | null {
  return useSyncExternalStore(noSubscribe, () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, () => null);
}

/* ---------- toast ---------- */

export function useToast() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);
  const node = (
    <div className={`toast ${show ? "show" : ""}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
  return { toast, node };
}

/* ---------- dialog (replaces the prototype's ask()) ---------- */

export type Field =
  | { name: string; label: string; type?: "text" | "time" | "number" | "url"; value?: string; required?: boolean; maxLength?: number; min?: number; step?: number; placeholder?: string }
  | { name: string; label: string; type: "select"; value?: string; options: { value: string; label: string }[] };

type AskState = { title: string; body?: ReactNode; fields?: Field[]; ok: string; resolve: (v: Record<string, string> | null) => void };

export function useAsk() {
  const [state, setState] = useState<AskState | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const ask = useCallback(
    (title: string, opts: { body?: ReactNode; fields?: Field[]; ok?: string } = {}) =>
      new Promise<Record<string, string> | null>((resolve) => setState({ title, body: opts.body, fields: opts.fields, ok: opts.ok ?? "確定", resolve })),
    [],
  );

  useEffect(() => {
    const d = ref.current;
    if (state && d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      d.querySelector<HTMLElement>("input,select,textarea")?.focus();
    }
  }, [state]);

  const close = (v: Record<string, string> | null) => {
    ref.current?.close();
    state?.resolve(v);
    setState(null);
  };

  const node = (
    <dialog ref={ref} onCancel={() => close(null)} aria-labelledby="dlg-title">
      {state && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            close(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
          }}
        >
          <h3 id="dlg-title">{state.title}</h3>
          <div>
            {state.body}
            {state.fields?.map((f) => (
              <div className="field" key={f.name}>
                <label htmlFor={`f-${f.name}`}>{f.label}</label>
                {f.type === "select" ? (
                  <select id={`f-${f.name}`} name={f.name} defaultValue={f.value}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`f-${f.name}`}
                    name={f.name}
                    type={f.type ?? "text"}
                    defaultValue={f.value}
                    required={f.required}
                    maxLength={f.maxLength}
                    min={f.min}
                    step={f.step}
                    placeholder={f.placeholder}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="dlg-actions">
            <button type="button" className="btn ghost" onClick={() => close(null)}>
              取消
            </button>
            <button type="submit" className="btn">
              {state.ok}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
  return { ask, node };
}
