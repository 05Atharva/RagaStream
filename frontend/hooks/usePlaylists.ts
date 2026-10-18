import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import type { Song } from './useSongs';

export type Playlist = {
  id: string;
  name: string;
  description?: string | null;
  songs?: Song[];
  song_count?: number;
  cover_thumbnails?: string[];
  updated_at?: string | null;
  created_at?: string | null;
};

export type CreatePlaylistInput = {
  name: string;
  description?: string;
};

/** Playlist summaries (song_count + cover_thumbnails), no song lists. */
export function usePlaylists(enabled = true) {
  return useQuery({
    queryKey: ['playlists'],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<Playlist[]>('/playlists');
      return data;
    },
  });
}

export function usePlaylist(playlistId: string) {
  return useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: async () => {
      const { data } = await apiClient.get<Playlist>(`/playlists/${playlistId}`);
      return data;
    },
  });
}

/** IDs of the user's playlists that already contain this video. */
export function usePlaylistsContaining(youtubeId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['playlist-containing', youtubeId],
    enabled: enabled && Boolean(youtubeId),
    queryFn: async () => {
      const { data } = await apiClient.get<string[]>('/playlists/containing', {
        params: { youtube_id: youtubeId },
      });
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
