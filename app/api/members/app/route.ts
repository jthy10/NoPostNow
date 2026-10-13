import { getSession } from "@/server/session";
import { listCollection } from "@/server/store";

export const dynamic = "force-dynamic";

// Which members have a device registered for notifications. Only the uids
// leave the server — the device details themselves stay private.
export async function GET() {
  if (!(await getSession())) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const uids = new Set<string>();
  for (const sub of listCollection("pushSubscriptions")) {
    if (typeof sub.data.uid === "string") uids.add(sub.data.uid);
  }
  return Response.json({ uids: [...uids] });
}
