import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getSession, isSameOrigin } from "@/server/session";
import {
  displayVariantPath,
  MAX_AVATAR_BYTES,
  MAX_PHOTO_BYTES,
  resolveFile,
  sniffImage,
} from "@/server/files";
import { getDoc, listCollection } from "@/server/store";

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
  const head = Buffer.alloc(16);
  try {
    const fd = fs.openSync(target.abs, "r");
    try {
      stat = fs.fstatSync(fd);
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });

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
  // Created exclusively, so two uploads of the same name can never replace
  // one another, even when they arrive at the same moment.
  try {
    fs.writeFileSync(target.abs, bytes, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return Response.json({ error: "That file already exists" }, { status: 409 });
    }
    // Never leave half a photo where a whole one is expected.
    fs.rmSync(target.abs, { force: true });
    throw err;
  }
  return Response.json({ ok: true });
}

// Takes back an upload that never became anything: a post that failed to
// save, an avatar that failed to set. Only the uploader's own file, and only
// while nothing points at it — deleting a post goes through the store, which
// decides what happens to its files.
export async function DELETE(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!(await isSameOrigin(request))) {
    return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  const segments = (await params).path;
  const target = resolveFile(segments);
  if (!target || target.owner !== session.account.uid) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  const storagePath = segments.join("/");
  const inUse =
    getDoc(`users/${target.owner}`)?.data.avatarPath === storagePath ||
    listCollection("photos").some(
      (p) =>
        typeof p.data.imagePath === "string" &&
        (p.data.imagePath === storagePath || displayVariantPath(p.data.imagePath) === storagePath)
    );
  if (inUse) return Response.json({ error: "That file is in use" }, { status: 409 });
  fs.rmSync(target.abs, { force: true });
  return Response.json({ ok: true });
}
