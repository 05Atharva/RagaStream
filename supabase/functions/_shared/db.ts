import { createClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./env.ts";

/** Service-role client. Bypasses RLS, so only use it after checking the request. */
export function adminClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
