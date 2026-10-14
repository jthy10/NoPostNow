import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  Timestamp,
  getCountFromServer,
  QueryDocumentSnapshot,
  DocumentData,
} from "./store";
import { uploadFile, safeFileName } from "./files";
import { invalidateFeedCache } from "./feed-cache";
import { isSpecialDate, readsDailyMoment } from "./site";

// Compressed feed copies live under photos/display/**. Originals are never modified —
// the download button and full-quality use cases always read imagePath.
export function displayVariantPath(imagePath: string) {
  return imagePath.replace(/^photos\//, "photos/display/");
}

const DISPLAY_MAX_WIDTH = 1600;
const DISPLAY_JPEG_QUALITY = 0.85;

export type Post = {
  id: string;
  userUUID: string;
  username: string;
  imagePath: string;
  caption: string;
  timestamp: { toDate: () => Date } | null;
  likedBy: string[];
  imageWidth?: number;
  imageHeight?: number;
  // Soft delete: flagged posts stay on the server (admin can recover them)
  // but never render anywhere in the app.
  deleted?: boolean;
  // When the poster opened the camera (client clock). The daily-moment badge
  // judges this instant, not the upload's server timestamp, so a slow upload
  // can't cost anyone the minute.
  capturedAt?: { toDate: () => Date } | null;
};

export function postDate(post: Pick<Post, "timestamp">): Date | null {
  return post.timestamp ? post.timestamp.toDate() : null;
}

// The badges judge when the shot was taken (capturedAt — the camera opening),
// not when the upload finished, so a bad connection at the daily moment
// doesn't cost the glow. Bounded both ways: a stamp more than 10 minutes
// before the upload is ignored (nobody banks a camera-open and posts an hour
// later), and one more than 10 minutes *after* the upload is a broken device
// clock — honoring it would caption posts with times that haven't happened yet.
const CAPTURE_GRACE_MS = 10 * 60 * 1000;

type BadgeFields = Pick<Post, "timestamp" | "capturedAt">;

// The one instant a card is both judged and captioned by, so the badge and
// the caption can never disagree. Capture time when a trustworthy stamp
// exists — except when the upload itself landed on the daily moment and the
// capture didn't (opened the camera a minute early, hit upload on the minute:
// the upload is the moment that earned it, so it's the moment shown).
export function badgeDate(post: BadgeFields): Date | null {
  const d = postDate(post);
  if (!d) return null;
  const c = post.capturedAt?.toDate?.();
  if (!c || Math.abs(d.getTime() - c.getTime()) > CAPTURE_GRACE_MS) return d;
  return readsDailyMoment(d) && !readsDailyMoment(c) ? d : c;
}

// Was this posted right on the site's daily moment? Those posts get a glow.
// Which minute counts is the host's choice and is read off the site's own
// clock, so the halo doesn't move around with each viewer's time zone.
export function isMomentPost(post: BadgeFields): boolean {
  const d = badgeDate(post);
  return !!d && readsDailyMoment(d);
}

// Every photo posted on the host's special date gets the anniversary
// treatment, whatever time it landed.
export function isSpecialDayPost(post: BadgeFields): boolean {
  const d = badgeDate(post);
  return !!d && isSpecialDate(d);
}

// Stamped by the camera button the instant the picker opens; consumed by the
// next createPost. Cleared after each post so a stale timer from an abandoned
// camera session can't leak onto a later, unrelated post.
let cameraOpenedAtMs: number | null = null;

export function markCameraOpened() {
  cameraOpenedAtMs = Date.now();
}

export type Comment = {
  id: string;
  userUUID: string;
  username: string;
  text: string;
  timestamp: { toDate: () => Date } | null;
  // uids who liked this comment (mirrors a post's likedBy). Absent on comments
  // written before likes existed — treat missing as [].
  likedBy?: string[];
};

const PAGE_SIZE = 6;

// Downscale to feed resolution on-device. Returns null when re-encoding
// wouldn't help (tiny image) or the browser can't do it — callers treat
// null as "just use the original".
async function renderDisplayVariant(bmp: ImageBitmap): Promise<Blob | null> {
  try {
    const scale = Math.min(1, DISPLAY_MAX_WIDTH / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", DISPLAY_JPEG_QUALITY)
    );
  } catch {
    return null;
  }
}

export async function fetchPosts(
  cursor?: QueryDocumentSnapshot<DocumentData>
): Promise<{ posts: Post[]; nextCursor?: QueryDocumentSnapshot<DocumentData> }> {
  const base = query(
    collection(db, "photos"),
    orderBy("timestamp", "desc"),
    // By value rather than by position, so the next page still loads when the
    // post the cursor points at has since been deleted.
    ...(cursor ? [where("timestamp", "<", cursor.data().timestamp)] : []),
    limit(PAGE_SIZE)
  );
  const snap = await getDocs(base);
  // Soft-deleted posts are filtered here (not in the query) so no composite
  // index is needed; a short page just means the feed fetches the next one.
  const posts = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Post))
    .filter((p) => p.deleted !== true);
  return {
    posts,
    nextCursor: snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1] : undefined,
  };
}

