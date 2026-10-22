"use client";

import { useTrip } from "./TripApp";
import { Badge, PRI, STATUS, VERIFY } from "./ui";

export function Info() {
  const { doc, mode } = useTrip();
  const legend = (o: Record<string, { t: string; c: string }>) =>
    Object.values(o).map((v) => (
      <span key={v.t}>
        <Badge {...v} />{" "}
      </span>
    ));
  return (
    <>
      <div className="alert warn">
        <span className="ic">⚠️</span>
        <p>
          <strong>目前沒有即時資料連線。</strong>
          以下為官方來源連結，出發前與每天出門前請手動查看道路、國家公園與天氣警示。網站不會把舊資料當成最新資訊。
        </p>
      </div>
      <div className="grid cols-2 section">
        <div className="card">
          <h3>官方警示與交通來源</h3>
          <ul className="src-list">
            {doc.alertsSources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>
                <span className="badge b-line">{s.kind}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">最後已知警示狀態：未連線（未查詢）。每日的規劃提醒在「每日行程」中，離線時顯示上次同步的結果。</p>
        </div>
        <div className="card">
          <h3>標籤說明</h3>
          <p>
            <strong>活動優先度</strong>
            <br />
            {legend(PRI)}
          </p>
          <p className="small muted">必去：不會被默默移除，衝突時會請你決定。優先：條件允許時優先安排。可替換：天氣或交通變動時第一個被替換。</p>
          <p>
            <strong>可行性</strong>
            <br />
            {legend(VERIFY)}
          </p>
          <p className="small muted">標籤只描述目前證據，不保證行程一定能照計畫進行。已知封閉或不可能的轉乘不會被標為可執行。</p>
          <p>
            <strong>費用狀態</strong>
            <br />
            {legend(STATUS)}
          </p>
        </div>
      </div>
      <div className="grid cols-2 section">
        <div className="card">
          <h3>規劃原則</h3>
          <ul className="todo-list">
            <li>每天 3–4 個主要活動是彈性目標，移動日、渡輪日、健行日會減量。</li>
            <li>一般開車日以總車程 2–3 小時為準（提案中，待確認），移動日例外但需安排休息。</li>
            <li>司機的日期與時段確認前，不依賴朋友開車。</li>
            <li>任何變更都保留原始行程，確認後才套用並重新檢查。</li>
            <li>網站只提供外部預訂連結，不會代為預訂或付款。</li>
          </ul>
        </div>
        <div className="card">
          <h3>隱私</h3>
          <ul className="todo-list">
            <li>分享連結為唯讀，伺服器只送出已隱藏確切住宿地址與司機等私人交通細節的版本。</li>
            <li>即使隱藏地址，分享連結仍會透露旅行日期與活動模式，分享前請先檢查。</li>
            <li>訪客表達興趣只需暱稱（可留空）；擁有者只看到合計人數。</li>
            <li>已下載或截圖的離線副本無法收回。</li>
          </ul>
        </div>
      </div>
      {mode === "owner" && (
        <div className="card section">
          <h3>尚未決定的事項（TBD）</h3>
          <ul className="todo-list">
            <li>司機可開車的確切日期與時段、乘客與路線限制</li>
            <li>需付費住宿的晚數與每晚／全程預算上限</li>
            <li>開車時數上限與休息規則</li>
            <li>資料更新頻率、重大警示的定義</li>
            <li>哪些資料要即時、哪些用估計或外部連結；AI 規劃（第二階段）</li>
          </ul>
        </div>
      )}
    </>
  );
}
