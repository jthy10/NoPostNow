import { getSession, isFreshAdmin } from "@/server/session";
import { sessionPayload } from "@/server/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ user: null });
  return Response.json({ ...sessionPayload(session.account), freshAdmin: isFreshAdmin(session) });
}
