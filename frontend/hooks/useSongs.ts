import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

export type Song = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  url?: string;
  source?: 'youtube' | 'mp3_upload' | 'archive';
  youtubeId?: string;
};

export type CreateSongInput = Omit<Song, 'id'>;

export function useSongs() {
  return useQuery({
    queryKey: ['songs'],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/songs');
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
