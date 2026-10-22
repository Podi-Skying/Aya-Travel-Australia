import { redirect } from "next/navigation";
import { loadOwnerPage } from "@/server/pages";
import { TripApp } from "@/components/TripApp";
import { ConfigNotice, Notice } from "@/components/Notice";

export const dynamic = "force-dynamic";

export default async function OwnerHome() {
  const p = await loadOwnerPage();
  if (p.kind === "config") return <ConfigNotice missing={p.missing} />;
  if (p.kind === "public") return <TripApp mode="public" home initial={{ doc: p.trip.doc as never, versionNo: p.trip.versionNo, syncedAt: new Date().toISOString() }} />;
  if (p.kind === "signin") redirect("/api/auth/signin?callbackUrl=%2F");
  if (p.kind === "forbidden")
    return (
      <Notice title="沒有權限（403）">
        <p className="muted">這個帳號不是行程擁有者。訪客請使用擁有者提供的分享連結。</p>
        <p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- next-auth route, full navigation */}
          <a href="/api/auth/signout">登出</a>
        </p>
      </Notice>
    );
  if (p.kind === "none")
    return (
      <Notice title="尚未建立行程">
        <p className="muted">資料庫裡還沒有行程。請依 docs/DEPLOY.md 執行一次 npm run db:seed。</p>
      </Notice>
    );
  return <TripApp mode="owner" initial={{ doc: p.trip.doc, versionNo: p.trip.versionNo, syncedAt: new Date().toISOString() }} />;
}
