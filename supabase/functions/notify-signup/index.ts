// notify-signup: emails the owner when someone signs up.
// Called by the database (private.handle_new_user via pg_net), deployed with
// --no-verify-jwt, so every request is untrusted: we only act for a user_id that
// is genuinely pending and not yet notified, and at most once.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// The owner approves in the app (Settings → Requests): Supabase's default domain
// can't render a confirmation page for an email link, so this email has no links.
import { adminClient } from "../_shared/db.ts";
import { json, requireEnv } from "../_shared/env.ts";
import { escapeHtml } from "../_shared/html.ts";
import { sendMail } from "../_shared/mail.ts";
import { isUuid } from "../_shared/sign.ts";

const KESAR = "#FF7A1A";
const INK = "#0B0F1A";

/** Enough to diagnose SMTP failures (code, SMTP response, message) without secrets:
 *  nodemailer never puts the password in its errors. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const e = err as Error & { code?: string; responseCode?: number; command?: string };
  return [e.name, e.code, e.responseCode, e.command, e.message?.slice(0, 240)].filter(Boolean).join(" | ");
}

function providerLabel(provider: string | null): string {
  if (provider === "google") return "Google";
  if (provider === "email") return "Email and password";
  return provider || "Unknown";
}

function buildMail(email: string, provider: string, when: string) {
  const e = escapeHtml(email);
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background-color:#EDE8DF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EDE8DF;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#FBF9F5;border-radius:16px;">
<tr><td style="padding:32px 28px 8px 28px;font-family:Helvetica,Arial,sans-serif;color:${INK};">
<div style="font-size:14px;font-weight:700;letter-spacing:0.02em;color:#C75A00;">RagaStream</div>
<h1 style="margin:16px 0 8px 0;font-size:24px;line-height:1.25;font-weight:700;color:${INK};">${e} wants to join RagaStream</h1>
<p style="margin:0 0 20px 0;font-size:16px;line-height:1.5;color:#2B3040;">Someone just signed up. Nothing happens until you say so.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#2B3040;">
<tr><td style="padding:0 16px 0 0;color:#5A6072;">Email</td><td style="color:${INK};">${e}</td></tr>
<tr><td style="padding:0 16px 0 0;color:#5A6072;">Signed up with</td><td style="color:${INK};">${escapeHtml(provider)}</td></tr>
<tr><td style="padding:0 16px 0 0;color:#5A6072;">When</td><td style="color:${INK};">${escapeHtml(when)}</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-left:4px solid ${KESAR};padding:4px 0 4px 14px;">
<div style="font-size:16px;font-weight:700;color:${INK};">Open RagaStream &rarr; Settings &rarr; Requests</div>
<div style="font-size:14px;line-height:1.5;color:#2B3040;">Approve or decline there. They'll see the app as soon as you approve.</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 28px 32px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5A6072;">If you don't know this person, decline. Nothing in this email can approve anyone.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${email} wants to join RagaStream`,
    "",
    `Email: ${email}`,
    `Signed up with: ${provider}`,
    `When: ${when}`,
    "",
    "Open RagaStream -> Settings -> Requests to approve or decline.",
    "Nothing in this email can approve anyone.",
  ].join("\n");

  return { subject: `${email} wants to join RagaStream`, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let userId: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 2048) return json({ error: "Body too large." }, 413);
    userId = JSON.parse(raw)?.user_id;
  } catch {
    return json({ error: "Send JSON like {\"user_id\": \"<uuid>\"}." }, 400);
  }
  if (!isUuid(userId)) return json({ error: "user_id must be a UUID." }, 400);
  const id = userId.toLowerCase();

  try {
    const db = adminClient();

    // Claim the send: only a pending, not-yet-notified row matches, and only one
    // caller can win. Replays and forged calls get sent: false.
    const { data: row, error } = await db
      .from("user_access")
      .update({ notified_at: new Date().toISOString() })
      .eq("user_id", id)
      .eq("status", "pending")
      .is("notified_at", null)
      .select("email, provider, requested_at")
      .maybeSingle();
    if (error) throw error;
    if (!row) return json({ sent: false, reason: "nothing to send" });

    try {
      const when = new Date(row.requested_at ?? Date.now()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
      const mail = buildMail(row.email ?? "(no email)", providerLabel(row.provider), when);
      await sendMail({ to: requireEnv("OWNER_EMAIL"), ...mail });
    } catch (err) {
      // Let a retry send it.
      await db.from("user_access").update({ notified_at: null }).eq("user_id", id);
      console.error("notify-signup: send failed", id, describeError(err));
      return json({ sent: false, error: "Could not send the email." }, 502);
    }
    return json({ sent: true });
  } catch (err) {
    console.error("notify-signup: failed", id, err instanceof Error ? err.name : "error");
    return json({ error: "Something went wrong." }, 500);
  }
});
