"use client";

import { useTrip } from "./TripApp";

/*
 * Share (chictrip review P2-b). Guests share the read-only link they are on. The owner's page needs a
 * login and the share-link page was removed (2026-10-26), so the owner gets no button here.
 */
export function ShareButton({ title }: { title?: string }) {
  const { mode, toast } = useTrip();
  if (mode === "owner") return null;
  return (
    <button
      type="button"
      className="btn ghost"
      onClick={async () => {
        const url = location.href;
        const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
        if (nav.share) {
          try {
            await nav.share({ title: title ?? document.title, url });
          } catch {
            /* cancelled */
          }
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          toast("已複製連結");
        } catch {
          toast("無法複製，請手動複製網址");
        }
      }}
    >
      分享
    </button>
  );
}
