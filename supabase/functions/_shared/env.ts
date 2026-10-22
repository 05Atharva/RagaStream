// Secrets and settings shared by both functions. Read lazily so a missing
// secret fails the request (500), not the whole deploy.
import { MIN_SECRET_LENGTH } from "./sign.ts";

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

export function linkSecret(): string {
  const secret = requireEnv("APPROVAL_LINK_SECRET");
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("APPROVAL_LINK_SECRET is too short");
  return secret;
}

/** Base URL of the functions, no trailing slash. */
export function functionsUrl(): string {
  const custom = Deno.env.get("PUBLIC_FUNCTIONS_URL");
  return (custom || `${requireEnv("SUPABASE_URL")}/functions/v1`).replace(/\/+$/, "");
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
