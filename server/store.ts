import { db, events } from "./runtime.ts";
import { randomId } from "./core/accounts.ts";

// A small document store on top of SQLite. Documents are JSON blobs addressed
// by slash-separated paths ("photos/abc", "photos/abc/comments/def"), which
// keeps the data model the interface was written against while everything
// stays in one local file.
//
// Nothing here decides who may do what — see rules.ts. This module only reads,
// computes and persists.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = { [key: string]: Json };
export type StoredDoc = { path: string; id: string; parent: string; data: Data };

type DocRow = { path: string; id: string; parent: string; data: string };

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,199}$/;

// Collection paths have an odd number of segments, document paths an even one.
export function splitPath(path: string): string[] | null {
  if (typeof path !== "string" || path.length > 600) return null;
  const parts = path.split("/");
  return parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..") ? parts : null;
}

export function isDocPath(path: string): boolean {
  const parts = splitPath(path);
  return !!parts && parts.length % 2 === 0;
}

export function isCollectionPath(path: string): boolean {
  const parts = splitPath(path);
  return !!parts && parts.length % 2 === 1;
}

function toDoc(row: DocRow): StoredDoc {
  return { path: row.path, id: row.id, parent: row.parent, data: JSON.parse(row.data) };
}

export function getDoc(path: string): StoredDoc | null {
  const row = db().prepare("SELECT path, id, parent, data FROM docs WHERE path = ?").get(path) as
    | DocRow
    | undefined;
  return row ? toDoc(row) : null;
}

export function listCollection(parent: string): StoredDoc[] {
  return (
    db().prepare("SELECT path, id, parent, data FROM docs WHERE parent = ?").all(parent) as DocRow[]
  ).map(toDoc);
}

// Every document in any collection with this name, wherever it is nested.
export function listGroup(coll: string): StoredDoc[] {
  return (
    db().prepare("SELECT path, id, parent, data FROM docs WHERE coll = ?").all(coll) as DocRow[]
  ).map(toDoc);
}

// --- values ----------------------------------------------------------------

export function isTimestamp(value: unknown): value is { __ts: number } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { __ts?: unknown }).__ts === "number" &&
    Object.keys(value).length === 1
  );
}

export function millis(value: unknown): number | null {
  return isTimestamp(value) ? value.__ts : null;
}

function isPlainObject(value: unknown): value is Data {
  return !!value && typeof value === "object" && !Array.isArray(value) && !isTimestamp(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Data)[k], (b as Data)[k]))
  );
}

// Top-level keys whose value differs between two versions of a document.
export function changedKeys(before: Data | null, after: Data): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  return [...keys].filter((k) => !deepEqual(before?.[k], after[k]));
}

function field(data: Data, name: string): Json | undefined {
  let current: Json | undefined = data;
  for (const part of name.split(".")) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

// --- writes ----------------------------------------------------------------

// Sentinels the client sends in place of values it cannot compute itself.
type Transform =
  | { __op: "serverTimestamp" }
  | { __op: "arrayUnion"; values: Json[] }
  | { __op: "arrayRemove"; values: Json[] };

function isTransform(value: unknown): value is Transform {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { __op?: unknown }).__op === "string"
  );
}

// Assigning one of these would change an object's prototype instead of adding
// a field, leaving a document that passes the rules but is saved without the
// fields they checked.
function safeKey(key: string): string {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new Error("Invalid field name.");
  }
  return key;
}

function resolve(incoming: Json, existing: Json | undefined, now: number): Json {
  if (isTransform(incoming)) {
    const current = Array.isArray(existing) ? existing : [];
    switch (incoming.__op) {
      case "serverTimestamp":
        return { __ts: now };
      case "arrayUnion": {
        const out = [...current];
        for (const v of incoming.values ?? []) {
          if (!out.some((x) => deepEqual(x, v))) out.push(v);
        }
        return out;
      }
      case "arrayRemove":
        return current.filter((x) => !(incoming.values ?? []).some((v) => deepEqual(x, v)));
      default:
        throw new Error("Unknown transform.");
    }
  }
  if (Array.isArray(incoming)) return incoming.map((v) => resolve(v, undefined, now));
  if (isPlainObject(incoming)) {
    const out: Data = {};
    for (const [k, v] of Object.entries(incoming)) out[safeKey(k)] = resolve(v, undefined, now);
    return out;
  }
  return incoming;
}

function mergeInto(target: Data, incoming: Data, now: number) {
  for (const [key, value] of Object.entries(incoming)) {
    safeKey(key);
    if (isPlainObject(value) && !isTransform(value)) {
      const child: Data = isPlainObject(target[key]) ? { ...(target[key] as Data) } : {};
      mergeInto(child, value, now);
      target[key] = child;
    } else {
      target[key] = resolve(value, target[key], now);
    }
  }
}

