"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";

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
/** False during server rendering and hydration, true afterwards: URL-derived UI waits for it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
/** Today's date in the viewer's time zone; null during server rendering. */
export function useToday(): string | null {
  return useSyncExternalStore(noSubscribe, () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, () => null);
}

/* ---------- toast ---------- */

/**
 * Shared pending feedback for async buttons (DESIGN.md「等待回饋」): pressed state on pointer-down, then a
 * spinner + pending label in the same footprint, disabled against double submits, aria-busy, ✓ on success,
 * an inline retry hint on failure. The action returns false (or throws) when it did not succeed.
 */
/** Rejects after `ms` so a stalled request can never leave a button (or the save bar) pending forever. */
export function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function PendingButton({
  onAction,
  pendingLabel = "處理中…",
  className = "btn",
  children,
  disabled,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & { onAction: () => unknown; pendingLabel?: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  async function run() {
    if (state === "pending") return;
    setState("pending");
    try {
      const r = await withTimeout(Promise.resolve(onAction()), 30000);
      // null = the user backed out (e.g. cancelled a confirm dialog): no ✓, no error.
      setState(r === null ? "idle" : r === false ? "error" : "done");
    } catch {
      setState("error");
    }
    timer.current = setTimeout(() => setState((s) => (s === "done" ? "idle" : s)), 1200);
  }
  const pending = state === "pending";
  return (
    <>
      <button
        {...rest}
        type="button"
        className={`${className} pbtn is-${state}`}
        disabled={disabled || pending}
        aria-busy={pending}
        aria-label={pending && rest["aria-label"] ? pendingLabel : rest["aria-label"]}
        onClick={() => void run()}
      >
        <span className="pbtn-face" aria-hidden={pending}>
          {state === "done" ? <span className="pbtn-ok">✓</span> : null}
          {children}
        </span>
        <span className="pbtn-face pbtn-pending" aria-hidden={!pending}>
          <span className="pbtn-spin" />
          {pendingLabel}
        </span>
      </button>
      {state === "error" && (
        <span className="pbtn-msg" role="status">
          沒有完成，可以再按一次重試
        </span>
      )}
    </>
  );
}

export type ToastAction = { label: string; run: () => unknown };

/** Short status message; with an action (e.g. 復原) it stays 5 seconds and shows a 44px button. */
export function useToast() {
  const [msg, setMsg] = useState("");
  const [action, setAction] = useState<ToastAction | null>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionBtn = useRef<HTMLButtonElement>(null);
  const [undoing, setUndoing] = useState(false);
  // The card that triggered an undoable action is gone, so 「復原」 takes keyboard focus.
  useEffect(() => {
    if (show && action) actionBtn.current?.focus({ preventScroll: true });
  }, [show, action]);
  const toast = useCallback((m: string, act?: ToastAction) => {
    setMsg(m);
    setAction(act ?? null);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), act ? 5000 : 2600);
  }, []);
  const node = (
    <div className={`toast ${show ? "show" : ""}${action ? " has-action" : ""}`} role="status" aria-live="polite">
      <span>{msg}</span>
      {action && show && (
        <button
          type="button"
          ref={actionBtn}
          disabled={undoing}
          aria-busy={undoing}
          onClick={async () => {
            setUndoing(true);
            if (timer.current) clearTimeout(timer.current);
            try {
              await action.run();
            } finally {
              setUndoing(false);
              setShow(false);
            }
          }}
        >
          {undoing ? (
            <>
              <span className="pbtn-spin" /> 復原中…
            </>
          ) : (
            action.label
          )}
        </button>
      )}
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
