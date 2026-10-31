"use client";

import { EmptyPage } from "@/components/EmptyPage";

/* A page failed to render: say so plainly and offer a way on, instead of the browser's blank error. */
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return <EmptyPage title="這裡出了點問題" body="你的行程資料沒有受到影響，可以再試一次。" onRetry={reset} />;
}
