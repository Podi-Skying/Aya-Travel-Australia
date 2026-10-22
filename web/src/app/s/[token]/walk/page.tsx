import { redirect } from "next/navigation";

/* The walk is now the share link's first page. */
export default async function OldSharedWalk({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/s/${encodeURIComponent(token)}`);
}
