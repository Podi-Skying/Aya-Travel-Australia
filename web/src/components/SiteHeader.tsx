"use client";

import type { ReactNode } from "react";
import { signIn, signOut } from "next-auth/react";
import { LangSwitch } from "@/i18n";

/*
 * Shared top navigation for every page (docs/DESIGN.md「共用導覽」): logo, 散步, 行程, then
 * 登入/登出. Share pages pass their /s/{token} base so the token is kept. The planner passes its
 * tabs as `children`; they replace the 散步/行程 links and the logo leads back to the walk.
 */
export const SITE_NAME = "2026澳洲旅程with Aya";
export type Section = "walk" | "plan";

export function SiteHeader({
  base = "",
  current,
  account,
  variant = "paper",
  children,
}: {
  base?: string;
  current?: Section;
  account: "signin" | "signout" | null;
  variant?: "paper" | "dark";
  children?: ReactNode;
}) {
  const links: { key: Section; label: string; href: string }[] = [
    { key: "walk", label: "散步", href: base || "/" },
    { key: "plan", label: "行程", href: `${base}/plan` },
  ];
  return (
    <header className={`site-header ${variant}${children ? " with-tabs" : ""}`}>
      <a className="site-logo" href={base || "/"} aria-label={`${SITE_NAME}，回到散步首頁`} title="回到散步">
        <svg viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
          <circle cx="13" cy="13" r="11" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 17 Q10 9 13 13 T20 9" fill="none" stroke="#d2483a" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>{SITE_NAME}</span>
      </a>
      {children}
      <nav aria-label="主要頁面">
        <LangSwitch />
        {!children &&
          links.map((l) => (
          <a key={l.key} href={l.href} aria-current={l.key === current ? "page" : undefined}>
            {l.label}
          </a>
        ))}
        {account && (
          <button
            type="button"
            className="site-account"
            onClick={() => void (account === "signin" ? signIn("github", { callbackUrl: "/plan" }) : signOut({ callbackUrl: "/" }))}
          >
            {account === "signin" ? "登入" : "登出"}
          </button>
        )}
      </nav>
    </header>
  );
}
