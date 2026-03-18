import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const DEMO_EMAIL = 'demo@ragastream.com';
export const DEMO_PASSWORD = 'password123';

type AuthStore = {
  session: Session | null;
  hasHydrated: boolean;
  setSession: (session: Session | null) => void;
  clearSession: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      session: null,
      hasHydrated: false,
      setSession: (session) => set({ session }),
      clearSession: () => set({ session: null }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'ragastream-auth-session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ session: state.session }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export const createDemoSession = (): Session => {
  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return {
    access_token: 'demo-access-token',
    refresh_token: 'demo-refresh-token',
    expires_in: 24 * 60 * 60,
    expires_at: expiresAt,
    token_type: 'bearer',
    user: {
      id: 'demo-user',
      app_metadata: {
        provider: 'email',
        providers: ['email'],
      },
      user_metadata: {
        name: 'Demo Listener',
      },
      aud: 'authenticated',
      email: DEMO_EMAIL,
      created_at: now,
      updated_at: now,
      last_sign_in_at: now,
      role: 'authenticated',
    },
  };
};
