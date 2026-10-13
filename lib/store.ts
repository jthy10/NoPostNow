import { apiPost, ApiError } from "./api";

// Browser-side client for the document store served at /api/store.
//
// The interface reads and writes documents by path ("photos/abc",
// "photos/abc/comments/def") through a small set of functions: doc,
// collection, query, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc
// and onSnapshot. What a request may see or change is decided entirely by the
// server (server/rules.ts) — nothing here is a security boundary.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DocumentData = Record<string, any>;

export class Timestamp {
  readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }

  static fromMillis(ms: number) {
    return new Timestamp(ms);
  }

  static fromDate(date: Date) {
    return new Timestamp(date.getTime());
  }

  static now() {
    return new Timestamp(Date.now());
  }

  toMillis() {
    return this.ms;
  }

  toDate() {
    return new Date(this.ms);
  }

  get seconds() {
    return Math.floor(this.ms / 1000);
  }
}

// Marker passed wherever the store is addressed, so call sites read the same
// way for every collection.
export const db = { name: "store" } as const;
type Db = typeof db;

export type DocumentReference = {
  kind: "doc";
  path: string;
  id: string;
  // The collection this document sits in.
  parent: CollectionReference;
};
export type CollectionReference = {
  kind: "collection";
  path: string;
  id: string;
  // The document this collection is nested under, if any.
  parent: DocumentReference | null;
};

