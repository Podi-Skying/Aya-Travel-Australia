import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./site.css";

export const metadata: Metadata = {
  title: "2026澳洲旅程with Aya",
  description: "Aya 雪梨與塔斯馬尼亞旅遊規劃（私人測試版）",
  manifest: "/manifest.webmanifest",
  // Private trip: keep every page out of search engines, including the optional public home.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf7f0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Noto+Serif+TC:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
