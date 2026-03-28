import { create } from 'zustand';

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  url: string;
  source: 'youtube' | 'mp3_upload' | 'archive';
  youtubeId?: string;
  channelName?: string;
  thumbnailUrl?: string;
};

export type RepeatModeValue = 'off' | 'one' | 'all';

type PlayerStore = {
  currentTrack: Track | null;
  isPlaying: boolean;
  queue: Track[];
  repeatMode: RepeatModeValue;
  shuffle: boolean;
  currentPosition: number;
  duration: number;
  setCurrentTrack: (track: Track | null) => void;
  togglePlay: () => Promise<void>;
  setQueue: (queue: Track[]) => Promise<void>;
  addToQueue: (track: Track) => Promise<void>;
  setRepeat: (repeatMode: RepeatModeValue) => Promise<void>;
  toggleShuffle: () => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
};

type TrackPlayerModule = typeof import('react-native-track-player');

let hasInitializedTrackPlayerSync = false;

const normalizeTrack = (value: unknown): Track | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rawTrack = value as Partial<Track>;

  if (
    typeof rawTrack.id !== 'string' ||
    typeof rawTrack.title !== 'string' ||
    typeof rawTrack.artist !== 'string' ||
    typeof rawTrack.album !== 'string' ||
    typeof rawTrack.artwork !== 'string' ||
    typeof rawTrack.url !== 'string' ||
    (rawTrack.source !== 'youtube' &&
      rawTrack.source !== 'mp3_upload' &&
      rawTrack.source !== 'archive')
  ) {
    return null;
  }

  return {
    id: rawTrack.id,
    title: rawTrack.title,
    artist: rawTrack.artist,
    album: rawTrack.album,
    artwork: rawTrack.artwork,
    url: rawTrack.url,
    source: rawTrack.source,
    youtubeId: typeof rawTrack.youtubeId === 'string' ? rawTrack.youtubeId : undefined,
    channelName: typeof rawTrack.channelName === 'string' ? rawTrack.channelName : undefined,
    thumbnailUrl: typeof rawTrack.thumbnailUrl === 'string' ? rawTrack.thumbnailUrl : undefined,
  };
};

const mapRepeatModeToNative = (repeatMode: RepeatModeValue, module: TrackPlayerModule) => {
  switch (repeatMode) {
    case 'one':
      return module.RepeatMode.Track;
    case 'all':
      return module.RepeatMode.Queue;
    default:
      return module.RepeatMode.Off;
  }
};

const mapPlaybackStateToPlaying = (
  playbackState: Awaited<ReturnType<TrackPlayerModule['default']['getPlaybackState']>>,
  module: TrackPlayerModule
) => playbackState.state === module.State.Playing;

const loadTrackPlayerModule = (): TrackPlayerModule | null => {
  try {
    return require('react-native-track-player') as TrackPlayerModule;
  } catch {
    return null;
  }
};

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  queue: [],
  repeatMode: 'off',
  shuffle: false,
  currentPosition: 0,
  duration: 0,
  setCurrentTrack: (track) => set({ currentTrack: track }),
  togglePlay: async () => {
    const module = loadTrackPlayerModule();
    const nextIsPlaying = !get().isPlaying;

    set({ isPlaying: nextIsPlaying });

    if (!module) {
      return;
    }

    try {
      if (nextIsPlaying) {
        await module.default.play();
      } else {
        await module.default.pause();
      }
    } catch {
      set({ isPlaying: !nextIsPlaying });
    }
  },
  setQueue: async (queue) => {
    set({
      queue,
      currentTrack: queue.length > 0 ? get().currentTrack ?? queue[0] : null,
    });

    const module = loadTrackPlayerModule();
    if (!module) {
      return;
    }

    try {
      await module.default.setQueue(queue);
    } catch {
      // Keep local queue state even if native queue sync is unavailable.
    }
  },
  addToQueue: async (track) => {
    set((state) => {
      const nextQueue = [...state.queue, track];
      return {
        queue: nextQueue,
        currentTrack: state.currentTrack ?? track,
      };
    });

    const module = loadTrackPlayerModule();
    if (!module) {
      return;
    }

    try {
      await module.default.add(track);
    } catch {
      // Keep local queue state even if native queue sync is unavailable.
    }
  },
  setRepeat: async (repeatMode) => {
    set({ repeatMode });

    const module = loadTrackPlayerModule();
    if (!module) {
      return;
    }

    try {
      await module.default.setRepeatMode(mapRepeatModeToNative(repeatMode, module));
    } catch {
      // Keep local repeat state even if native repeat sync is unavailable.
    }
  },
  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
  setPosition: (currentPosition) => set({ currentPosition }),
  setDuration: (duration) => set({ duration }),
}));

const initializeTrackPlayerSync = () => {
  if (hasInitializedTrackPlayerSync) {
    return;
  }

  hasInitializedTrackPlayerSync = true;

  const module = loadTrackPlayerModule();
  if (!module) {
    return;
  }

  const { Event, State } = module;

  const hydrateFromTrackPlayer = async () => {
    try {
      const [playbackState, progress, activeTrack, queue] = await Promise.all([
        module.default.getPlaybackState(),
        module.default.getProgress(),
        module.default.getActiveTrack(),
        module.default.getQueue(),
      ]);

      usePlayerStore.setState({
        isPlaying: mapPlaybackStateToPlaying(playbackState, module),
        currentPosition: progress.position,
        duration: progress.duration,
        currentTrack: normalizeTrack(activeTrack),
        queue: queue.map(normalizeTrack).filter((track): track is Track => track !== null),
      });
    } catch {
      // Ignore hydration failures when the native module is unavailable or not set up yet.
    }
  };

  void hydrateFromTrackPlayer();

  module.default.addEventListener(Event.PlaybackState, (event) => {
    usePlayerStore.setState({
      isPlaying: event.state === State.Playing,
    });
  });

  module.default.addEventListener(Event.PlaybackProgressUpdated, (event) => {
    usePlayerStore.setState({
      currentPosition: event.position,
      duration: event.duration,
    });
  });

  module.default.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
    const nextTrack =
      normalizeTrack(event.track) ??
      (typeof event.index === 'number' ? usePlayerStore.getState().queue[event.index] ?? null : null);

    usePlayerStore.setState({
      currentTrack: nextTrack,
      currentPosition: 0,
    });
  });
};

initializeTrackPlayerSync();

export const usePlayer = usePlayerStore;
