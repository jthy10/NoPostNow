import crypto from "node:crypto";

// Time-based one-time passwords (RFC 6238): SHA-1, six digits, 30-second
// steps — the defaults every authenticator app expects.

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decodeBase32(secret: string): Buffer {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

// Accepts the neighbouring steps too, so a phone clock that is a few seconds
// off still works.
export function verifyTotp(secret: string, code: string, now: number = Date.now()): boolean {
  const cleaned = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const step = Math.floor(now / 30_000);
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(codeAt(secret, step + drift));
    if (crypto.timingSafeEqual(expected, Buffer.from(cleaned))) ok = true;
  }
  return ok;
}

export function totpUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}

export function currentTotp(secret: string, now: number = Date.now()): string {
  return codeAt(secret, Math.floor(now / 30_000));
}
