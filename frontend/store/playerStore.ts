import { create } from 'zustand';

export type Track = {
  id: string;               // catalogue UUID once known, otherwise the YouTube ID
  title: string;
  artist: string;
  album: string;
  artwork: string;
  url: string;              // '' until the stream URL has been resolved
  source: 'youtube';
  youtubeId?: string;
  channelName?: string;
  thumbnailUrl?: string;
  youtube_id?: string;
  channel_name?: string;
  thumbnail_url?: string;
  durationSec?: number;
  queueId?: string;         // unique per queue entry (the same song can appear twice)
  isRecommendation?: boolean; // added by Smart Shuffle
  isAutoplay?: boolean;       // appended by Autoplay when the context ran out
};

export type RepeatModeValue = 'off' | 'one' | 'all';
export type ShuffleMode = 'off' | 'shuffle' | 'smart';

export type PlaybackContext = {
  type: 'playlist' | 'liked' | 'search' | 'channel' | 'home' | 'radio' | 'queue';
  name: string;
  id?: string;
};

export type SleepTimerState = {
  endsAt: number | null;    // epoch ms, for minute-based timers
  endOfTrack: boolean;      // pause when the current track finishes
};

type PlayerStore = {
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  // The context being played (playlist, liked songs, radio…) — played and upcoming.
  queue: Track[];
  currentIndex: number;
  // "Next in queue" — user-queued tracks that play before the context continues.
  userQueue: Track[];
  playingFromUserQueue: boolean;
  context: PlaybackContext | null;
  repeatMode: RepeatModeValue;
  shuffleMode: ShuffleMode;
  // Pre-shuffle context order, so turning shuffle off restores it.
  originalQueue: Track[] | null;
  currentPosition: number;
  duration: number;
  playbackRate: number;
  sleepTimer: SleepTimerState;
  showReconnecting: boolean;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setShowReconnecting: (show: boolean) => void;
};

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentTrack: null,
  isPlaying: false,
  isLoading: false,
  queue: [],
  currentIndex: -1,
  userQueue: [],
  playingFromUserQueue: false,
  context: null,
  repeatMode: 'off',
  shuffleMode: 'off',
  originalQueue: null,
  currentPosition: 0,
  duration: 0,
  playbackRate: 1,
  sleepTimer: { endsAt: null, endOfTrack: false },
  showReconnecting: false,
  setPosition: (currentPosition) => set({ currentPosition }),
  setDuration: (duration) => set({ duration }),
  setShowReconnecting: (show) => set({ showReconnecting: show }),
}));

/** Tracks that will play after the current one, in order (user queue first). */
export function selectUpNext(state: Pick<PlayerStore, 'queue' | 'currentIndex' | 'userQueue'>) {
  return {
    userQueue: state.userQueue,
    contextUpcoming: state.queue.slice(state.currentIndex + 1),
  };
}

export const usePlayer = usePlayerStore;
