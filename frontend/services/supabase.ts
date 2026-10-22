import 'react-native-url-polyfill/auto';
import './cryptoPolyfill'; // SHA-256 PKCE for Google sign-in (must run before createClient)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          // Google sign-in returns a ?code= to the app; email confirmation links do too.
          flowType: 'pkce',
          persistSession: true,
        },
      })
    : null;
