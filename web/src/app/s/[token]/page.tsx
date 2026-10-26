import { getPublicTrip } from "@/server/sharing";
import { WalkView } from "@/components/walk/WalkView";
import { ConfigNotice, Notice } from "@/components/Notice";
import { missingConfig } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "2026澳洲旅程with Aya（分享）", robots: { index: false, follow: false } };

/* Share links open with the walk; the read-only planner with interest voting is at /s/[token]/plan. */
export default async function SharedWalk({ params }: { params: Promise<{ token: string }> }) {
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
  return (
    <WalkView doc={t.doc as never} dataUrl={`/api/s/${token}`} syncedAt={new Date().toISOString()} base={`/s/${token}`} account={null} />
  );
}
