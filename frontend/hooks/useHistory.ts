import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import type { Song } from './useSongs';

export type TopSong = Song & { plays: number };
export type TopChannel = {
  channel_name: string;
  plays: number;
  thumbnail_url?: string | null;
  top_song: Song;
};
export type ListeningStats = {
  total_plays: number;
  top_songs: TopSong[];
  top_channels: TopChannel[];
};
export type StatsRange = 'short' | 'medium' | 'long';

// All keys start with 'history' so a single invalidate after each play
// refreshes recently played, On Repeat and stats together.

export function useRecentlyPlayed() {
  return useQuery({
    queryKey: ['history', 'recent'],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/history');
      // Collapse repeats so the row shows distinct songs.
      const seen = new Set<string>();
      return data.filter((s) => (seen.has(s.youtube_id) ? false : (seen.add(s.youtube_id), true)));
    },
    retry: false,
  });
}

/** Most-played songs over the last 30 days ("On Repeat"). */
export function useOnRepeat() {
  return useQuery({
    queryKey: ['history', 'top', 30],
    queryFn: async () => {
      const { data } = await apiClient.get<TopSong[]>('/history/top', { params: { days: 30, limit: 20 } });
      return data;
    },
    retry: false,
  });
}

export function useListeningStats(range: StatsRange, limit = 10) {
  return useQuery({
    queryKey: ['history', 'stats', range, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<ListeningStats>('/history/stats', { params: { range, limit } });
      return data;
    },
    retry: false,
  });
}
