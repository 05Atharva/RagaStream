// Signed approval links: HMAC-SHA256(secret, `${user}:${action}:${exp}`), hex.
// Pure functions on Web Crypto only (no Deno APIs), so they also run under Node.

export type Action = "approve" | "reject";

export const ACTIONS: readonly Action[] = ["approve", "reject"];
export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MIN_SECRET_LENGTH = 16;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXP_RE = /^\d{1,12}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isAction(value: unknown): value is Action {
  return value === "approve" || value === "reject";
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

/** Compares two strings without stopping at the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function signLink(secret: string, user: string, action: Action, exp: number): Promise<string> {
  return hmacHex(secret, `${user}:${action}:${exp}`);
}

export type LinkCheck = "ok" | "malformed" | "bad_signature" | "expired";

export interface LinkParams {
  user: string | null;
  action: string | null;
  exp: string | null;
  sig: string | null;
}

/** Checks shape, then signature, then expiry. `now` is unix seconds. */
export async function verifyLink(secret: string, p: LinkParams, now: number): Promise<LinkCheck> {
  if (!isUuid(p.user) || !isAction(p.action) || !p.exp || !EXP_RE.test(p.exp) || !p.sig || !SIG_RE.test(p.sig)) {
    return "malformed";
  }
  const expected = await signLink(secret, p.user.toLowerCase(), p.action, Number(p.exp));
  if (!timingSafeEqual(expected, p.sig.toLowerCase())) return "bad_signature";
  if (Number(p.exp) < now) return "expired";
  return "ok";
}
