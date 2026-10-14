import { getSession, isSameOrigin } from "@/server/session";
import { canRead, canWrite } from "@/server/rules";
import { displayVariantPath, fileExists, removeFile } from "@/server/files";
import {
  announce,
  computeWrite,
  getDoc,
  isCollectionPath,
  isDocPath,
  newDocId,
  paginate,
  removeChildren,
  removeDoc,
  runQuery,
  saveDoc,
  splitPath,
  type Data,
  type QuerySpec,
  type WriteKind,
} from "@/server/store";

export const dynamic = "force-dynamic";

// The single entry point for document reads and writes. The browser-side
// client in lib/store.ts speaks this protocol; server/rules.ts decides what
// each request is allowed to see or change.

const MAX_BODY = 256 * 1024;

function fail(status: number, code: string) {
  return Response.json({ error: code }, { status });
}

function parentOf(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function validSpec(spec: QuerySpec): boolean {
  if (!spec || typeof spec !== "object") return false;
  const tuples = (list: unknown, size: number) =>
    list === undefined ||
    (Array.isArray(list) &&
      list.length <= 10 &&
      list.every((t) => Array.isArray(t) && t.length === size && typeof t[0] === "string"));
  if (!tuples(spec.where, 3) || !tuples(spec.orderBy, 2)) return false;
  if (spec.group !== undefined) {
    return typeof spec.group === "string" && /^[A-Za-z_]{1,40}$/.test(spec.group);
  }
  return typeof spec.parent === "string" && isCollectionPath(spec.parent);
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return fail(401, "unauthenticated");
  if (!(await isSameOrigin(request))) return fail(403, "cross-site");

  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "too-large");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad-json");
  }
  if (!body || typeof body !== "object") return fail(400, "bad-json");
  const op = body.op;

  if (op === "get") {
    const path = String(body.path ?? "");
    if (!isDocPath(path)) return fail(400, "bad-path");
    const doc = getDoc(path);
    if (!canRead(session, path, doc?.data ?? null)) return fail(403, "permission-denied");
    return Response.json({ doc: doc ? { path: doc.path, data: doc.data } : null });
  }

  if (op === "query" || op === "count") {
    const spec = body.spec as QuerySpec;
    if (!validSpec(spec)) return fail(400, "bad-query");
    const visible = runQuery(spec).filter((d) => canRead(session, d.path, d.data));
    const page = paginate(visible, spec);
    if (op === "count") return Response.json({ count: page.length });
    return Response.json({ docs: page.map((d) => ({ path: d.path, data: d.data })) });
  }

  const now = Date.now();

  if (op === "set" || op === "merge" || op === "update" || op === "add") {
    const data = body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "bad-data");
    let path: string;
    if (op === "add") {
      const parent = String(body.parent ?? "");
      if (!isCollectionPath(parent)) return fail(400, "bad-path");
      path = `${parent}/${newDocId()}`;
    } else {
      path = String(body.path ?? "");
      if (!isDocPath(path)) return fail(400, "bad-path");
    }

    const before = getDoc(path)?.data ?? null;
    if (op === "update" && !before) return fail(404, "not-found");
    const kind: WriteKind = op === "add" ? "set" : op;
    let after: Data;
    try {
      after = computeWrite(kind, before, data as Data, now);
    } catch {
      return fail(400, "bad-data");
    }
    if (!canWrite(session, before ? "update" : "create", path, before, after, now)) {
      return fail(403, "permission-denied");
    }
    // A post must point at a photo that was actually uploaded.
    if (!before && splitPath(path)?.length === 2 && path.startsWith("photos/")) {
      if (!fileExists(String(after.imagePath))) return fail(400, "missing-image");
    }
    try {
      saveDoc(path, after, now);
    } catch {
      return fail(413, "too-large");
    }
    announce({ parent: parentOf(path), path, data: after });
    return Response.json({ ok: true, path });
  }

  if (op === "delete") {
    const path = String(body.path ?? "");
    if (!isDocPath(path)) return fail(400, "bad-path");
    const before = getDoc(path)?.data ?? null;
    if (!canWrite(session, "delete", path, before, null, now)) {
      return fail(403, "permission-denied");
    }
    if (before) {
      removeDoc(path);
      // Removing a post takes its comments and its image files with it.
      if (splitPath(path)?.length === 2 && path.startsWith("photos/")) {
        removeChildren(path);
        if (typeof before.imagePath === "string") {
          removeFile(before.imagePath);
          removeFile(displayVariantPath(before.imagePath));
        }
      }
      announce({ parent: parentOf(path), path, data: before });
    }
    return Response.json({ ok: true });
  }

  return fail(400, "bad-op");
}
