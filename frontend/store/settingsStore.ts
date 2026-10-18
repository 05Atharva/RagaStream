import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type LibrarySort = 'recents' | 'added' | 'alphabetical';
export type LibraryView = 'list' | 'grid';

export type RecentSearch = {
  query: string;
  searchedAt: number;
};

// A thing the user played *from* — powers "Jump back in" on Home.
export type RecentContext = {
  type: 'playlist' | 'liked' | 'channel' | 'radio';
  id: string;
  name: string;
  thumbnail?: string | null;
  playedAt: number;
};

const MAX_RECENT_SEARCHES = 12;
const MAX_RECENT_CONTEXTS = 8;

type SettingsStore = {
  // Playback
  autoplay: boolean;
  privateSession: boolean;
  playbackRate: number;
  hiddenYoutubeIds: string[];
  // Search
  recentSearches: RecentSearch[];
  // Library
  librarySort: LibrarySort;
  libraryView: LibraryView;
  pinnedPlaylistIds: string[];
  recentContexts: RecentContext[];

  setAutoplay: (value: boolean) => void;
  setPrivateSession: (value: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  hideSong: (youtubeId: string) => void;
  unhideSong: (youtubeId: string) => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  setLibrarySort: (sort: LibrarySort) => void;
  setLibraryView: (view: LibraryView) => void;
  togglePinnedPlaylist: (playlistId: string) => void;
  recordContext: (context: Omit<RecentContext, 'playedAt'>) => void;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      autoplay: true,
      privateSession: false,
      playbackRate: 1,
      hiddenYoutubeIds: [],
      recentSearches: [],
      librarySort: 'recents',
      libraryView: 'list',
      pinnedPlaylistIds: [],
      recentContexts: [],

      setAutoplay: (autoplay) => set({ autoplay }),
      setPrivateSession: (privateSession) => set({ privateSession }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      hideSong: (youtubeId) =>
        set((state) => ({
          hiddenYoutubeIds: state.hiddenYoutubeIds.includes(youtubeId)
            ? state.hiddenYoutubeIds
            : [...state.hiddenYoutubeIds, youtubeId],
        })),
      unhideSong: (youtubeId) =>
        set((state) => ({
          hiddenYoutubeIds: state.hiddenYoutubeIds.filter((id) => id !== youtubeId),
        })),
      addRecentSearch: (query) => {
        const trimmed = query.trim();
        if (trimmed.length < 2) return;
        set((state) => ({
          recentSearches: [
            { query: trimmed, searchedAt: Date.now() },
            ...state.recentSearches.filter((s) => s.query.toLowerCase() !== trimmed.toLowerCase()),
          ].slice(0, MAX_RECENT_SEARCHES),
        }));
      },
      removeRecentSearch: (query) =>
        set((state) => ({
          recentSearches: state.recentSearches.filter((s) => s.query !== query),
        })),
      clearRecentSearches: () => set({ recentSearches: [] }),
      setLibrarySort: (librarySort) => set({ librarySort }),
      setLibraryView: (libraryView) => set({ libraryView }),
      togglePinnedPlaylist: (playlistId) =>
        set((state) => ({
          pinnedPlaylistIds: state.pinnedPlaylistIds.includes(playlistId)
            ? state.pinnedPlaylistIds.filter((id) => id !== playlistId)
            : [...state.pinnedPlaylistIds, playlistId],
        })),
      recordContext: (context) =>
        set((state) => ({
          recentContexts: [
            { ...context, playedAt: Date.now() },
            ...state.recentContexts.filter((c) => !(c.type === context.type && c.id === context.id)),
          ].slice(0, MAX_RECENT_CONTEXTS),
        })),
    }),
    {
      name: 'ragastream-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
