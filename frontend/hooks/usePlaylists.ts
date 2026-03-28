import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import type { Song } from './useSongs';

export type Playlist = {
  id: string;
  name: string;
  description?: string;
  songs?: Song[];
};

export type CreatePlaylistInput = {
  name: string;
  description?: string;
};

export function usePlaylists() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: async () => {
      const { data } = await apiClient.get<Playlist[]>('/playlists');
      return data;
    },
  });
}

export function useCreatePlaylist() {
  return useMutation({
    mutationFn: async (payload: CreatePlaylistInput) => {
      const { data } = await apiClient.post<Playlist>('/playlists', payload);
      return data;
    },
  });
}
