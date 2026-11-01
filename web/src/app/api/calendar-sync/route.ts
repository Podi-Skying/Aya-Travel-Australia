import { calendarStatus, syncCalendar } from "@/server/gcal";
import { sameOrigin } from "@/server/http";
import { checkOwner } from "@/server/owner";
import { getCurrentTrip } from "@/server/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const denied = () => Response.json({ error: "需要登入" }, { status: 401 });

export async function GET() {
  const c = await checkOwner();
  if (!c.ok) return denied();
  const cur = await getCurrentTrip(c.owner);
  return Response.json(await calendarStatus(cur?.versionNo));
}

export async function POST(req: Request) {
  const c = await checkOwner();
  if (!c.ok || !sameOrigin(req)) return denied();
  const cur = await getCurrentTrip(c.owner);
  if (!cur) return Response.json({ error: "找不到行程" }, { status: 404 });
  const r = await syncCalendar(cur.doc as never, { siteUrl: new URL(req.url).origin, versionNo: cur.versionNo });
  return r ? Response.json(r) : Response.json({ error: "還沒設定 Google 日曆" }, { status: 409 });
}
