"use client";

import { useEffect, useState } from "react";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { Badge } from "./ui";
import { api } from "@/client/api";
import { fmtDay, fmtTs } from "@/domain/format";
import type { TripDoc } from "@/domain/schema";
import type { VersionMeta } from "@/client/offline";

/* Owner-only: sharing, interest totals, versions, backup/import and deletion. */

export function Manage() {
  return (
    <>
      <div className="grid cols-2">
        <ShareCard />
        <InterestCard />
      </div>
      <VersionsCard />
      <BackupCard />
      <DeleteCard />
    </>
  );
}

function ShareCard() {
  const { online, toast, ask } = useTrip();
  const [status, setStatus] = useState<{ active: boolean; createdAt?: string } | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    void api<{ active: boolean; createdAt?: string }>("/api/trip/share").then((r) => r.ok && setStatus(r.data));
  }, []);

  async function create() {
    const r0 = await ask(status?.active ? "產生新的分享連結？" : "建立分享連結？", {
      body: (
        <>
          <p>訪客不需帳號即可查看並表達興趣。伺服器只送出隱藏確切地址與司機資訊的版本。</p>
          <p className="small muted">注意：即使隱藏地址，分享連結仍會透露旅行日期與活動模式。{status?.active ? "舊連結會立即失效。" : ""}</p>
        </>
      ),
      ok: "建立",
    });
    if (!r0) return;
    const r = await api<{ token: string }>("/api/trip/share", { method: "POST" });
    if (!r.ok) return toast(r.error);
    setUrl(`${location.origin}/s/${r.data.token}`);
    setStatus({ active: true, createdAt: new Date().toISOString() });
    toast("已建立分享連結");
  }

  async function deactivate() {
    const r = await api("/api/trip/share", { method: "DELETE" });
    if (!r.ok) return toast(r.error);
    setStatus({ active: false });
    setUrl(null);
    toast("分享連結已停用");
  }

  return (
    <div className="card">
      <h3>分享連結（唯讀）</h3>
      <p>{status === null ? <span className="muted">讀取中…</span> : status.active ? <Badge t="啟用中" c="b-ok" /> : <Badge t="未啟用" c="b-danger" />}</p>
      {url ? (
        <>
          <div className="share-url">
            <input value={url} readOnly aria-label="分享連結" onFocus={(e) => e.target.select()} />
            <button
              className="btn small"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => toast("已複製連結"),
                  () => toast("請手動複製"),
                );
              }}
            >
              複製
            </button>
          </div>
          <p className="small muted">
            連結只會顯示這一次（伺服器只保存雜湊值）。先 <a href={url} target="_blank" rel="noopener noreferrer">以訪客身分預覽</a> 檢查內容。
          </p>
        </>
      ) : (
        status?.active && <p className="small muted">連結建立於 {fmtTs(status.createdAt!)}。為了安全，伺服器不保存原始連結；忘記的話請產生新連結。</p>
      )}
      <p>
        <button className="btn small" type="button" disabled={!online} onClick={() => void create()}>
          {status?.active ? "產生新連結（舊連結失效）" : "建立分享連結"}
        </button>{" "}
        {status?.active && (
          <button className="btn danger small" type="button" disabled={!online} onClick={() => void deactivate()}>
            停用分享連結
          </button>
        )}
      </p>
    </div>
  );
}

