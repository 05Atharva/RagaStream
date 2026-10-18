import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import type { Song } from './useSongs';

export type LikedSong = Song & { added_at?: string | null };

/** Every liked song, newest first. Shared cache key: ['liked']. */
export function useLikedSongs() {
  return useQuery({
    queryKey: ['liked'],
    queryFn: async () => {
      const { data } = await apiClient.get<LikedSong[]>('/liked');
      return data;
    },
  });
}

/** Set of liked YouTube IDs for O(1) "is this liked?" checks in lists. */
export function useLikedYoutubeIds() {
  const { data } = useLikedSongs();
  return useMemo(() => new Set((data ?? []).map((s) => s.youtube_id)), [data]);
}

export function useIsLiked(youtubeId: string | null | undefined) {
  const likedIds = useLikedYoutubeIds();
  return youtubeId ? likedIds.has(youtubeId) : false;
}