export async function createPost(opts: {
  file: File;
  caption: string;
  uid: string;
  username: string;
  onProgress?: (fraction: number) => void;
}) {
  // Dimensions let the feed reserve the exact space before the image loads.
  // createImageBitmap applies EXIF orientation, so width/height match display.
  // The same bitmap renders the compressed display variant the feed serves;
  // the untouched original is what gets stored at imagePath.
  let dims: { width: number; height: number } | null = null;
  let display: Blob | null = null;
  try {
    const bmp = await createImageBitmap(opts.file);
    dims = { width: bmp.width, height: bmp.height };
    display = await renderDisplayVariant(bmp);
    bmp.close();
  } catch {
    // Non-decodable in this browser (e.g. HEIC on desktop) — post without dims.
  }

  const imagePath = `photos/${opts.uid}/${safeFileName(opts.file.name)}`;
  await uploadFile(imagePath, opts.file, opts.onProgress);

  // Variant failure must never block a post — the feed falls back to the
  // original whenever the display copy is missing.
  if (display && display.size < opts.file.size) {
    try {
      await uploadFile(displayVariantPath(imagePath), display);
    } catch {
      /* fall back to original in the feed */
    }
  }

  // The capture stamp rides along only when it's sane — the server rejects
  // wildly-off values, and a rejected stamp must never fail the whole post.
  const capturedMs = cameraOpenedAtMs;
  cameraOpenedAtMs = null;

  const docRef = await addDoc(collection(db, "photos"), {
    userUUID: opts.uid,
    username: opts.username,
    imagePath,
    caption: opts.caption,
    timestamp: serverTimestamp(),
    likedBy: [],
    ...(dims ? { imageWidth: dims.width, imageHeight: dims.height } : {}),
    ...(capturedMs && Date.now() - capturedMs < 60 * 60 * 1000
      ? { capturedAt: Timestamp.fromMillis(capturedMs) }
      : {}),
  });

  // Stamp "last active" on the poster's own profile. The @mention picker
  // ranks by it. Best-effort — a failure only affects picker order.
  void updateDoc(doc(db, "users", opts.uid), { lastPostAt: serverTimestamp() }).catch(() => {});

  invalidateFeedCache();
  // Callers pass this to the notification fan-out so pushes and the bell
  // feed can deep-link to /p/{id}.
  return docRef.id;
}

export const MAX_CAPTION_LENGTH = 70;

// Owner-only caption edit (rules verify ownership and the length cap).
export async function updateCaption(postId: string, caption: string) {
  await updateDoc(doc(db, "photos", postId), {
    caption: caption.trim().slice(0, MAX_CAPTION_LENGTH),
  });
  invalidateFeedCache();
}

export async function toggleLike(postId: string, uid: string, currentlyLiked: boolean) {
  await updateDoc(doc(db, "photos", postId), {
    likedBy: currentlyLiked ? arrayRemove(uid) : arrayUnion(uid),
  });
}

