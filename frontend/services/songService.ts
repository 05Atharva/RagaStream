import { apiClient } from './apiClient';

// Session-scoped in-memory cache: youtube_id → catalogue UUID
const catalogueCache = new Map<string, string>();

type YouTubeResult = {
  youtube_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_sec: number;
};

/**
 * Ensures a YouTube video is saved in the Supabase songs catalogue.
 * Uses a local cache to avoid redundant API calls within the same session.
 * The backend POST /songs endpoint uses upsert on youtube_id so it is safe
 * to call even if the song already exists.
 *
 * Returns the internal Supabase UUID of the song.
 */
export async function ensureSongInCatalogue(ytResult: YouTubeResult): Promise<string> {
  const cached = catalogueCache.get(ytResult.youtube_id);
  if (cached) {
    return cached;
  }

  const res = await apiClient.post<{ id: string }>('/songs', {
    youtube_id: ytResult.youtube_id,
    title: ytResult.title,
    channel_name: ytResult.channel_name,
    thumbnail_url: ytResult.thumbnail_url || null,
    duration_sec: ytResult.duration_sec || null,
  });

  const id = res.data.id;
  catalogueCache.set(ytResult.youtube_id, id);
  return id;
}
