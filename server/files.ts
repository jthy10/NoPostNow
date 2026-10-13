import fs from "node:fs";
import path from "node:path";
import { filesDir } from "./runtime.ts";

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

export function displayVariantPath(imagePath: string): string {
  return imagePath.replace(/^photos\//, "photos/display/");
}
