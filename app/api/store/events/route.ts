import { getSession } from "@/server/session";
import { canRead } from "@/server/rules";
import { events } from "@/server/runtime";
import type { ChangeEvent } from "@/server/store";

export const dynamic = "force-dynamic";

// Live updates. Each browser holds one stream open and is told which
// collections changed; it then re-reads what it is showing. Only collection
// paths travel over the stream, and only for documents this member may read.

// Streams are closed after a while so the session is re-checked on reconnect.
const MAX_STREAM_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Sign in required", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const onChange = (change: ChangeEvent) => {
        if (canRead(session, change.path, change.data)) send(`data: ${change.parent}\n\n`);
      };
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      const expiry = setTimeout(() => {
        cleanup();
        try {
          controller.close();
        } catch {}
      }, MAX_STREAM_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        clearTimeout(expiry);
        events().off("change", onChange);
      };
      events().on("change", onChange);
      request.signal.addEventListener("abort", cleanup);
      send("retry: 3000\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
