"use client";

import Link from "next/link";
import { useEffect } from "react";
import { t, useRootLang } from "@/i18n";
import { Icon } from "./Icon";

/* Not found and error pages: what happened, and a way back to the trip. */
export function EmptyPage({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  useRootLang();
  // These pages have no on-screen translator: release the hold set for English and Japanese viewers (layout.tsx).
  useEffect(() => document.documentElement.classList.remove("i18n-wait"), []);
  return (
    <main className="empty-page">
      <Icon name="compass" size={48} />
      <h1>{t(title)}</h1>
      <p>{t(body)}</p>
      <nav aria-label={t("回到行程")}>
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            {t("再試一次")}
          </button>
        )}
        <Link className="btn ghost" href="/plan">
          {t("回到行程")}
        </Link>
        <Link className="btn ghost" href="/">
          {t("回到散步")}
        </Link>
      </nav>
    </main>
  );
}
