import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

export type Song = {
  id: string;
  youtube_id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
  language?: string | null;
  genre?: string | null;
  play_count?: number;
};

export type CreateSongInput = Omit<Song, 'id'>;

export function useSongs(limit?: number) {
  return useQuery({
    queryKey: ['songs', limit],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/songs', {
        params: limit ? { limit } : undefined,
      });
      return data;
    },
  });
}

export function useCreateSong() {
  return useMutation({
    mutationFn: async (payload: CreateSongInput) => {
      const { data } = await apiClient.post<Song>('/songs', payload);
      return data;
    },
  });
}
