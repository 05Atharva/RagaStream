# Sign-in and account approval: one-time setup

What this sets up:
- **Google sign-in** opens Google in an in-app browser and comes back signed in. It works in Expo Go and in native builds.
- **Email sign-up** confirms the address before the account can sign in.
- **Owner approval**: every new account waits on "You're on the list". The owner gets an email at `atharvakanawade@gmail.com` and approves in the app under **Settings → Requests**. The email has no approve link: Supabase's default domain can't show a web page for one, and a link a mail scanner can open shouldn't be able to let anyone in.

Project: `jprsscsopqnwiihkgued` · Supabase callback: `https://jprsscsopqnwiihkgued.supabase.co/auth/v1/callback`

## 1. Google Cloud (about 10 minutes)

1. Open https://console.cloud.google.com/ and create or choose a project called **RagaStream**.
2. Go to **Google Auth Platform** and open the sections below:
   - **Branding**: app name *RagaStream*, support email `atharvakanawade@gmail.com`, developer contact the same.
   - **Audience**: choose **External**.
     - While it says *Testing*, only the Google accounts you add under **Test users** can sign in. That's fine for a few friends.
     - When you want anyone to request access, press **Publish app**. The basic scopes (email, profile) don't need Google's review.
   - **Data Access**: add the scope `openid`. Email and profile are there by default.
3. **Clients → Create client**:
   - Application type: **Web application**, name *RagaStream Supabase*.
   - **Authorized redirect URIs**: `https://jprsscsopqnwiihkgued.supabase.co/auth/v1/callback`
   - Create it, then copy the **Client ID** and **Client secret**.

## 2. Supabase dashboard

Open https://supabase.com/dashboard/project/jprsscsopqnwiihkgued.

1. **Authentication → Sign In / Providers → Google**: enable it, paste the Client ID and Client secret, and save.
2. **Authentication → Sign In / Providers → Email**:
   - **Confirm email**: on.
   - **Allow new users to sign up**: leave this on. Approval is what keeps strangers out; sign-up is how people ask to join.
3. **Authentication → URL Configuration**:
   - **Site URL**: `ragastream://`
   - **Redirect URLs**, add both:
     - `exp://**` (Expo Go; the exact URL is printed in the Metro log as `[auth] Google redirect URL …`)
     - `ragastream://**` (native builds)
     - `http://*.nip.io:8000/auth/return**`: your backend's sign-in landing page in development. Google returns to this page, which opens the app and shows a "Back to RagaStream" button, because Android won't open the app straight from Supabase's redirect. When you deploy, add `<deployed backend URL>/auth/return**` too.
   - **Supabase rejects return addresses with a raw IP host** (like `192.168.1.3`), even when they're allow-listed, and silently sends people to the Site URL. That's why Google sign-in hung. The app therefore uses `192-168-1-3.nip.io` for the landing page; nip.io is public DNS that resolves to your laptop's IP. Entries with an IP in them are never matched, so don't add them.
4. Leaked-password protection is a Pro-plan feature, so skip it on the free plan.

After someone confirms their email in the browser, they go back to the app and sign in with their password. The app doesn't catch the confirmation link yet.

## 3. Gmail app password (sends the approval emails)

1. Turn on **2-Step Verification** for `atharvakanawade@gmail.com`: https://myaccount.google.com/security
2. Open https://myaccount.google.com/apppasswords, create one named *RagaStream*, and copy the 16-character password.
3. Never paste it into chat or into the repo. It goes into Supabase's function secrets (next step).

## 4. Function secrets

Go to **Edge Functions → Secrets** in the dashboard and add:

| Name | Value |
|---|---|
| `GMAIL_USER` | `atharvakanawade@gmail.com` |
| `GMAIL_APP_PASSWORD` | the 16-character app password |
| `OWNER_EMAIL` | `atharvakanawade@gmail.com` |
| `APPROVAL_LINK_SECRET` | only for the unused `review-signup` function: a long random string. Optional. |
| `REVIEW_PAGE_CONTENT_TYPE` | only for `review-signup`: `application/xhtml+xml`. Optional. |

`SUPABASE_URL` and the service key are provided to functions automatically.

The backend also needs `OWNER_EMAILS=atharvakanawade@gmail.com` in `backend/.env` (already added). That's what shows you the Requests screen.

`review-signup` (browser approve links) is deployed but not used. Supabase rewrites every GET page on `*.supabase.co` to plain text, even XHTML, so its confirmation page can't render. It becomes usable with a custom domain plus the `PUBLIC_FUNCTIONS_URL` secret.

## 5. Database and functions

These two steps can be run by Claude through the Supabase connection (you approve each one), or by you:

1. **SQL**: run `backend/access_schema.sql`, then `backend/harden_security.sql`, in the **SQL Editor**. This creates `user_access`, the sign-up trigger, and marks every existing account as approved.
   - Until it's applied, approval is off and the app works as before. The backend logs "Owner approval is OFF".
2. **Functions**: `notify-signup` is deployed (2026-10-22), with JWT verification off. Redeploy after you change `supabase/functions/` (see its README).

## 6. Check it works

1. In the app, sign up with a second email or Google account.
2. You land on **"You're on the list"**, and an email arrives at `atharvakanawade@gmail.com` within a minute or so.
3. On your phone, signed in as yourself: open **Settings → Requests** (the badge shows the count) and tap **Approve**.
4. Within 30 seconds the waiting screen on their phone opens the app.
5. If no email arrives:
   - check **Edge Functions → notify-signup → Logs**;
   - the account is still pending in the `user_access` table, so you can approve it there by setting `status` to `approved`.
