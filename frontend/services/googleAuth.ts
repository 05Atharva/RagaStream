/**
 * Native Google Sign-In → Supabase session. Shared by Login and Sign up.
 *
 * Flow: GoogleSignin.signIn() shows the native account picker, returns an
 * idToken, which Supabase exchanges via signInWithIdToken() (creating the
 * account on first use). Needs a native build; Expo Go has no module.
 *
 * One-time setup: a Web Client ID from Google Cloud Console, added to
 * Supabase → Auth → Providers → Google and to GoogleSignin.configure (App.tsx).
 */
import { supabase } from './supabase';

let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null = null;
let statusCodes: typeof import('@react-native-google-signin/google-signin').statusCodes | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const gsi = require('@react-native-google-signin/google-signin');
  GoogleSignin = gsi.GoogleSignin;
  statusCodes = gsi.statusCodes;
} catch {
  // Native module unavailable (Expo Go).
}

export type GoogleAuthResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; title: string; message: string };

export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  if (!GoogleSignin || !statusCodes) {
    return {
      ok: false,
      title: 'Google sign-in needs the full app',
      message: "It isn't available in Expo Go. Use email for now, or install a native build (npx expo run:android).",
    };
  }
  if (!supabase) {
    return { ok: false, title: "Sign-in isn't set up", message: 'Supabase keys are missing from this build.' };
  }
  try {
    await GoogleSignin.hasPlayServices();
    const info = await GoogleSignin.signIn();
    const idToken = info.data?.idToken;
    if (!idToken) {
      return { ok: false, title: "Google didn't sign you in", message: 'No sign-in token came back. Try again.' };
    }
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { ok: false, title: "Couldn't sign in with Google", message: error.message };
    return { ok: true };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return { ok: false, cancelled: true };
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { ok: false, title: 'Google Play services needed', message: 'Update Google Play services on this phone, then try again.' };
    }
    return { ok: false, title: "Couldn't sign in with Google", message: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}
