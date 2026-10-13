// The one way the interface talks to its own server. Every request carries
// the session cookie plus a marker header, which the server requires so that
// no other website can make requests on a signed-in member's behalf.

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export const SIGNED_OUT_EVENT = "nopostnow:signed-out";

const HEADERS = { "x-nopostnow": "1" };

async function unwrap<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page (proxy timeout and the like).
  }
  if (!res.ok) {
    const info = (body ?? {}) as { error?: string; message?: string };
    const code = info.error ?? `http-${res.status}`;
    // The session ended somewhere else (signed out, password changed, expired).
    if (res.status === 401 && code === "unauthenticated" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw new ApiError(code, res.status, info.message);
  }
  return body as T;
}

export async function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return unwrap<T>(res);
}

export async function apiGet<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", headers: HEADERS, cache: "no-store" });
  return unwrap<T>(res);
}

export const API_HEADERS = HEADERS;
