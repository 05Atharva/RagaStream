import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { apiClient } from '../services/apiClient';
import type { Track } from '../store/playerStore';

export type LyricLine = { time: number; text: string };

export type Lyrics = {
  synced: boolean;
  lines: LyricLine[];
  plain: string | null;
  track_name: string;
  artist_name: string;
  source: string;
};

/** Synced lyrics (LRCLIB) for a track. `null` = no lyrics exist for it. */
export function useLyrics(track: Track | null) {
  const title = track?.title;
  const artist = track?.channelName || track?.channel_name || track?.artist;
  const duration = track?.durationSec;

  return useQuery({
    queryKey: ['lyrics', title, artist],
    enabled: Boolean(title),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    // 503 = LRCLIB busy (worth retrying); 404 = genuinely no lyrics.
    retry: (count, error) => axios.isAxiosError(error) && error.response?.status === 503 && count < 2,
    retryDelay: 3000,
    queryFn: async (): Promise<Lyrics | null> => {
      try {
        const { data } = await apiClient.get<Lyrics>('/lyrics', {
          params: { title, artist, duration: duration ? Math.round(duration) : undefined },
        });
        return data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) return null;
        throw error;
      }
    },
  });
}

/** Index of the line being sung at `position` (seconds), or -1 before the first. */
export function activeLineIndex(lines: LyricLine[], position: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  const target = position + 0.25; // land slightly early so highlights don't feel late
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}
