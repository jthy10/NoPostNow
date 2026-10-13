import { headers } from "next/headers";
import { config } from "./runtime.ts";

// The address members reach this instance at. The configured public URL wins;
// otherwise it is read from the request, which is right for LAN and tunnels.
export async function siteOrigin(): Promise<string> {
  const configured = config().publicUrl;
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? `localhost:${config().port}`;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? "http";
  return `${proto}://${host}`;
}
