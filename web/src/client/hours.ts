"use client";

import { useEffect, useState } from "react";
import type { HoursInfo } from "@/domain/hours";

/*
 * Cached opening hours by activity id (Kai 2026-11-07). One request per page, shared by every component;
 * the server reads its cache only, so viewing never calls Google.
 */
const HOURS_EVENT = "aya-hours-changed";
let shared: { key: string; p: Promise<Record<string, HoursInfo>> } | null = null;

function load(token?: string) {
  const key = token ?? "";
  if (!shared || shared.key !== key)
    shared = {
      key,
      p: fetch(`/api/hours${token ? `?token=${encodeURIComponent(token)}` : ""}`)
        .then((r) => (r.ok ? r.json() : { hours: {} }))
        .then((b: { hours?: Record<string, HoursInfo> }) => b.hours ?? {})
        .catch(() => ({})),
    };
  return shared.p;
}

export function useHours(token?: string): Record<string, HoursInfo> {
  const [hours, setHours] = useState<Record<string, HoursInfo>>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const on = () => setVersion((v) => v + 1);
    addEventListener(HOURS_EVENT, on);
    return () => removeEventListener(HOURS_EVENT, on);
  }, []);
  useEffect(() => {
    let live = true;
    void load(token).then((h) => live && setHours(h));
    return () => {
      live = false;
    };
  }, [token, version]);
  return hours;
}

/** The owner refreshes one place's hours from Google, then every view reloads them. */
export async function refreshHours(itemId: string): Promise<boolean> {
  const r = await fetch("/api/hours", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: itemId }) }).catch(() => null);
  shared = null;
  dispatchEvent(new Event(HOURS_EVENT));
  return !!r?.ok;
}
