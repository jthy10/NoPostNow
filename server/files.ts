import fs from "node:fs";
import path from "node:path";
import { dataDir, filesDir } from "./runtime.ts";
import { getDoc, type Data } from "./store.ts";

// Photos and avatars are ordinary files inside the data folder, laid out the
// same way they are addressed: files/photos/{uid}/{name}. Nothing is served
// straight from disk — every read goes through the API, which checks the
// session first.

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const OWNER = /^[A-Za-z0-9]{1,64}$/;

export type FileTarget = { kind: "photo" | "display" | "avatar"; owner: string; abs: string };

// Only three shapes of path exist. Anything else — including traversal
// attempts — resolves to null.
export function resolveFile(segments: string[]): FileTarget | null {
  let kind: FileTarget["kind"];
  let owner: string;
  let name: string;
  if (segments.length === 3 && segments[0] === "photos") {
    [, owner, name] = segments;
    kind = "photo";
  } else if (segments.length === 4 && segments[0] === "photos" && segments[1] === "display") {
    [, , owner, name] = segments;
    kind = "display";
  } else if (segments.length === 3 && segments[0] === "avatars") {
    [, owner, name] = segments;
    kind = "avatar";
  } else {
    return null;
  }
  if (!OWNER.test(owner) || !NAME.test(name) || name.endsWith(".")) return null;
  if (kind === "photo" && owner === "display") return null;
  const root = filesDir();
  const abs = path.join(root, ...segments);
  if (!abs.startsWith(root + path.sep)) return null;
  return { kind, owner, abs };
}

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// The type is read from the file's own leading bytes, never from what the
// uploader claims, so a script or web page can't be stored as a "photo".
export function sniffImage(head: Uint8Array): string | null {
  const b = head;
  const ascii = (start: number, text: string) =>
    [...text].every((c, i) => b[start + i] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, "PNG")) return "image/png";
  if (ascii(0, "GIF8")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export function fileExists(storagePath: string): boolean {
  const target = resolveFile(storagePath.split("/"));
  return !!target && fs.existsSync(target.abs);
}

export function removeFile(storagePath: string) {
  const target = resolveFile(storagePath.split("/"));
  if (target) fs.rmSync(target.abs, { force: true });
}

// What happens to a photo or avatar someone deletes is the admin's call
// (config/deletion, set from the admin console). By default it is erased.
// With keepFiles on, it moves to a "deleted" folder in the data folder
// instead, laid out like files/, where only the host can reach it.
export function keepDeletedFiles(): boolean {
  return getDoc("config/deletion")?.data.keepFiles === true;
}

// Built by hand rather than with path.join: the bundler reads a join with a
// literal folder name as a file it must trace, and then traces everything.
export function deletedDir(): string {
  return `${dataDir()}${path.sep}deleted`;
}

function moveToDeleted(abs: string) {
  const rel = path.relative(filesDir(), abs);
  const dest = `${deletedDir()}${path.sep}${rel}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Copied exclusively, so a second deletion of the same name never
  // overwrites the first; that one gets the time added to its name.
  try {
    fs.copyFileSync(abs, dest, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    fs.copyFileSync(abs, `${dest}.${Date.now()}`, fs.constants.COPYFILE_EXCL);
  }
  fs.rmSync(abs, { force: true });
}

// Erase or set aside one file, following the admin's choice.
export function disposeFile(storagePath: string) {
  const target = resolveFile(storagePath.split("/"));
  if (!target || !fs.existsSync(target.abs)) return;
  if (keepDeletedFiles()) moveToDeleted(target.abs);
  else fs.rmSync(target.abs, { force: true });
}

// A deleted post's photo and its display copy. When they are kept, a small
// note beside them says whose post it was, so the folder makes sense to the
// host without the database.
export function disposePostFiles(post: Data) {
  if (typeof post.imagePath !== "string") return;
  if (keepDeletedFiles() && resolveFile(post.imagePath.split("/"))) {
    const at = (v: unknown) =>
      v && typeof v === "object" && typeof (v as { __ts?: unknown }).__ts === "number"
        ? new Date((v as { __ts: number }).__ts).toISOString()
        : null;
    const note = `${deletedDir()}${path.sep}${post.imagePath.split("/").join(path.sep)}.json`;
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(
      note,
      JSON.stringify(
        {
          uid: post.userUUID ?? null,
          username: post.username ?? null,
          caption: post.caption ?? "",
          postedAt: at(post.timestamp),
          deletedAt: new Date().toISOString(),
        },
        null,
        2
      ) + "\n"
    );
  }
  disposeFile(post.imagePath);
  disposeFile(displayVariantPath(post.imagePath));
}

// Everything in one member's folder under files/ (photos/{uid},
// photos/display/{uid} or avatars/{uid}).
export function disposeFolder(folder: string) {
  const root = path.join(filesDir(), ...folder.split("/"));
  if (!fs.existsSync(root)) return;
  if (keepDeletedFiles()) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) moveToDeleted(path.join(entry.parentPath, entry.name));
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

export function displayVariantPath(imagePath: string): string {
  return imagePath.replace(/^photos\//, "photos/display/");
}
