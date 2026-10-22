/**
 * Google sign-in → Supabase session. Shared by Login and Sign up.
 *
 * Default (Expo Go and every build): Supabase OAuth with PKCE in the in-app
 * browser. signInWithOAuth() builds the Google URL, WebBrowser opens it, Google
 * sends the browser back to `redirectTo` with a `code`, and
 * exchangeCodeForSession() turns that into a session (creating the account on
 * first use).
 *
 * The same browser flow runs in Expo Go and in installed builds.
 *
 * One-time setup: add the redirect URL logged in dev (see getRedirectUrl) to
 * Supabase → Auth → URL Configuration → Redirect URLs, and enable the Google
 * provider with its client ID and secret.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// Lets the browser tab close itself when the redirect lands back in the app.
WebBrowser.maybeCompleteAuthSession();

export type GoogleAuthResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; title: string; message: string };

const FAILED_TITLE = "Couldn't sign in with Google";

let loggedRedirect = false;
/**
 * exp://<host>/--/auth/callback in Expo Go, ragastream://auth/callback in a
 * native build. Logged once in dev so it can be copied into Supabase.
 */
export function getRedirectUrl(): string {
  const url = Linking.createURL('auth/callback');
  if (__DEV__ && !loggedRedirect) {
    loggedRedirect = true;
    console.log(`[auth] Google redirect URL (allow-list it in Supabase): ${url}`);
  }
  return url;
}

/** Reads the query string and the #fragment of a redirect URL into one map. */
export function parseAuthCallback(url: string): { code?: string; error?: string; errorDescription?: string } {
  const params: Record<string, string> = {};
  const [beforeHash, hash = ''] = url.split('#');
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  const decode = (text: string) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch {
      return text;
    }
  };
  for (const part of [query, hash]) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = decode(eq < 0 ? pair : pair.slice(0, eq));
      const value = eq < 0 ? '' : decode(pair.slice(eq + 1));
      if (!(key in params)) params[key] = value;
    }
  }
  return { code: params.code, error: params.error, errorDescription: params.error_description };
}

const notSetUp: GoogleAuthResult = {
  ok: false,
  title: "Sign-in isn't set up",
  message: 'Supabase keys are missing from this build.',
};

/**
 * Where Supabase sends the browser after Google. Android's browser won't open the
 * app (exp:// / ragastream://) from a server redirect with no tap, so the tab used
 * to hang. Instead Supabase lands on the backend's /auth/return page, which opens
 * the app and shows a "Back to RagaStream" button (a tap always works).
 * Allow-list `http://*.nip.io:8000/auth/return**` (dev) and the deployed backend's
 * `<API URL>/auth/return**` in Supabase → Auth → URL Configuration.
 */
export function getLandingUrl(appReturn: string): string {
  const api = landingBase(process.env.EXPO_PUBLIC_API_URL ?? '');
  if (!api) return appReturn; // no backend configured: go straight to the app
  return `${api}/auth/return?app=${encodeURIComponent(appReturn)}`;
}

/**
 * Supabase rejects return addresses whose host is a raw IP (e.g. 192.168.1.3) even
 * when they're allow-listed, and silently falls back to the Site URL. In development
 * the backend is on a LAN IP, so use nip.io's hostname for it
 * (192-168-1-3.nip.io resolves to 192.168.1.3). Deployed backends have real names.
 */
export function landingBase(apiUrl: string): string {
  const api = apiUrl.replace(/\/$/, '');
  const m = api.match(/^(https?:\/\/)(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/);
  if (!m) return api;
  const [, scheme, ip, port = '', path = ''] = m;
  return `${scheme}${ip.replace(/\./g, '-')}.nip.io${port}${path}`;
}

async function signInWithBrowser(): Promise<GoogleAuthResult> {
  if (!supabase) return notSetUp;
  const appReturn = getRedirectUrl();
  const redirectTo = getLandingUrl(appReturn);
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error || !data?.url) {
      return { ok: false, title: FAILED_TITLE, message: error?.message ?? 'Google did not respond. Try again.' };
    }

    // The session completes when the app's own URL comes back (from the landing page).
    const result = await WebBrowser.openAuthSessionAsync(data.url, appReturn);
    if (result.type !== 'success') return { ok: false, cancelled: true }; // closed or dismissed

    const { code, error: callbackError, errorDescription } = parseAuthCallback(result.url);
    if (callbackError) {
      const denied = callbackError === 'access_denied';
      return {
        ok: false,
        title: denied ? 'Google sign-in was declined' : FAILED_TITLE,
        message: errorDescription || (denied ? 'Choose an account and allow access to continue.' : callbackError),
      };
    }
    if (!code) {
      return { ok: false, title: "Google didn't sign you in", message: 'No sign-in code came back. Try again.' };
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return {
        ok: false,
        title: FAILED_TITLE,
        message: `${exchangeError.message}. Try again, or sign in with email.`,
      };
    }
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, title: FAILED_TITLE, message: err instanceof Error ? err.message : 'Something went wrong. Try again.' };
  }
}

export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  return signInWithBrowser();
}
