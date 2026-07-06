-- ============================================================
-- RagaStream: Fix table permissions for service_role
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor → New Query
--
-- The service_role needs explicit GRANT permissions on all
-- application tables. Without these, the backend gets
-- 42501: permission denied errors even with the service_role key.
-- ============================================================

-- Grant full access on all application tables to service_role
GRANT ALL ON TABLE public.songs          TO service_role;
GRANT ALL ON TABLE public.playlists      TO service_role;
GRANT ALL ON TABLE public.playlist_songs TO service_role;
GRANT ALL ON TABLE public.liked_songs    TO service_role;
GRANT ALL ON TABLE public.play_history   TO service_role;

-- Also grant to authenticated and anon roles as needed by RLS policies
GRANT SELECT ON TABLE public.songs TO anon;
GRANT SELECT ON TABLE public.songs TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.songs TO authenticated;

GRANT ALL ON TABLE public.playlists      TO authenticated;
GRANT ALL ON TABLE public.playlist_songs TO authenticated;
GRANT ALL ON TABLE public.liked_songs    TO authenticated;
GRANT ALL ON TABLE public.play_history   TO authenticated;

-- If user_profiles table exists, grant access too
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
        EXECUTE 'GRANT ALL ON TABLE public.user_profiles TO service_role';
        EXECUTE 'GRANT SELECT, UPDATE ON TABLE public.user_profiles TO authenticated';
    END IF;
END $$;

-- Grant usage on sequences (needed for default UUID generation)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;
