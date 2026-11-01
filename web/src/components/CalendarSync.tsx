"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { fmtTs } from "@/domain/format";
import { Icon } from "./Icon";
import { PendingButton } from "./ui";

type Last = { at: string; events: number; error?: string };

/* Owner menu: push the trip to Google Calendar now. Hidden until the calendar settings exist. */
export function CalendarSync() {
  const [state, setState] = useState<{ enabled: boolean; last: Last | null } | null>(null);
  useEffect(() => {
    void api<{ enabled: boolean; last: Last | null }>("/api/calendar-sync").then((r) => r.ok && setState(r.data));
  }, []);
  if (!state?.enabled) return null;
  return (
    <div>
      <PendingButton
        className="btn ghost small"
        pendingLabel="同步中…"
        onAction={async () => {
          const r = await api<Last>("/api/calendar-sync", { method: "POST", body: {} });
          if (r.ok) setState({ enabled: true, last: r.data });
          return r.ok;
        }}
      >
        <Icon name="calendar" size={16} /> 同步 Google 日曆
      </PendingButton>
      {state.last && <p className="small muted">{state.last.error ?? `${fmtTs(state.last.at)}・${state.last.events} 個活動`}</p>}
    </div>
  );
}
