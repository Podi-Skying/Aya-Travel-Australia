import { Notice } from "@/components/Notice";

/* Explains next-auth sign-in errors in Chinese instead of the generic English page. */

export const metadata = { title: "登入失敗｜2026澳洲旅程with Aya", robots: { index: false, follow: false } };

const MESSAGES: Record<string, { title: string; body: string }> = {
  AccessDenied: {
    title: "這個 GitHub 帳號沒有擁有者權限",
    body: "只有 OWNER_GITHUB_IDS 裡的 GitHub 數字 id 可以登入（Podi-Skying 是 32431832）。請確認登入的是 Podi-Skying，且 Vercel 的 OWNER_GITHUB_IDS 是 32431832（只填數字，不要加引號），改完要 Redeploy。",
  },
  OAuthCallback: {
    title: "GitHub 回傳登入結果時失敗",
    body: "通常是 GITHUB_SECRET 不對，或 GitHub OAuth App 的 Authorization callback URL 和網站網址不同。callback 必須是：網站網址 + /api/auth/callback/github。",
  },
  Callback: {
    title: "GitHub 回傳登入結果時失敗",
    body: "通常是 GITHUB_SECRET 不對，或 GitHub OAuth App 的 Authorization callback URL 和網站網址不同。callback 必須是：網站網址 + /api/auth/callback/github。",
  },
  OAuthSignin: {
    title: "無法開始 GitHub 登入",
    body: "請確認 Vercel 的 GITHUB_ID 是 OAuth App 的 Client ID，且 NEXTAUTH_URL 是正式網址（例如 https://aya-travel-australia.vercel.app，不要加結尾斜線）。",
  },
  Configuration: {
    title: "伺服器登入設定有問題",
    body: "請確認 Vercel 的 NEXTAUTH_SECRET、NEXTAUTH_URL、GITHUB_ID、GITHUB_SECRET 都有設定，改完後 Redeploy。",
  },
};

export default async function AuthError({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const m = (error && MESSAGES[error]) || { title: "登入失敗", body: "請再試一次。如果一直失敗，請把這個頁面的網址傳給維護者。" };
  return (
    <Notice title={m.title}>
      <p>{m.body}</p>
      <p className="muted small">錯誤代碼：{error ?? "unknown"}</p>
      <p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- next-auth route, full navigation */}
        <a href="/api/auth/signin?callbackUrl=%2Fplan">重新登入</a>
      </p>
    </Notice>
  );
}