export async function deletePost(postId: string) {
  await deleteDoc(doc(db, "photos", postId));
  invalidateCommentPreview(postId);
  // Deleting from a profile or permalink must not leave the ghost in the
  // cached feed.
  invalidateFeedCache();
}

// Roughly how tall a PhotoCard will render at a given content width, used to
// reserve space for cards that haven't been on screen yet (see useVirtualList).
// The image is the whole story and posts store its dimensions, so this is
// close to exact; the card's real height replaces it once it mounts.
const CARD_CHROME = 104; // header row + action row + padding
const CARD_CAPTION_LINE = 22;

export function estimateCardHeight(post: Post, width: number, viewportHeight = 800): number {
  const w = Math.max(1, width) - 20; // article px-2.5
  const ratio =
    post.imageWidth && post.imageHeight ? post.imageHeight / post.imageWidth : 1; // square placeholder
  const image = Math.min(w * ratio, viewportHeight * 0.8); // max-h-[80vh]
  // Captions cap at 70 chars, so one line on phones and rarely two.
  const captionLines = post.caption?.trim() ? Math.ceil(post.caption.length / 38) : 0;
  return Math.round(image + CARD_CHROME + captionLines * CARD_CAPTION_LINE);
}

export type CommentPreview = { count: number; latest: Comment[] };

// Every mounted card asks for its own preview, and cards remount constantly —
// navigating back to the feed, re-windowing on /browse, a comments bump. Each
// miss is a count query plus a two-doc read, so hold the result for the
// session and drop it the moment that post's comments actually change.
const previews = new Map<string, Promise<CommentPreview>>();

export function invalidateCommentPreview(postId: string) {
  previews.delete(postId);
}

// Hard refresh (FEED tap / pull-to-refresh): every card refetches its
// preview, same as a fresh PWA launch.
export function invalidateAllCommentPreviews() {
  previews.clear();
}

// Count + the two most recent comments, shown under each feed card.
export function fetchCommentPreview(postId: string): Promise<CommentPreview> {
  const cached = previews.get(postId);
  if (cached) return cached;

  const col = collection(db, "photos", postId, "comments");
  const pending = Promise.all([
    getCountFromServer(col),
    getDocs(query(col, orderBy("timestamp", "desc"), limit(2))),
  ]).then(([countSnap, latestSnap]) => ({
    count: countSnap.data().count,
    latest: latestSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Comment)).reverse(),
  }));
  // A failed fetch must not be remembered as the answer.
  pending.catch(() => previews.delete(postId));
  previews.set(postId, pending);
  return pending;
}

// Who currently likes a post — read fresh from the doc (not the possibly-stale
// snapshot the sheet was opened with) so the Likes tab reflects likes added
// after opening. Returns the uids; the caller resolves names/avatars.
export async function fetchPostLikers(postId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "photos", postId));
  const likedBy = snap.exists() ? snap.data().likedBy : null;
  return Array.isArray(likedBy)
    ? likedBy.filter((u): u is string => typeof u === "string")
    : [];
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const q = query(
    collection(db, "photos", postId, "comments"),
    orderBy("timestamp", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Comment));
}

export async function addComment(postId: string, uid: string, username: string, text: string) {
  await addDoc(collection(db, "photos", postId, "comments"), {
    userUUID: uid,
    username,
    text,
    timestamp: serverTimestamp(),
    likedBy: [],
  });
  invalidateCommentPreview(postId);
}

// Toggle the caller's like on a comment. Same self-only arrayUnion/arrayRemove
// shape as toggleLike on a post, so the server can verify only the caller's
// own uid entered or left likedBy.
export async function toggleCommentLike(
  postId: string,
  commentId: string,
  uid: string,
  currentlyLiked: boolean
) {
  await updateDoc(doc(db, "photos", postId, "comments", commentId), {
    likedBy: currentlyLiked ? arrayRemove(uid) : arrayUnion(uid),
  });
}

export async function deleteComment(postId: string, commentId: string) {
  await deleteDoc(doc(db, "photos", postId, "comments", commentId));
  invalidateCommentPreview(postId);
}
