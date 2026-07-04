import axios from 'axios';
import { supabase } from './supabase';

const baseURL = process.env.EXPO_PUBLIC_API_URL;

export const apiClient = axios.create({
  baseURL,
});

// ── Request: attach Supabase Bearer token ─────────────────────────────────────
apiClient.interceptors.request.use(async (config) => {
  if (!supabase) {
    return config;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    config.headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  return config;
});

// ── Response: auto sign-out when the server returns 401 ───────────────────────
// This happens when the Supabase session token has expired (e.g. after
// Supabase project was paused). Signing out clears local state and lets
// App.tsx's onAuthStateChange navigate back to the login screen.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      supabase
    ) {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore — session already gone
      }
    }
    return Promise.reject(error);
  }
);
