import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { mix } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';

export type ArtworkPalette = {
  accent: string;     // vivid — highlights
  background: string; // dark tint — gradients behind content
  muted: string;      // near-black tint — mini player, deep surfaces
};

// Kesar-derived, used until (or if) a thumbnail's colour can't be read.
export const DEFAULT_PALETTE: ArtworkPalette = {
  accent: '#FF7A1A',
  background: '#3A2414',
  muted: '#1B130D',
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

/**
 * Hero / collapsed-bar colours derived from artwork, correct for the theme:
 * dark → deep tint fading into Ink; light → pale wash fading into Porcelain.
 */
export function useHeroTint(palette: ArtworkPalette) {
  const { isDark, colors } = useTheme();
  return useMemo(
    () => ({
      top: isDark ? palette.background : mix(palette.accent, colors.bg, 0.72),
      bar: isDark ? palette.muted : mix(palette.accent, colors.bg, 0.86),
      ink: isDark ? '#FFFFFF' : colors.text,
      inkDim: isDark ? 'rgba(255,255,255,0.72)' : colors.textSecondary,
    }),
    [colors.bg, colors.text, colors.textSecondary, isDark, palette.accent, palette.background, palette.muted]
  );
}
