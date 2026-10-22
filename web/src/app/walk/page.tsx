import { redirect } from "next/navigation";
import { loadOwnerPage } from "@/server/pages";
import { WalkView } from "@/components/walk/WalkView";
import { ConfigNotice, Notice } from "@/components/Notice";
import { toPublicDoc } from "@/domain/privacy";

export const dynamic = "force-dynamic";
export const metadata = { title: "每日路線散步｜Aya 的澳洲旅程" };

export default async function OwnerWalk() {
  const p = await loadOwnerPage();
  if (p.kind === "config") return <ConfigNotice missing={p.missing} />;
  if (p.kind === "public") return <WalkView doc={p.trip.doc as never} backHref="/" dataUrl="/api/public" syncedAt={new Date().toISOString()} />;
  if (p.kind === "signin") redirect("/api/auth/signin?callbackUrl=%2Fwalk");
  if (p.kind === "forbidden") return <Notice title="沒有權限（403）" />;
  if (p.kind === "none") return <Notice title="尚未建立行程" />;
  // The walk page shows the same redacted view for everyone.
  return <WalkView doc={toPublicDoc(p.trip.doc) as never} backHref="/" dataUrl="/api/public" syncedAt={new Date().toISOString()} />;
}
