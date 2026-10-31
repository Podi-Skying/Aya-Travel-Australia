import { EmptyPage } from "@/components/EmptyPage";

export const metadata = { title: "找不到這個頁面｜2026澳洲旅程with Aya", robots: { index: false, follow: false } };

export default function NotFound() {
  return <EmptyPage title="找不到這個頁面" body="連結可能打錯了，或頁面已經移動。" />;
}