function lastSegment(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function docRef(path: string): DocumentReference {
  return {
    kind: "doc",
    path,
    id: lastSegment(path),
    get parent() {
      return collectionRef(path.slice(0, path.lastIndexOf("/")));
    },
  };
}

function collectionRef(path: string): CollectionReference {
  return {
    kind: "collection",
    path,
    id: lastSegment(path),
    get parent() {
      return path.includes("/") ? docRef(path.slice(0, path.lastIndexOf("/"))) : null;
    },
  };
}

type Constraint =
  | { kind: "where"; field: string; op: string; value: unknown }
  | { kind: "orderBy"; field: string; direction: "asc" | "desc" }
  | { kind: "limit"; count: number }
  | { kind: "startAfter"; path: string };

export type Query = {
  kind: "query";
  parent?: string;
  group?: string;
  constraints: Constraint[];
};

type Queryable = CollectionReference | Query;

export function doc(_db: Db, ...segments: string[]): DocumentReference {
  return docRef(segments.join("/"));
}

export function collection(_db: Db, ...segments: string[]): CollectionReference {
  return collectionRef(segments.join("/"));
}

// Every collection with this name, wherever it is nested.
export function collectionGroup(_db: Db, name: string): Query {
  return { kind: "query", group: name, constraints: [] };
}

export function query(base: Queryable, ...constraints: Constraint[]): Query {
  if (base.kind === "collection") return { kind: "query", parent: base.path, constraints };
  return { ...base, constraints: [...base.constraints, ...constraints] };
}

export function where(field: string, op: "==" | "!=" | "array-contains" | "in" | "<" | "<=" | ">" | ">=", value: unknown): Constraint {
  return { kind: "where", field, op, value };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc"): Constraint {
  return { kind: "orderBy", field, direction };
}

export function limit(count: number): Constraint {
  return { kind: "limit", count };
}

export function startAfter(snapshot: { ref: DocumentReference }): Constraint {
  return { kind: "startAfter", path: snapshot.ref.path };
}

// --- values that only the server can fill in --------------------------------

type Sentinel = { __op: string; values?: unknown[] };

export function serverTimestamp(): any {
  return { __op: "serverTimestamp" } satisfies Sentinel;
}

export function arrayUnion(...values: unknown[]): any {
  return { __op: "arrayUnion", values } satisfies Sentinel;
}

export function arrayRemove(...values: unknown[]): any {
  return { __op: "arrayRemove", values } satisfies Sentinel;
}

function encode(value: unknown): unknown {
  if (value instanceof Timestamp) return { __ts: value.ms };
  if (value instanceof Date) return { __ts: value.getTime() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = encode(v);
    }
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const ts = (value as { __ts?: unknown }).__ts;
    if (keys.length === 1 && typeof ts === "number") return new Timestamp(ts);
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = decode((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

// --- snapshots --------------------------------------------------------------

const METADATA = { hasPendingWrites: false, fromCache: false } as const;

export class DocumentSnapshot {
  readonly ref: DocumentReference;
  readonly id: string;
  readonly metadata = METADATA;
  private readonly value: DocumentData | null;

  constructor(ref: DocumentReference, value: DocumentData | null) {
    this.ref = ref;
    this.id = ref.id;
    this.value = value;
  }

  exists(): boolean {
    return this.value !== null;
  }

  data(): DocumentData {
    return this.value as DocumentData;
  }
}

// A document that came back from a query, so it certainly exists.
export type QueryDocumentSnapshot<T = DocumentData> = DocumentSnapshot & { data(): T };

export class QuerySnapshot {
  readonly docs: QueryDocumentSnapshot[];
  readonly metadata = METADATA;

  constructor(docs: QueryDocumentSnapshot[]) {
    this.docs = docs;
  }

  get size() {
    return this.docs.length;
  }

  get empty() {
    return this.docs.length === 0;
  }

  forEach(fn: (doc: QueryDocumentSnapshot) => void) {
    this.docs.forEach(fn);
  }
}

type Wire = { path: string; data: Record<string, unknown> };

function toSnapshot(wire: Wire): QueryDocumentSnapshot {
  return new DocumentSnapshot(docRef(wire.path), decode(wire.data) as DocumentData);
}

function toSpec(q: Queryable) {
  const base: Query = q.kind === "collection" ? { kind: "query", parent: q.path, constraints: [] } : q;
  const spec: Record<string, unknown> = base.group ? { group: base.group } : { parent: base.parent };
  const filters: unknown[] = [];
  const order: unknown[] = [];
  for (const c of base.constraints) {
    if (c.kind === "where") filters.push([c.field, c.op, encode(c.value)]);
    else if (c.kind === "orderBy") order.push([c.field, c.direction]);
    else if (c.kind === "limit") spec.limit = c.count;
    else spec.startAfter = c.path;
  }
  if (filters.length) spec.where = filters;
  if (order.length) spec.orderBy = order;
  return spec;
}

// --- reads ------------------------------------------------------------------

const STORE = "/api/store";

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const res = await apiPost<{ doc: Wire | null }>(STORE, { op: "get", path: ref.path });
  return new DocumentSnapshot(ref, res.doc ? (decode(res.doc.data) as DocumentData) : null);
}

export async function getDocs(q: Queryable): Promise<QuerySnapshot> {
  const res = await apiPost<{ docs: Wire[] }>(STORE, { op: "query", spec: toSpec(q) });
  return new QuerySnapshot(res.docs.map(toSnapshot));
}

export async function getCountFromServer(q: Queryable) {
  const res = await apiPost<{ count: number }>(STORE, { op: "count", spec: toSpec(q) });
  return { data: () => ({ count: res.count }) };
}

// --- writes -----------------------------------------------------------------

function parentOf(path: string) {
  return path.slice(0, path.lastIndexOf("/"));
}

export async function setDoc(
  ref: DocumentReference,
  data: DocumentData,
  options?: { merge?: boolean }
): Promise<void> {
  await apiPost(STORE, { op: options?.merge ? "merge" : "set", path: ref.path, data: encode(data) });
  notifyLocal(parentOf(ref.path));
}

// Keys may be dotted paths ("seenAt.abc") to set one entry of a nested map.
export async function updateDoc(ref: DocumentReference, data: DocumentData): Promise<void> {
  await apiPost(STORE, { op: "update", path: ref.path, data: encode(data) });
  notifyLocal(parentOf(ref.path));
}

export async function addDoc(
  parent: CollectionReference,
  data: DocumentData
): Promise<DocumentReference> {
  const res = await apiPost<{ path: string }>(STORE, {
    op: "add",
    parent: parent.path,
    data: encode(data),
  });
  notifyLocal(parent.path);
  return docRef(res.path);
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await apiPost(STORE, { op: "delete", path: ref.path });
  notifyLocal(parentOf(ref.path));
}

// --- live listeners -----------------------------------------------------------

// One event stream per tab tells us which collections changed; each listener
// watching that collection re-reads. A stream that drops reconnects on its
// own, and every listener refreshes when it does, so nothing is missed while
// offline or asleep.

type Listener = { parent?: string; group?: string; refresh: () => void };

const listeners = new Set<Listener>();
let stream: EventSource | null = null;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

function affected(listener: Listener, parent: string) {
  if (listener.group) return parent.slice(parent.lastIndexOf("/") + 1) === listener.group;
  return listener.parent === parent;
}

function notifyLocal(parent: string) {
  for (const listener of listeners) if (affected(listener, parent)) listener.refresh();
}

function refreshAll() {
  for (const listener of listeners) listener.refresh();
}

function onVisible() {
  if (document.visibilityState === "visible") refreshAll();
}

function openStream() {
  if (stream || typeof window === "undefined" || typeof EventSource === "undefined") return;
  let opened = false;
  stream = new EventSource("/api/store/events");
  stream.onmessage = (event) => notifyLocal(String(event.data));
  stream.onopen = () => {
    // A reconnect may have skipped changes.
    if (opened) refreshAll();
    opened = true;
  };
  document.addEventListener("visibilitychange", onVisible);
  // Belt and braces for networks that buffer event streams.
  fallbackTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshAll();
  }, 60_000);
}

function closeStream() {
  stream?.close();
  stream = null;
  if (fallbackTimer) clearInterval(fallbackTimer);
  fallbackTimer = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
}

export function onSnapshot(
  target: DocumentReference,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: Error) => void
): () => void;
export function onSnapshot(
  target: Queryable,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: Error) => void
): () => void;
export function onSnapshot(
  target: DocumentReference | Queryable,
  onNext: (snapshot: any) => void,
  onError?: (error: Error) => void
): () => void {
  let active = true;
  let running = false;
  let again = false;
  let delivered = false;

  const run = async () => {
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const snapshot = target.kind === "doc" ? await getDoc(target) : await getDocs(target);
      if (active) {
        delivered = true;
        onNext(snapshot);
      }
    } catch (err) {
      // Only the first read reports failure; a later blip keeps the last
      // good data on screen and the next change (or reconnect) retries.
      if (active && !delivered) onError?.(err as Error);
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  };

  const listener: Listener =
    target.kind === "doc"
      ? { parent: parentOf(target.path), refresh: run }
      : target.kind === "collection"
        ? { parent: target.path, refresh: run }
        : { parent: target.parent, group: target.group, refresh: run };

  listeners.add(listener);
  openStream();
  void run();

  return () => {
    active = false;
    listeners.delete(listener);
    if (listeners.size === 0) closeStream();
  };
}

export function isPermissionDenied(err: unknown): boolean {
  return err instanceof ApiError && err.code === "permission-denied";
}
