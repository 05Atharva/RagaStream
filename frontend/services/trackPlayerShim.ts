/**
 * trackPlayerShim.ts
 *
 * Safe wrapper around react-native-track-player for Expo Go compatibility.
 *
 * WHY THIS EXISTS:
 *   react-native-track-player is a native module NOT bundled in Expo Go.
 *   Its module evaluation code reads constants from NativeModules.TrackPlayer
 *   (e.g. CAPABILITY_PLAY), which is null in Expo Go, causing an immediate
 *   crash. try/catch around require() does NOT reliably save us because Metro
 *   can propagate module-eval errors before our catch can run.
 *
 * THE FIX:
 *   Check NativeModules.TrackPlayer BEFORE calling require(). If the native
 *   module isn't registered, we never call require() and use no-op stubs.
 *   In a real native build (EAS / expo run:android), NativeModules.TrackPlayer
 *   will be non-null and the real module is loaded.
 */
import { NativeModules } from 'react-native';

type RealModule = typeof import('react-native-track-player');

// ── Native module availability check ─────────────────────────────────────────
//    NativeModules.TrackPlayer is non-null ONLY in real native builds.
//    In Expo Go it is null/undefined → skip require() entirely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nativeTrackPlayer = (NativeModules as any).TrackPlayer;
const isAvailable = nativeTrackPlayer != null;

let _module: RealModule | null = null;

if (isAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _module = require('react-native-track-player') as RealModule;
  } catch {
    _module = null;
  }
}

/** True in real native builds (EAS / expo run:android), false in Expo Go. */
export const isTrackPlayerAvailable = _module !== null;

// ── No-op stub (used in Expo Go) ─────────────────────────────────────────────
const noop = async () => {};
const noopSync = () => {};

const stubPlayer = {
  setupPlayer:        noop,
  updateOptions:      noop,
  play:               noop,
  pause:              noop,
  stop:               noop,
  reset:              noop,
  add:                noop,
  remove:             noop,
  skip:               noop,
  skipToNext:         noop,
  skipToPrevious:     noop,
  seekTo:             noop,
  setQueue:           noop,
  setRepeatMode:      noop,
  getProgress:        async () => ({ position: 0, duration: 0, buffered: 0 }),
  getPlaybackState:   async () => ({ state: 'none' }),
  getActiveTrack:     async () => null,
  getActiveTrackIndex: async () => undefined,
  registerPlaybackService: noopSync,
  addEventListener:   noopSync,
} as unknown as RealModule['default'];

// ── Default export ────────────────────────────────────────────────────────────
const TrackPlayer: RealModule['default'] = _module?.default ?? stubPlayer;
export default TrackPlayer;

// ── Named exports (enum stubs match real numeric values) ─────────────────────
export const Event = _module?.Event ?? ({
  PlaybackState:              'playback-state',
  PlaybackError:              'playback-error',
  PlaybackTrackChanged:       'playback-track-changed',
  PlaybackActiveTrackChanged: 'playback-active-track-changed',
  PlaybackQueueEnded:         'playback-queue-ended',
  PlaybackPlayWhenReadyChanged: 'playback-play-when-ready-changed',
  PlaybackProgressUpdated:    'playback-progress-updated',
  RemotePlay:                 'remote-play',
  RemotePause:                'remote-pause',
  RemoteStop:                 'remote-stop',
  RemoteNext:                 'remote-next',
  RemotePrevious:             'remote-previous',
  RemoteSeek:                 'remote-seek',
} as unknown as RealModule['Event']);

export const Capability = _module?.Capability ?? ({
  Play:           1,
  Pause:          2,
  Stop:           3,
  SeekTo:         4,
  Skip:           5,
  SkipToNext:     6,
  SkipToPrevious: 7,
} as unknown as RealModule['Capability']);

export const State = _module?.State ?? ({
  None:      'none',
  Ready:     'ready',
  Playing:   'playing',
  Paused:    'paused',
  Stopped:   'stopped',
  Buffering: 'buffering',
  Loading:   'loading',
  Error:     'error',
  Ended:     'ended',
} as unknown as RealModule['State']);

export const RepeatMode = _module?.RepeatMode ?? ({
  Off:   0,
  Track: 1,
  Queue: 2,
} as unknown as RealModule['RepeatMode']);

export const AppKilledPlaybackBehavior = _module?.AppKilledPlaybackBehavior ?? ({
  ContinuePlayback:                  0,
  PausePlayback:                     1,
  StopPlaybackAndRemoveNotification: 2,
} as unknown as RealModule['AppKilledPlaybackBehavior']);
