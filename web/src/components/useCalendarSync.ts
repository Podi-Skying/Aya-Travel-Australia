"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";
import { fmtTs } from "@/domain/format";
import { t } from "@/i18n/current";

type Last = { at: string; events: number; versionNo?: number; error?: string };
type Status = { enabled: boolean; synced: boolean; last: Last | null };

/** The ⋯ menu's Google Calendar row: 已同步 until the trip's version moves past the last good sync. */
export function useCalendarSync(active: boolean, versionNo: number) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    if (active) void api<Status>("/api/calendar-sync").then((r) => r.ok && setStatus(r.data));
  }, [active]);
  useEffect(refresh, [refresh, versionNo]);
  const sync = useCallback(async () => {
    setBusy(true);
    const r = await api<Last>("/api/calendar-sync", { method: "POST", body: {} });
    setBusy(false);
    if (r.ok) setStatus({ enabled: true, synced: !r.data.error, last: r.data });
    else setStatus((s) => (s ? { ...s, synced: false, last: { at: new Date().toISOString(), events: s.last?.events ?? 0, error: r.error } } : s));
  }, []);
  const last = status?.last ?? null;
  const synced = !!status?.synced;
  const failed = !!last?.error;
  const line = failed ? last!.error : synced && last ? t("{0} 個活動・{1}").replace("{0}", String(last.events)).replace("{1}", fmtTs(last.at).split(" ").at(-1) ?? "") : status?.enabled ? t("有更新未同步") : undefined;
  return { enabled: !!status?.enabled, synced, failed, busy, line, sync, refresh };
}
