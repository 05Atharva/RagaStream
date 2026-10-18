import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

export type ArtworkPalette = {
  accent: string;     // vivid — highlights
  background: string; // dark tint — gradients behind content
  muted: string;      // near-black tint — mini player, deep surfaces
};

// Brand purple, used until (or if) a thumbnail's colour can't be read.
export const DEFAULT_PALETTE: ArtworkPalette = {
  accent: '#7C3AED',
  background: '#2A1650',
  muted: '#160B2B',
};

/**
 * Dominant-colour palette for a thumbnail, computed by the backend. Spotify
 * tints headers, the mini player and Now Playing with the artwork's colour so
 * every song feels distinct; this is the same idea.
 */
export function useArtworkColor(url: string | null | undefined): ArtworkPalette {
  const { data } = useQuery({
    queryKey: ['artwork-color', url],
    enabled: Boolean(url),
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data: palette } = await apiClient.get<ArtworkPalette>('/artwork/color', {
        params: { url },
      });
      return palette;
    },
  });
  return data ?? DEFAULT_PALETTE;
}
