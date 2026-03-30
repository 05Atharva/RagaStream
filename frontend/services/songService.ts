import { apiClient } from './apiClient';

const catalogueCache = new Map<string, string>();

type YouTubeResult = {
  youtube_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_sec: number;
};

export async function ensureSongInCatalogue(ytResult: YouTubeResult): Promise<string> {
  if (catalogueCache.has(ytResult.youtube_id)) {
    return catalogueCache.get(ytResult.youtube_id)!;
  }

  const existing = await apiClient.get(`/search?q=${ytResult.youtube_id}`);
  if (existing.data.songs.length > 0) {
    const id = existing.data.songs[0].id as string;
    catalogueCache.set(ytResult.youtube_id, id);
    return id;
  }

  const res = await apiClient.post('/songs', ytResult);
  const id = res.data.id as string;
  catalogueCache.set(ytResult.youtube_id, id);
  return id;
}
