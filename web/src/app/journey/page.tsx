import { redirect } from "next/navigation";
import { loadOwnerPage } from "@/server/pages";
import { JourneyView } from "@/components/journey/JourneyView";
import { Notice } from "@/components/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "南方之旅｜Aya 的雪梨與塔斯馬尼亞" };

export default async function OwnerJourney() {
  const p = await loadOwnerPage();
  if (p.kind === "signin") redirect("/api/auth/signin?callbackUrl=%2Fjourney");
  if (p.kind === "forbidden") return <Notice title="沒有權限（403）" />;
  if (p.kind === "none") return <Notice title="尚未建立行程" />;
  return <JourneyView doc={p.trip.doc} backHref="/" dataUrl="/api/trip" syncedAt={new Date().toISOString()} />;
}
