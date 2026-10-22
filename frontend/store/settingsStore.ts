import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type LibrarySort = 'recents' | 'added' | 'alphabetical';
export type ThemePreference = 'system' | 'light' | 'dark';
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
  // Appearance
  themePreference: ThemePreference;
  // Riyaz milestones already celebrated (ids), and whether existing ones were seeded silently
  achievedMilestones: string[];
  milestonesSeeded: boolean;
  // Accounts (user ids) that have already seen the welcome, so a second account on the phone still gets it
  welcomedUserIds: string[];
  // Playback
  autoplay: boolean;
  privateSession: boolean;
  playbackRate: number;
  hiddenYoutubeIds: string[];
  // Local mirror of /feedback channel hides (exact channel names).
  hiddenChannels: string[];
  // true once the local hides above have been uploaded to /feedback
  feedbackSynced: boolean;
  // Search
  recentSearches: RecentSearch[];
  // Library
  librarySort: LibrarySort;
  libraryView: LibraryView;
  pinnedPlaylistIds: string[];
  recentContexts: RecentContext[];

  setThemePreference: (value: ThemePreference) => void;
  markMilestones: (ids: string[], seeded?: boolean) => void;
  markWelcomed: (userId: string) => void;
  setAutoplay: (value: boolean) => void;
  setPrivateSession: (value: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  hideSong: (youtubeId: string) => void;
  unhideSong: (youtubeId: string) => void;
  hideChannel: (channelName: string) => void;
  unhideChannel: (channelName: string) => void;
  setFeedbackSynced: (value: boolean) => void;
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
      themePreference: 'system',
      achievedMilestones: [],
      milestonesSeeded: false,
      welcomedUserIds: [],
      autoplay: true,
      privateSession: false,
      playbackRate: 1,
      hiddenYoutubeIds: [],
      hiddenChannels: [],
      feedbackSynced: false,
      recentSearches: [],
      librarySort: 'recents',
      libraryView: 'list',
      pinnedPlaylistIds: [],
      recentContexts: [],

      setThemePreference: (themePreference) => set({ themePreference }),
      markMilestones: (ids, seeded) =>
        set((state) => ({
          achievedMilestones: [...new Set([...state.achievedMilestones, ...ids])],
          milestonesSeeded: seeded ?? state.milestonesSeeded,
        })),
      markWelcomed: (userId) =>
        set((state) => ({
          welcomedUserIds: state.welcomedUserIds.includes(userId) ? state.welcomedUserIds : [...state.welcomedUserIds, userId],
        })),
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
      hideChannel: (channelName) =>
        set((state) => ({
          hiddenChannels: state.hiddenChannels.includes(channelName)
            ? state.hiddenChannels
            : [...state.hiddenChannels, channelName],
        })),
      unhideChannel: (channelName) =>
        set((state) => ({
          hiddenChannels: state.hiddenChannels.filter((c) => c !== channelName),
        })),
      setFeedbackSynced: (feedbackSynced) => set({ feedbackSynced }),
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
