# Edge Functions: owner approves every new account

```
sign-up -> trigger (access_schema.sql) -> notify-signup -> email to the owner
owner taps Approve/Decline -> review-signup (GET: confirm page, POST: decides) -> email "You're in"
```

| Function | Called by | Does |
|---|---|---|
| `notify-signup` | the database (pg_net), POST `{user_id}` | Emails the owner once per pending user, with signed Approve / Decline links |
| `review-signup` | the links in that email | GET shows a confirm page and changes nothing; the button POSTs and records the decision |

Both are deployed **without JWT verification** (the database and an email link can't send one), so they treat every request as untrusted: `notify-signup` only acts on a pending, not-yet-notified user and claims the send atomically; `review-signup` needs an HMAC-signed link that expires after 7 days.

Shared code is in `_shared/` (`sign.ts` HMAC links, `html.ts` escaping and page shell, `mail.ts` Gmail SMTP, `db.ts`, `env.ts`).

## Secrets

Set once (the Supabase dashboard under Edge Functions -> Secrets, or the CLI). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

```bash
supabase secrets set \
  GMAIL_USER=you@gmail.com \
  GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" \
  OWNER_EMAIL=atharvakanwade@gmail.com \
  APPROVAL_LINK_SECRET="$(openssl rand -hex 32)"
```

| Secret | Notes |
|---|---|
| `GMAIL_USER` | Gmail address that sends the mail |
| `GMAIL_APP_PASSWORD` | A Google app password (needs 2-step verification), not the account password |
| `OWNER_EMAIL` | Where the "wants to join" email goes |
| `APPROVAL_LINK_SECRET` | Long random string, at least 16 characters. Changing it invalidates links already sent |
| `PUBLIC_FUNCTIONS_URL` | Optional. Defaults to `${SUPABASE_URL}/functions/v1`. Set it to your custom-domain URL if you have one |
| `REVIEW_PAGE_CONTENT_TYPE` | Optional. See the HTML caveat below |

SMTP uses smtp.gmail.com on port 465 (implicit TLS). Supabase blocks outbound ports 25 and 587.

## Deploy

```bash
supabase functions deploy notify-signup --no-verify-jwt --project-ref jprsscsopqnwiihkgued
supabase functions deploy review-signup --no-verify-jwt --project-ref jprsscsopqnwiihkgued
```

Run `backend/access_schema.sql` too. Deploy the functions first, so the first sign-up after the trigger exists can send mail.

## Caveat: HTML on the default domain

Supabase rewrites `text/html` to `text/plain` on **GET** responses unless the project has a custom domain. The confirm page is a GET response, so on `*.supabase.co` it may show as raw markup. POST result pages are not affected. Options:

1. Use a Supabase custom domain and set `PUBLIC_FUNCTIONS_URL` to it.
2. Try `supabase secrets set REVIEW_PAGE_CONTENT_TYPE=application/xhtml+xml` (the markup is well-formed XML). Not tested against the live gateway.

## Test

No automated tests run here (Deno isn't installed on the dev machine). The pure functions in `_shared/sign.ts` and `_shared/html.ts` use only Web Crypto and have been checked under Node.

Live check:

1. Sign up a throwaway account in the app. Expect the owner email within seconds.
2. Open the Approve link: confirm page, press the button, result page. `select status from public.user_access` shows `approved`.
3. Open the same link again: "Already approved". Edit one character of `sig`: "This link isn't valid".
4. Call `notify-signup` again for the same user: `{"sent": false}` (no second email):
   `curl -X POST "$SUPABASE_URL/functions/v1/notify-signup" -H "Content-Type: application/json" -d '{"user_id":"<uuid>"}'`
5. Logs: Dashboard -> Edge Functions -> Logs. Only user ids are logged.

To re-test the email, reset the row: `update public.user_access set status='pending', notified_at=null where user_id='<uuid>';` then call `notify-signup`.