function setAtPath(target: Data, dotted: string, value: Json, now: number) {
  const parts = dotted.split(".").map(safeKey);
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next: Data = isPlainObject(node[part]) ? { ...(node[part] as Data) } : {};
    node[part] = next;
    node = next;
  }
  const last = parts[parts.length - 1];
  node[last] = resolve(value, node[last], now);
}

export type WriteKind = "set" | "merge" | "update";

// What a document would contain after this write. `update` treats dotted keys
// as nested field paths and replaces values; `merge` deep-merges maps.
export function computeWrite(
  kind: WriteKind,
  before: Data | null,
  payload: Data,
  now: number
): Data {
  if (kind === "set") {
    return resolve(payload, undefined, now) as Data;
  }
  const after: Data = structuredClone(before ?? {});
  if (kind === "merge") {
    mergeInto(after, payload, now);
  } else {
    for (const [key, value] of Object.entries(payload)) setAtPath(after, key, value, now);
  }
  return after;
}

const MAX_DOC_BYTES = 200_000;

export function saveDoc(path: string, data: Data, now: number) {
  const parts = splitPath(path);
  if (!parts || parts.length % 2 !== 0) throw new Error("Invalid document path.");
  const json = JSON.stringify(data);
  if (json.length > MAX_DOC_BYTES) throw new Error("Document is too large.");
  const parent = parts.slice(0, -1).join("/");
  db()
    .prepare(
      `INSERT INTO docs (path, parent, coll, id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .run(path, parent, parts[parts.length - 2], parts[parts.length - 1], json, now, now);
}

export function removeDoc(path: string) {
  db().prepare("DELETE FROM docs WHERE path = ?").run(path);
}

// Removes every document nested underneath a document (its subcollections).
export function removeChildren(path: string) {
  db()
    .prepare("DELETE FROM docs WHERE parent = ? OR parent LIKE ? ESCAPE '\\'")
    .run(path, path.replace(/[\\%_]/g, "\\$&") + "/%");
}

export function newDocId(): string {
  return randomId(20);
}

export type ChangeEvent = { parent: string; path: string; data: Data };

// Tell listening browsers that a collection changed. `data` is the document as
// it was (or now is), so the event stream can check who is allowed to know.
export function announce(change: ChangeEvent) {
  events().emit("change", change);
}

// --- queries ---------------------------------------------------------------

export type Filter = [field: string, op: string, value: Json];
export type Order = [field: string, direction: "asc" | "desc"];

export type QuerySpec = {
  parent?: string;
  group?: string;
  where?: Filter[];
  orderBy?: Order[];
  limit?: number;
};

// Timestamps, numbers and strings each sort among themselves; mixed types fall
// back to a fixed type order so a stray value cannot make the sort unstable.
function rank(value: Json | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (isTimestamp(value)) return 3;
  if (typeof value === "string") return 4;
  return 5;
}

function compare(a: Json | undefined, b: Json | undefined): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (isTimestamp(a) && isTimestamp(b)) return a.__ts - b.__ts;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

function matches(data: Data, [name, op, value]: Filter): boolean {
  const actual = field(data, name);
  switch (op) {
    case "==":
      return deepEqual(actual, value);
    case "array-contains":
      return Array.isArray(actual) && actual.some((v) => deepEqual(v, value));
    case "<":
      return actual !== undefined && rank(actual) === rank(value) && compare(actual, value) < 0;
    default:
      return false;
  }
}

// Filters and orders, but does not paginate: the caller first drops documents
// the reader may not see, then applies the limit (see paginate), so
// a page is never short because of hidden rows.
export function runQuery(spec: QuerySpec): StoredDoc[] {
  let docs = spec.group ? listGroup(spec.group) : listCollection(spec.parent ?? "");
  for (const filter of spec.where ?? []) docs = docs.filter((d) => matches(d.data, filter));
  const order = spec.orderBy ?? [];
  // Like the original store, ordering by a field leaves out documents that
  // do not have it.
  for (const [name] of order) docs = docs.filter((d) => field(d.data, name) !== undefined);
  docs.sort((a, b) => {
    for (const [name, direction] of order) {
      const c = compare(field(a.data, name), field(b.data, name));
      if (c !== 0) return direction === "desc" ? -c : c;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return docs;
}

export function paginate(docs: StoredDoc[], spec: QuerySpec): StoredDoc[] {
  return typeof spec.limit === "number" && spec.limit >= 0 ? docs.slice(0, spec.limit) : docs;
}
