import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getSession, isSameOrigin } from "@/server/session";
import { MAX_AVATAR_BYTES, MAX_PHOTO_BYTES, resolveFile, sniffImage } from "@/server/files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

// Members-only image delivery. Files never get a public URL: the session
// cookie is checked on every request.
export async function GET(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return new Response("Sign in required", { status: 401 });
  const target = resolveFile((await params).path);
  if (!target) return new Response("Not found", { status: 404 });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target.abs);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const head = Buffer.alloc(16);
  const fd = fs.openSync(target.abs, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);

  return new Response(Readable.toWeb(fs.createReadStream(target.abs)) as ReadableStream, {
    headers: {
      "Content-Type": sniffImage(head) ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      // Names are unique per upload, so a member's browser may keep its copy —
      // but no shared cache in between may.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function PUT(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!(await isSameOrigin(request))) {
    return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  const target = resolveFile((await params).path);
  // Members write only inside their own folders.
  if (!target || target.owner !== session.account.uid) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  if (fs.existsSync(target.abs)) {
    return Response.json({ error: "That file already exists" }, { status: 409 });
  }

  const limit = target.kind === "avatar" ? MAX_AVATAR_BYTES : MAX_PHOTO_BYTES;
  if (Number(request.headers.get("content-length") ?? 0) > limit) {
    return Response.json({ error: "That image is too large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > limit) {
    return Response.json({ error: "That image is too large" }, { status: 413 });
  }
  if (!sniffImage(bytes.subarray(0, 16))) {
    return Response.json({ error: "Only images can be uploaded" }, { status: 415 });
  }

  fs.mkdirSync(path.dirname(target.abs), { recursive: true });
  // Write beside the destination and rename, so a dropped connection never
  // leaves half a photo where a whole one is expected.
  const partial = `${target.abs}.part`;
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, target.abs);
  return Response.json({ ok: true });
}
