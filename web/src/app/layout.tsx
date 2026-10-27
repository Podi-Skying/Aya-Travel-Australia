import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./site.css";
import { Sparks } from "@/components/Sparks";

export const metadata: Metadata = {
  title: "2026澳洲旅程with Aya",
  description: "Aya 雪梨與塔斯馬尼亞旅遊規劃（私人測試版）",
  manifest: "/manifest.webmanifest",
  // Private trip: keep every page out of search engines, including the optional public home.
  robots: { index: false, follow: false },
};

const LANG_BOOT = `try{var l=localStorage.getItem("aya-lang");if(l==="en"||l==="ja"){var d=document.documentElement;d.lang=l;d.classList.add("i18n-wait")}}catch(e){}`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf7f0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The pre-paint script below may set lang and a class before React hydrates.
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* English or Japanese viewers: hold the page until it is translated, so 繁中 never flashes first (see i18n-wait). */}
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Noto+Serif+TC:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Sparks>{children}</Sparks>
      </body>
    </html>
  );
}
