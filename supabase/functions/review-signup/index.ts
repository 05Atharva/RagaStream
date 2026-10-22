// review-signup: the owner's Approve / Decline links land here.
// Deployed with --no-verify-jwt; the signed, expiring link is the credential.
//   GET  shows a confirmation page and changes nothing (mail scanners pre-fetch links).
//   POST verifies the link again and records the decision.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient } from "../_shared/db.ts";
import { linkSecret } from "../_shared/env.ts";
import { escapeHtml, renderPage } from "../_shared/html.ts";
import { sendMail } from "../_shared/mail.ts";
import { type Action, isAction, type LinkParams, verifyLink } from "../_shared/sign.ts";

// Supabase rewrites text/html to text/plain on GET responses unless the project
// has a custom domain. If the confirm page shows as raw markup, set the secret
// REVIEW_PAGE_CONTENT_TYPE=application/xhtml+xml (the markup is well-formed XML).
const PAGE_TYPE = Deno.env.get("REVIEW_PAGE_CONTENT_TYPE") || "text/html; charset=utf-8";

// Every page (error pages on GET included) uses PAGE_TYPE, so none of them shows as raw markup.
function html(body: string, status = 200, contentType = PAGE_TYPE): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

function problem(heading: string, message: string, status: number): Response {
  return html(
    renderPage({ title: heading, heading, bodyHtml: `<p>${escapeHtml(message)}</p>` }),
    status,
  );
}

const BAD_LINK = ["This link isn't valid", "It may have been copied incorrectly. Open the original email and use its buttons.", 400] as const;
const EXPIRED_LINK = [
  "This link has expired",
  "Review links last 7 days. Ask the person to sign up again, or change their status in the Supabase dashboard (table user_access).",
  410,
] as const;

function readParams(get: (k: string) => string | null): LinkParams {
  return { user: get("user"), action: get("action"), exp: get("exp"), sig: get("sig") };
}

async function check(p: LinkParams): Promise<Response | null> {
  const result = await verifyLink(linkSecret(), p, Math.floor(Date.now() / 1000));
  if (result === "ok") return null;
  const [h, m, s] = result === "expired" ? EXPIRED_LINK : BAD_LINK;
  return problem(h, m, s);
}

const STATUS_FOR: Record<Action, "approved" | "rejected"> = { approve: "approved", reject: "rejected" };

async function loadRow(user: string) {
  const { data, error } = await adminClient()
    .from("user_access")
    .select("email, status")
    .eq("user_id", user.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

function confirmPage(p: LinkParams, email: string, action: Action): Response {
  const approve = action === "approve";
  const fields = (["user", "action", "exp", "sig"] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(p[k])}" />`)
    .join("");
  const label = approve ? "Approve" : "Decline";
  return html(
    renderPage({
      title: `${label} ${email}`,
      heading: `${label} ${email}?`,
      bodyHtml: `<p>${
        approve
          ? "They'll get an email and can open RagaStream right away."
          : "They won't be able to use RagaStream. You can change this later."
      }</p>`,
      actionHtml: `<form method="post" action="">${fields}<button type="submit">${label}</button></form>`,
    }),
    200,
    PAGE_TYPE,
  );
}

async function emailApproved(to: string): Promise<void> {
  const text = "You're in. Open RagaStream and sign in again to start listening.";
  await sendMail({
    to,
    subject: "You're in",
    text,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 12px;background-color:#EDE8DF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#FBF9F5;border-radius:16px;">
<tr><td style="padding:32px 28px;font-family:Helvetica,Arial,sans-serif;color:#0B0F1A;">
<div style="font-size:14px;font-weight:700;color:#C75A00;">RagaStream</div>
<h1 style="margin:16px 0 8px 0;font-size:24px;line-height:1.25;color:#0B0F1A;">You're in</h1>
<p style="margin:0;font-size:16px;line-height:1.5;color:#2B3040;">Open RagaStream and sign in again to start listening.</p>
</td></tr></table></td></tr></table></body></html>`,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const p = readParams((k) => url.searchParams.get(k));
      const bad = await check(p);
      if (bad) return bad;
      const action = p.action as Action;
      const row = await loadRow(p.user!);
      if (!row) return problem("Account not found", "This sign-up no longer exists. Nothing to do.", 404);
      if (row.status === STATUS_FOR[action]) {
        return html(
          renderPage({
            title: "Already done",
            heading: `Already ${row.status}`,
            bodyHtml: `<p>${escapeHtml(row.email ?? "This account")} is already ${escapeHtml(row.status)}. Nothing more to do.</p>`,
          }),
          200,
          PAGE_TYPE,
        );
      }
      return confirmPage(p, row.email ?? "this account", action);
    }

    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 4096) return problem(...BAD_LINK);
      const form = new URLSearchParams(raw);
      const p = readParams((k) => form.get(k));
      const bad = await check(p);
      if (bad) return bad;
      if (!isAction(p.action)) return problem(...BAD_LINK);
      const action = p.action;
      const user = p.user!.toLowerCase();

      const row = await loadRow(user);
      if (!row) return problem("Account not found", "This sign-up no longer exists. Nothing to do.", 404);
      const target = STATUS_FOR[action];
      const email = row.email ?? "This account";

      if (row.status === target) {
        return html(renderPage({
          title: `Already ${target}`,
          heading: `Already ${target}`,
          bodyHtml: `<p>${escapeHtml(email)} was already ${target}. Nothing changed.</p>`,
        }));
      }

      const { error } = await adminClient()
        .from("user_access")
        .update({ status: target, decided_at: new Date().toISOString() })
        .eq("user_id", user);
      if (error) throw error;

      let note = "";
      if (action === "approve" && row.email) {
        try {
          await emailApproved(row.email);
          note = " We emailed them to sign in again.";
        } catch (err) {
          console.error("review-signup: welcome email failed", user, err instanceof Error ? err.name : "error");
          note = " We couldn't email them, so tell them to open the app and sign in again.";
        }
      }
      console.log("review-signup:", target, user);
      return html(renderPage({
        title: action === "approve" ? "Approved" : "Declined",
        heading: action === "approve" ? "Approved" : "Declined",
        bodyHtml: `<p>${escapeHtml(email)} is now ${target}.${escapeHtml(note)}</p>`,
      }));
    }

    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  } catch (err) {
    console.error("review-signup: failed", err instanceof Error ? err.name : "error");
    return problem("Something went wrong", "Nothing was changed. Try the link again in a minute.", 500);
  }
});
