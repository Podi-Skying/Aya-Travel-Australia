"use client";

import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "./SiteHeader";
import { PhotoViewer } from "./Photos";
import { itemName, photosOfDay, thumbUrl, useMyPhotos, viewerPhotos, type MyPhoto, type MyPhotosData, type PhotoAccessKind } from "@/client/my-photos";
import { CATEGORIES, isCategory } from "@/domain/photo-sort";
import { PhotoToolbar } from "./PhotoTools";
import { SortStage } from "./SortStage";
import { fmtDay } from "@/domain/format";
import type { Item, TripDoc } from "@/domain/schema";

/*
 * 我的照片 (Kai 2026-11-20, docs/PHOTOS-PLAN.md): Kai's own photos by trip day, for him and the people he
 * allows. Photo-first (Aya prefers pictures to text). The owner uploads, moves, captions and deletes here.
 */

const UNSORTED = "unsorted";

/** Thumbnails in a grid; `data-photo-id` lets the viewer open from and return to the tapped one. */
export function PhotoGrid({ photos, onOpen, onEdit }: { photos: MyPhoto[]; onOpen: (p: MyPhoto) => void; onEdit?: (p: MyPhoto) => void }) {
  return (
    <ul className="my-grid">
      {photos.map((p) => (
        <li key={p.id}>
          <button type="button" className="my-thumb" data-photo-id={`my-${p.id}`} onClick={() => onOpen(p)} aria-label={p.caption || "照片"}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked bytes */}
            <img src={thumbUrl(p.id)} alt="" loading="lazy" decoding="async" width={p.w} height={p.h} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
          </button>
          {onEdit && (
            <button type="button" className="my-edit" onClick={() => onEdit(p)} aria-label="編輯這張照片">
              ⋯
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function EditSheet({ p, doc, onClose, onSaved }: { p: MyPhoto; doc: TripDoc; onClose: () => void; onSaved: () => void }) {
  const [day, setDay] = useState(p.dayDate ?? "");
  const [item, setItem] = useState(p.itemId ?? "");
  const [caption, setCaption] = useState(p.caption ?? "");
  const [category, setCategory] = useState(p.category ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items: Item[] = doc.days.find((d) => d.date === day)?.items ?? [];
  const call = async (method: "PATCH" | "DELETE", body?: unknown) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/my-photos/${p.id}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? String(r.status));
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-sheet-backdrop" onClick={onClose}>
      <div className="my-sheet card" role="dialog" aria-modal="true" aria-label="編輯照片" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked bytes */}
        <img className="my-sheet-img" src={thumbUrl(p.id)} alt="" />
        <label>
          哪一天
          <select value={day} onChange={(e) => (setDay(e.target.value), setItem(""))}>
            <option value="">未分類</option>
            {doc.days.map((d) => (
              <option key={d.date} value={d.date}>
                {fmtDay(d.date)} {d.title ?? ""}
              </option>
            ))}
          </select>
        </label>
        {day && (
          <label>
            哪個活動
            <select value={item} onChange={(e) => setItem(e.target.value)}>
              <option value="">整天</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.time ?? ""} {i.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          分類
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">還沒分類</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          說明
          <input type="text" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        {err && <p className="small error">{err}</p>}
        <div className="my-sheet-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void call("PATCH", { dayDate: day || null, itemId: item || null, caption, category: isCategory(category) ? category : null })}>
            儲存
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn ghost danger" disabled={busy} onClick={() => window.confirm("刪除這張照片？刪除後無法復原。") && void call("DELETE")}>
            刪除
          </button>
        </div>
      </div>
    </div>
  );
}

type Viewers = { enabled: boolean; viewers: { id: string; kind: string; value: string; label: string }[]; links: { id: string; label: string; active: boolean; createdAt: string }[] };

function WhoCanSee() {
  const [v, setV] = useState<Viewers | null>(null);
  const [kind, setKind] = useState<"email" | "github">("email");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    fetch("/api/my-photos/viewers", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Viewers>) : null))
      .then((j) => live && j && setV(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tick]);
  const send = async (url: string, method: string, body?: unknown) => {
    setErr(null);
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = (await r.json().catch(() => null)) as { error?: string; url?: string } | null;
    if (!r.ok) return setErr(j?.error ?? String(r.status));
    if (j?.url) setNewUrl(j.url);
    load();
  };
  if (!v) return null;
  return (
    <section className="card my-who">
      <h2>誰可以看</h2>
      {!v.enabled && <p className="small muted">目前只有你看得到。要讓別人看，請在 Vercel 加上環境變數 PHOTO_VIEWERS=1 後重新部署。</p>}
      <ul className="my-who-list">
        {v.viewers.map((x) => (
          <li key={x.id}>
            <span>{x.label || x.value}</span> <span className="small muted">{x.kind === "email" ? x.value : `GitHub ${x.value}`}</span>
            <button type="button" className="btn ghost small" onClick={() => void send(`/api/my-photos/viewers/${x.id}`, "DELETE")}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <form
        className="my-who-add"
        onSubmit={(e) => {
          e.preventDefault();
          void send("/api/my-photos/viewers", "POST", { kind, value, label }).then(() => (setValue(""), setLabel("")));
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value as "email" | "github")} aria-label="帳號類型">
          <option value="email">Email</option>
          <option value="github">GitHub id</option>
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "email" ? "aya@example.com" : "12345678"} aria-label="帳號" required />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="名字（自己看）" aria-label="名字" maxLength={60} />
        <button type="submit" className="btn small">
          加入
        </button>
      </form>
      <h3>照片連結</h3>
      <ul className="my-who-list">
        {v.links
          .filter((l) => l.active)
          .map((l) => (
            <li key={l.id}>
              <span>{l.label || "連結"}</span> <span className="small muted">{l.createdAt.slice(0, 10)}</span>
              <button type="button" className="btn ghost small" onClick={() => window.confirm("停用這個連結？拿到的人就看不到了。") && void send(`/api/my-photos/links/${l.id}`, "DELETE")}>
                停用
              </button>
            </li>
          ))}
      </ul>
      <button type="button" className="btn ghost small" onClick={() => void send("/api/my-photos/links", "POST", { label: label || "" })}>
        產生新連結
      </button>
      {newUrl && (
        <p className="my-newlink">
          <input readOnly value={newUrl} onFocus={(e) => e.target.select()} aria-label="新的照片連結" />
          <span className="small muted">只會顯示這一次，請現在複製。</span>
        </p>
      )}
      {err && <p className="small error">{err}</p>}
    </section>
  );
}

function NotConfigured() {
  return (
    <section className="card my-setup">
      <h2>照片儲存空間還沒設定</h2>
      <ol>
        <li>Vercel → 這個專案 → Storage → Create Storage → Blob</li>
        <li>名稱填 aya-photos → Continue → 存取權選 Private</li>
        <li>勾選 Add a read-write token env var to this connection → Create</li>
        <li>Deployments → 最新一筆 → Redeploy</li>
      </ol>
    </section>
  );
}

const mb = (n: number) => `${(n / 1_000_000).toFixed(0)} MB`;

export function MyPhotosPage({ access, doc, initialDay }: { access: PhotoAccessKind; doc: TripDoc; initialDay?: string | null }) {
  const owner = access === "owner";
  const { data, error, reload } = useMyPhotos(access);
  const [pick, setPick] = useState<string | null>(initialDay ?? null);
  const [open, setOpen] = useState<{ list: MyPhoto[]; start: number } | null>(null);
  const [edit, setEdit] = useState<MyPhoto | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const all = useMemo(() => data?.photos ?? [], [data]);
  const cats = CATEGORIES.filter((c) => all.some((p) => p.category === c));
  const photos = useMemo(() => (cat ? all.filter((p) => p.category === cat) : all), [all, cat]);
  const unsorted = photos.filter((p) => !p.dayDate);
  const days = doc.days.filter((d) => photos.some((p) => p.dayDate === d.date));
  const shown = pick === UNSORTED ? [] : pick ? days.filter((d) => d.date === pick) : days;

  const openAt = (list: MyPhoto[], p: MyPhoto) => setOpen({ list, start: Math.max(0, list.findIndex((x) => x.id === p.id)) });

  return (
    <>
      <SiteHeader account={owner ? "signout" : null} current="photos" photos />
      <main id="main" className="my-photos">
        <header className="my-head">
          <h1>我的照片</h1>
          {owner && data && data.usedBytes != null && data.quotaBytes != null && (
            <p className="small muted my-meter">
              <meter min={0} max={data.quotaBytes} value={data.usedBytes} /> {mb(data.usedBytes)} / 1 GB
            </p>
          )}
        </header>
        {error && <p className="small error">讀取失敗，請重新整理。</p>}
        {!data && !error && <p className="muted my-empty">照片載入中…</p>}
        {data && !data.configured && owner && <NotConfigured />}
        {data && (
          <nav className="my-chips" aria-label="選擇日子">
            <button type="button" aria-pressed={!pick} onClick={() => setPick(null)}>
              全部
            </button>
            {days.map((d) => (
              <button key={d.date} type="button" aria-pressed={pick === d.date} onClick={() => setPick(d.date)}>
                {fmtDay(d.date)} <span className="n">{photos.filter((p) => p.dayDate === d.date).length}</span>
              </button>
            ))}
            {owner && unsorted.length > 0 && (
              <button type="button" aria-pressed={pick === UNSORTED} onClick={() => setPick(UNSORTED)}>
                未分類 <span className="n">{unsorted.length}</span>
              </button>
            )}
          </nav>
        )}
        {owner && data && <PhotoToolbar doc={doc} photos={all} configured={data.configured} onSaved={() => void reload()} />}
        {data && cats.length > 1 && (
          <nav className="my-chips my-cats" aria-label="選擇分類">
            <button type="button" aria-pressed={!cat} onClick={() => setCat(null)}>
              全部分類
            </button>
            {cats.map((c) => (
              <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                {c}
              </button>
            ))}
          </nav>
        )}
        {owner && data?.configured && <SortStage doc={doc} onUploaded={() => void reload()} />}
        {owner && (pick === UNSORTED || (!pick && unsorted.length > 0)) && (
          <section className="my-day">
            <h2>未分類</h2>
            <p className="small muted">找不到拍攝日期，或不在旅程日子裡。點 ⋯ 選哪一天。</p>
            <PhotoGrid photos={unsorted} onOpen={(p) => openAt(unsorted, p)} onEdit={setEdit} />
          </section>
        )}
        {shown.map((d) => {
          const list = photosOfDay(photos, d.date);
          const groups = new Map<string, MyPhoto[]>();
          for (const p of list) groups.set(p.itemId ?? "", [...(groups.get(p.itemId ?? "") ?? []), p]);
          return (
            <section key={d.date} className="my-day">
              <h2>
                {fmtDay(d.date)} <span className="muted">{d.title}</span>
              </h2>
              {[...groups].map(([itemId, ps]) => (
                <div key={itemId || "day"} className="my-group">
                  {itemId && <h3>{d.items.find((i) => i.id === itemId)?.name ?? ""}</h3>}
                  <PhotoGrid photos={ps} onOpen={(p) => openAt(list, p)} onEdit={owner ? setEdit : undefined} />
                </div>
              ))}
            </section>
          );
        })}
        {data && !photos.length && <p className="muted my-empty">還沒有照片。</p>}

        {owner && (
          <div className="my-tools">
            <button
              type="button"
              className="btn ghost small"
              onClick={async () => {
                const r = await fetch("/api/my-photos/resort", { method: "POST" });
                if (r.ok) void reload();
              }}
            >
              重新依時間分類
            </button>
          </div>
        )}
        {owner && <WhoCanSee />}
      </main>
      {open && <PhotoViewer photos={viewerPhotos(open.list, (p) => itemName(doc, p))} start={open.start} onClose={() => setOpen(null)} />}
      {edit && <EditSheet p={edit} doc={doc} onClose={() => setEdit(null)} onSaved={() => void reload()} />}
    </>
  );
}

export type { MyPhotosData };
