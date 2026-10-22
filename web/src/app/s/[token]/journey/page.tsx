import { getPublicTrip } from "@/server/sharing";
import { JourneyView } from "@/components/journey/JourneyView";
import { ConfigNotice, Notice } from "@/components/Notice";
import { missingConfig } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "南方之旅｜Aya 的雪梨與塔斯馬尼亞", robots: { index: false, follow: false } };

export default async function SharedJourney({ params }: { params: Promise<{ token: string }> }) {
  const missing = missingConfig("public");
  if (missing.length) return <ConfigNotice missing={missing} />;
  const { token } = await params;
  const t = await getPublicTrip(token);
  if (!t) return <Notice title="此分享連結已停用或不存在" />;
  return <JourneyView doc={t.doc as never} backHref={`/s/${token}`} dataUrl={`/api/s/${token}`} syncedAt={new Date().toISOString()} />;
}
