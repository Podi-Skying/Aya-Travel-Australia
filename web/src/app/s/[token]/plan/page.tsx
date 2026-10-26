import { getPublicTrip } from "@/server/sharing";
import { TripApp } from "@/components/TripApp";
import { ConfigNotice, Notice } from "@/components/Notice";
import { missingConfig } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "行程（唯讀分享）｜2026澳洲旅程with Aya", robots: { index: false, follow: false } };

export default async function SharedPlanner({ params }: { params: Promise<{ token: string }> }) {
  const missing = missingConfig("public");
  if (missing.length) return <ConfigNotice missing={missing} />;
  const { token } = await params;
  const t = await getPublicTrip(token);
  if (!t)
    return (
      <Notice title="此分享連結已停用或不存在">
        <p className="muted">請向行程擁有者索取新的連結。</p>
      </Notice>
    );
  return <TripApp mode="public" token={token} initial={{ doc: t.doc as never, versionNo: t.versionNo, syncedAt: new Date().toISOString() }} />;
}
