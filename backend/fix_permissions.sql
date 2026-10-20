-- ============================================================
-- RagaStream: table permissions for the backend (service_role)
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor → New Query
--
-- The service_role needs explicit GRANT permissions on all
-- application tables. Without these, the backend gets
-- 42501: permission denied errors even with the service_role key.
--
-- The public roles (anon, authenticated) get nothing on purpose: the app
-- only reaches the data through the backend. See harden_security.sql.
-- ============================================================

GRANT ALL ON TABLE public.songs          TO service_role;
GRANT ALL ON TABLE public.playlists      TO service_role;
GRANT ALL ON TABLE public.playlist_songs TO service_role;
GRANT ALL ON TABLE public.liked_songs    TO service_role;
GRANT ALL ON TABLE public.play_history   TO service_role;

-- If user_profiles table exists (admin flag), the backend needs it too.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
        EXECUTE 'GRANT ALL ON TABLE public.user_profiles TO service_role';
    END IF;
END $$;

-- Sequences (needed for default ID generation)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
