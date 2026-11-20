export { getMyPhotos as GET, postMyPhoto as POST } from "@/server/photo-handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A resized photo is well under 4 MB; the default body limit is enough.
