import { API_HEADERS, ApiError } from "./api";

// Photos and avatars live on the host's disk and are served only to signed-in
// members, through /api/files/{path}.

export function fileUrl(path: string): string {
  return `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// A name that is safe on every filesystem: time-ordered, unguessable, and
// carrying only the original extension.
export function safeFileName(original: string): string {
  const ext = (original.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "jpg").toLowerCase();
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return `${Date.now()}-${random}.${ext}`;
}

// XMLHttpRequest rather than fetch, because it reports upload progress.
export function uploadFile(
  path: string,
  blob: Blob,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", fileUrl(path));
    for (const [name, value] of Object.entries(API_HEADERS)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let code = `http-${xhr.status}`;
      try {
        code = JSON.parse(xhr.responseText).error ?? code;
      } catch {}
      reject(new ApiError(code, xhr.status, code));
    };
    xhr.onerror = () => reject(new ApiError("network", 0, "Upload failed — check your connection."));
    xhr.send(blob);
  });
}

export async function downloadFile(path: string): Promise<Blob> {
  const res = await fetch(fileUrl(path), { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(`http-${res.status}`, res.status);
  return res.blob();
}
