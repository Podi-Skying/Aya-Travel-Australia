import { redirect } from "next/navigation";
import { loadOwnerPage } from "@/server/pages";
import { WalkView } from "@/components/walk/WalkView";
import { ConfigNotice, Notice } from "@/components/Notice";
import { toPublicDoc } from "@/domain/privacy";

export const dynamic = "force-dynamic";
export const metadata = { title: "南方散步｜Aya 的雪梨與塔斯馬尼亞" };

/* Home: the hand-drawn route walk. Everyone sees the redacted document; the planner lives at /plan. */
export default async function Home() {
  const p = await loadOwnerPage();
  if (p.kind === "config") return <ConfigNotice missing={p.missing} />;
  if (p.kind === "public")
    return <WalkView doc={p.trip.doc as never} dataUrl="/api/public" syncedAt={new Date().toISOString()} planHref="/plan" journeyHref="/journey" account="signin" />;
  if (p.kind === "signin") redirect("/api/auth/signin?callbackUrl=%2Fplan");
  if (p.kind === "forbidden") return <Notice title="沒有權限（403）" />;
  if (p.kind === "none") return <Notice title="尚未建立行程" />;
  return <WalkView doc={toPublicDoc(p.trip.doc) as never} dataUrl="/api/trip" syncedAt={new Date().toISOString()} planHref="/plan" journeyHref="/journey" account="owner" />;
}
