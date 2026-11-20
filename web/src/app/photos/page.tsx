import { cookies } from "next/headers";
import { MyPhotosPage } from "@/components/MyPhotos";
import { ConfigNotice, Notice } from "@/components/Notice";
import { missingConfig } from "@/server/config";
import { photoAccess, VIEWER_COOKIE } from "@/server/photo-access";
import { tripForPhotos } from "@/server/my-photos";
import { googleSignInEnabled, photoViewersEnabled } from "@/server/auth";
import { PhotoSignIn } from "@/components/PhotoSignIn";

export const dynamic = "force-dynamic";
export const metadata = { title: "我的照片｜2026澳洲旅程with Aya", robots: { index: false, follow: false } };

/* Kai's own photos (docs/PHOTOS-PLAN.md): the owner and allowed viewers only. Everyone else gets the same notice. */
export default async function Photos({ searchParams }: { searchParams: Promise<{ link?: string; day?: string }> }) {
  const missing = missingConfig("owner");
  if (missing.length) return <ConfigNotice missing={missing} />;
  const jar = await cookies();
  const access = await photoAccess(null, jar.get(VIEWER_COOKIE)?.value ?? null);
  const { link, day } = await searchParams;
  if (!access) {
    return (
      <Notice title="我的照片">
        <p>{link === "invalid" ? "這個照片連結已經失效，請向 Kai 要新的連結。" : "這裡只有 Kai 和他允許的人看得到。"}</p>
        <PhotoSignIn google={googleSignInEnabled()} viewers={photoViewersEnabled()} />
      </Notice>
    );
  }
  const doc = await tripForPhotos(access);
  if (!doc) return <Notice title="尚未建立行程" />;
  return <MyPhotosPage access={access.kind} doc={doc} initialDay={day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null} />;
}
