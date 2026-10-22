import { getPublicTrip } from "@/server/sharing";
import { WalkView } from "@/components/walk/WalkView";
import { ConfigNotice, Notice } from "@/components/Notice";
import { missingConfig } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "每日路線散步｜Aya 的澳洲旅程" };

export default async function SharedWalk({ params }: { params: Promise<{ token: string }> }) {
  const missing = missingConfig("public");
  if (missing.length) return <ConfigNotice missing={missing} />;
  const { token } = await params;
  const t = await getPublicTrip(token);
  if (!t) return <Notice title="此分享連結已停用或不存在" />;
  return <WalkView doc={t.doc as never} backHref={`/s/${token}`} dataUrl={`/api/s/${token}`} syncedAt={new Date().toISOString()} />;
}
