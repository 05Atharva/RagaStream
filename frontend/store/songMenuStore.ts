import { create } from 'zustand';
import type { SongInput } from '../services/playbackController';
import type { Track } from './playerStore';

export type SongMenuOptions = {
  /** Song is shown inside this playlist → offer "Remove from this playlist". */
  playlistId?: string;
  /** Song is an entry in the play queue → offer "Remove from queue". */
  queueTrack?: Track;
  /** Already on this channel's page → hide "Go to channel". */
  hideGoToChannel?: boolean;
};

type SongMenuStore = {
  song: SongInput | null;
  options: SongMenuOptions;
  isMenuVisible: boolean;
  isSaveVisible: boolean;
  openMenu: (song: SongInput, options?: SongMenuOptions) => void;
  closeMenu: () => void;
  openSave: (song: SongInput) => void;
  closeSave: () => void;
};

export const useSongMenuStore = create<SongMenuStore>((set) => ({
  song: null,
  options: {},
  isMenuVisible: false,
  isSaveVisible: false,
  openMenu: (song, options = {}) => set({ song, options, isMenuVisible: true, isSaveVisible: false }),
  closeMenu: () => set({ isMenuVisible: false }),
  openSave: (song) => set({ song, isSaveVisible: true, isMenuVisible: false }),
  closeSave: () => set({ isSaveVisible: false }),
}));

/** Open the song options sheet from anywhere (long-press or ⋮). */
export const openSongMenu = (song: SongInput, options?: SongMenuOptions) =>
  useSongMenuStore.getState().openMenu(song, options);

/** Open the "Save to" sheet (Liked Songs + playlists) from anywhere. */
export const openSaveSheet = (song: SongInput) => useSongMenuStore.getState().openSave(song);
