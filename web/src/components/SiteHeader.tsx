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
        {/* Tasmania's coastline (Natural Earth, public domain, simplified); the dot is Hobart, our base (Kai 2026-11-01). */}
        <svg viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
          <path d="M2.6 4.1C2.8 5.4 3.7 8.2 4.3 9.5C4.9 10.8 5.8 11.3 6.1 12C6.3 12.6 5.8 12.7 5.8 13.4C5.8 14.1 6 15.4 6.3 16.3C6.5 17.2 7 18.1 7.4 18.6C7.7 19.1 7.7 18.6 8.2 19.4C8.7 20.1 9.7 22.6 10.5 23.2C11.4 23.9 12.7 23.2 13.3 23.3C13.9 23.4 13.9 23.8 14.2 23.9C14.5 24 14.8 24.4 15.1 24C15.4 23.6 15.9 22.2 16.2 21.7C16.6 21.3 17 21.5 17.2 21.3C17.4 21 17.2 20.4 17.3 20.2C17.4 19.9 17.6 19.7 17.9 19.6C18.2 19.5 18.8 19.4 19.2 19.6C19.6 19.8 19.9 20.7 20.2 20.9C20.6 21.1 21.1 21.1 21.3 20.8C21.5 20.4 21.5 19.4 21.4 18.9C21.4 18.4 21 18.3 21 17.6C21 16.8 21.3 15.2 21.5 14.6C21.6 13.9 21.6 13.8 21.9 13.7C22.2 13.6 22.9 13.8 23.1 13.7C23.4 13.6 23.4 13.8 23.4 13.3C23.4 12.8 23 11.4 22.9 10.5C22.8 9.5 22.9 8.3 23 7.6C23 7 23.3 6.9 23.3 6.5C23.3 6.1 22.9 5.9 22.9 5.5C22.9 5.1 23.3 4.6 23.2 4.2C23.1 3.8 22.9 3.4 22.6 3.1C22.2 2.8 21.7 2.3 21.4 2.3C21 2.3 21 3 20.7 3.1C20.3 3.2 19.7 2.9 19.4 3C19 3.2 19 3.7 18.5 3.9C17.9 4.1 16.9 3.9 15.9 4.1C14.8 4.4 13.3 5.5 12.2 5.5C11.1 5.6 9.9 4.8 9.3 4.5C8.7 4.2 9.1 4 8.7 3.8C8.3 3.5 7.2 3.3 6.8 3C6.4 2.8 6.5 2.4 6.3 2.3C6 2.2 5.6 2.7 5.2 2.6C4.7 2.6 3.8 1.8 3.4 2C2.9 2.2 2.4 2.9 2.6 4.1Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <circle cx="17.3" cy="17.7" r="2" fill="#d2483a" />
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
