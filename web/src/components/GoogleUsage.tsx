"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { fmtDay } from "@/domain/format";

/* 「Google API 用量」 for the owner (docs/PLAN-2026-10-26-google.md): numbers only, never the key. */

type Status = {
  keyPresent: boolean;
  dailyCap: number;
  callsToday: number;
  days: { date: string; apis: Record<string, { calls: number; hits: number }>; calls: number; hits: number }[];
  month: { usd: number; calls: Record<string, number> };
};

const API_NAME: Record<string, string> = { places_search: "找地點", place_details: "地點資料", place_photo: "地點照片", routes: "路線" };

export function GoogleUsage() {
  const [s, setS] = useState<Status | null | "error">(null);
  useEffect(() => {
    let live = true;
    api<Status>("/api/google/status").then((r) => live && setS(r.ok ? r.data : "error"));
    return () => {
      live = false;
    };
  }, []);
  return (
    <details className="card section day-summary google-usage">
      <summary>
        <h3>Google API 用量</h3>
      </summary>
      {s === null ? (
        <p className="muted small">讀取中…</p>
      ) : s === "error" ? (
        <p className="muted small">暫時無法讀取用量。</p>
      ) : (
        <>
          <p className="small">
            金鑰：{s.keyPresent ? "已設定" : "未設定（路線改用 OSRM 免費服務，不抓 Google 照片）"}・今天 {s.callsToday} / {s.dailyCap} 次（剩 {Math.max(0, s.dailyCap - s.callsToday)} 次）
          </p>
          <p className="small">
            本月估計費用：<strong>US${s.month.usd.toFixed(2)}</strong>
            <span className="muted">（扣掉 Google 每月免費額度後；依官方牌價估算，實際以 Google Cloud 帳單為準）</span>
          </p>
          {s.days.length ? (
            <div className="table-wrap">
              <table className="sky-nights">
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    {Object.keys(API_NAME).map((k) => (
                      <th key={k} scope="col">
                        {API_NAME[k]}
                      </th>
                    ))}
                    <th scope="col">快取命中率</th>
                  </tr>
                </thead>
                <tbody>
                  {s.days.map((d) => (
                    <tr key={d.date}>
                      <td>{fmtDay(d.date)}</td>
                      {Object.keys(API_NAME).map((k) => (
                        <td key={k}>{d.apis[k]?.calls ?? 0}</td>
                      ))}
                      <td>{d.calls + d.hits ? `${Math.round((d.hits / (d.calls + d.hits)) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">最近 14 天沒有使用紀錄。</p>
          )}
          <p className="muted small">表格是付費呼叫次數；命中率是「從資料庫快取回答、沒有呼叫 Google」的比例。路線算過就存起來，看頁面不會再呼叫。</p>
        </>
      )}
    </details>
  );
}