function InterestCard() {
  const { counts } = useTrip();
  return (
    <div className="card">
      <h3>訪客興趣（合計）</h3>
      {!counts ? (
        <p className="muted">離線或讀取中。</p>
      ) : !counts.current.length && !counts.moved.length ? (
        <p className="muted">還沒有人表達興趣。</p>
      ) : (
        <>
          {counts.current.length > 0 && <CountTable rows={counts.current} />}
          {counts.moved.length > 0 && (
            <>
              <h4 className="section">日期已變更的舊回應</h4>
              <p className="small muted">這些回應是針對活動原本的日期；活動移到新日期後，訪客可以重新表達興趣。</p>
              <CountTable rows={counts.moved} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function CountTable({ rows }: { rows: { itemId: string; dayDate: string; name: string; count: number }[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>活動</th>
            <th className="num">人數</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.itemId}|${r.dayDate}`}>
              <td>{fmtDay(r.dayDate)}</td>
              <td>{r.name}</td>
              <td className="num">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VersionsCard() {
  const { versions, versionNo, online, ask, toast, applyServerDoc, reloadVersions, runOp } = useTrip();
  const [viewing, setViewing] = useState<VersionMeta | null>(null);

  async function restore(v: VersionMeta) {
    const r = await ask(`還原到 v${v.versionNo}？`, { body: <p>「{v.summary}」<br /><span className="small muted">會建立一個新版本，現有紀錄都會保留。</span></p>, ok: "還原" });
    if (!r) return;
    const res = await api<{ versionNo: number; doc: TripDoc }>("/api/trip/restore", { method: "POST", body: { baseVersionNo: versionNo, versionNo: v.versionNo } });
    if (!res.ok) return toast(res.status === 409 ? "行程已在其他地方更新，請重新整理" : res.error);
    applyServerDoc(res.data.doc, res.data.versionNo);
    toast(`已還原，存為新版本 v${res.data.versionNo}`);
    await reloadVersions();
  }

  async function snapshot() {
    const r = await ask("存一個命名版本", { fields: [{ name: "s", label: "版本說明", required: true, maxLength: 60, placeholder: "例如：和 Aya 討論後的版本" }], ok: "儲存" });
    if (r?.s.trim()) await runOp({ op: "snapshot", summary: r.s });
  }

  return (
    <div className="card section">
      <h3>版本紀錄</h3>
      <p className="small muted">每次修改都會存成新版本；還原會建立新的版本，原有紀錄不會被覆蓋。最近 20 個版本與原始版本可以離線查看。</p>
      <p>
        <button className="btn small" type="button" disabled={!online} onClick={() => void snapshot()}>
          ＋ 存一個命名版本
        </button>
      </p>
      <ul className="ver-list">
        {versions.map((v) => (
          <li key={v.versionNo}>
            <div>
              <strong>v{v.versionNo}</strong> {v.summary}
              {v.restoredFrom ? <span className="muted small">（由 v{v.restoredFrom} 還原）</span> : null}
              <br />
              <span className="muted small">{fmtTs(v.createdAt)}</span>
            </div>
            <span>
              {v.doc ? (
                <button className="btn ghost small" type="button" onClick={() => setViewing(v)}>
                  查看
                </button>
              ) : (
                !online && <span className="small muted">需要連線才能開啟</span>
              )}{" "}
              {v.versionNo === versionNo ? (
                <Badge t="目前版本" c="b-ok" />
              ) : (
                <button className="btn ghost small" type="button" disabled={!online} onClick={() => void restore(v)}>
                  還原
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {viewing && <VersionPreview v={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function VersionPreview({ v, onClose }: { v: VersionMeta; onClose: () => void }) {
  const doc = v.doc as TripDoc;
  return (
    <div className="card section" role="region" aria-label={`v${v.versionNo} 內容`}>
      <h4>
        v{v.versionNo}：{v.summary}（唯讀）
      </h4>
      <ol className="small">
        {doc.days.map((d) => (
          <li key={d.date}>
            {fmtDay(d.date)} {d.title}
            {d.items.length ? "：" + d.items.map((i) => i.name).join(" → ") : ""}
          </li>
        ))}
      </ol>
      <button className="btn ghost small" type="button" onClick={onClose}>
        關閉
      </button>
    </div>
  );
}

function BackupCard() {
  const { versionNo, online, toast, ask, applyServerDoc, reloadVersions } = useTrip();
  async function importFile(file: File) {
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      return toast("檔案不是有效的 JSON");
    }
    const ok = await ask("匯入行程？", { body: <p>匯入的內容會存成新版本「匯入」，目前版本仍保留在紀錄中。</p>, ok: "匯入" });
    if (!ok) return;
    const r = await api<{ versionNo: number; doc: TripDoc }>("/api/trip/import", { method: "POST", body: { baseVersionNo: versionNo, doc } });
    if (!r.ok) {
      const errs = (r.data?.errors as { path: string; message: string }[] | undefined)?.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join("；");
      return toast(errs ? `${r.error}：${errs}` : r.error);
    }
    applyServerDoc(r.data.doc, r.data.versionNo);
    toast(`已匯入為 v${r.data.versionNo}`);
    await reloadVersions();
  }
  return (
    <div className="card section">
      <h3>備份與匯入</h3>
      <p>
        <a className="btn ghost small" href="/api/trip/export" download>
          <Icon name="download" size={16} /> 下載目前行程（JSON）
        </a>{" "}
        <label className="btn ghost small">
          <Icon name="upload" size={16} /> 匯入 JSON
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={!online}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importFile(f);
            }}
          />
        </label>{" "}
        <button className="btn ghost small" type="button" onClick={() => window.print()}>
          <Icon name="print" size={16} /> 列印／存成 PDF
        </button>
      </p>
      <p className="small muted">匯入的資料會先檢查格式與規則（例如活動 id 不可重複、司機時段格式），不符合就不會儲存。</p>
    </div>
  );
}

function DeleteCard() {
  const { doc, online, ask, toast } = useTrip();
  async function del() {
    const r = await ask("永久刪除這個行程？", {
      body: (
        <>
          <p>
            會刪除伺服器上的行程、所有版本、分享連結與訪客回應，<strong>無法復原</strong>。
          </p>
          <p className="small muted">已經下載的離線副本、備份檔或截圖無法收回。</p>
        </>
      ),
      fields: [{ name: "title", label: `請輸入行程名稱「${doc.meta.title}」確認`, required: true }],
      ok: "永久刪除",
    });
    if (!r) return;
    const res = await api("/api/trip", { method: "DELETE", body: { confirmTitle: r.title } });
    if (!res.ok) return toast(res.error);
    location.reload();
  }
  return (
    <div className="card section danger-zone">
      <h3>刪除行程</h3>
      <p className="small muted">刪除伺服器上的所有行程資料（FR-27）。建議先下載備份。</p>
      <button className="btn danger small" type="button" disabled={!online} onClick={() => void del()}>
        刪除行程…
      </button>
    </div>
  );
}
