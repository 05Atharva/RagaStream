/**
 * audioPlayer.ts
 *
 * Low-level audio engine: plays exactly one track at a time and reports
 * progress / end-of-track / errors. Queue logic lives in playbackController,
 * so skip, repeat, autoplay and "Play next" behave identically on both paths.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  Native build (EAS / expo run:android)                  │
 * │    → react-native-track-player (lock screen, BT)        │
 * │                                                         │
 * │  Expo Go                                                │
 * │    → expo-av Audio.Sound (basic stream playback)        │
 * └─────────────────────────────────────────────────────────┘
 */
import { usePlayerStore, type Track } from '../store/playerStore';
import TrackPlayer, { Event, State, isTrackPlayerAvailable } from './trackPlayerShim';

type EngineHandlers = {
  onEnded: () => void;
  onError: (error: unknown) => void;
};

let handlers: EngineHandlers = { onEnded: () => {}, onError: () => {} };

/** Registered once by playbackController. */
export function setEngineHandlers(next: EngineHandlers) {
  handlers = next;
}

// Incremented on every load so callbacks from a superseded track are ignored.
let loadToken = 0;
let endedToken = -1;

const setPlayerState = usePlayerStore.setState;

function notifyEnded(token: number) {
  if (token !== loadToken || endedToken === token) return;
  endedToken = token;
  handlers.onEnded();
}

// ── react-native-track-player (native builds) ─────────────────────────────────
if (isTrackPlayerAvailable) {
  TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    setPlayerState({
      isPlaying: event.state === State.Playing,
      isLoading: event.state === State.Loading || event.state === State.Buffering,
    });
  });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
    setPlayerState({ currentPosition: event.position, duration: event.duration });
  });
  // RNTP only ever holds the current track, so "queue ended" == "track ended".
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => notifyEnded(loadToken));
  TrackPlayer.addEventListener(Event.PlaybackError, (error) => handlers.onError(error));
}

// ── expo-av (Expo Go only) ────────────────────────────────────────────────────
type SoundType = import('expo-av').Audio.Sound;
type AudioModule = typeof import('expo-av').Audio;
type AVStatus = import('expo-av').AVPlaybackStatus;

let _Audio: AudioModule | null = null;
let _sound: SoundType | null = null;

if (!isTrackPlayerAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Audio } = require('expo-av') as typeof import('expo-av');
    _Audio = Audio;
    void Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
  } catch {
    _Audio = null;
  }
}

async function unloadSound() {
  const sound = _sound;
  _sound = null;
  if (!sound) return;
  try {
    await sound.stopAsync();
    await sound.unloadAsync();
  } catch {
    // already unloaded
  }
}

function handleAvStatus(token: number, status: AVStatus) {
  if (token !== loadToken) return;
  if (!status.isLoaded) {
    if (status.error) handlers.onError(status.error);
    return;
  }
  setPlayerState({
    isPlaying: status.isPlaying,
    isLoading: status.isBuffering && !status.isPlaying,
    currentPosition: (status.positionMillis ?? 0) / 1000,
    duration: (status.durationMillis ?? 0) / 1000,
  });
  if (status.didJustFinish) notifyEnded(token);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Load a track (its url must be resolved) and start playing it. */
export async function loadAndPlay(track: Track, startPosition = 0): Promise<void> {
  const token = ++loadToken;
  const rate = usePlayerStore.getState().playbackRate;
  setPlayerState({ isLoading: true, currentPosition: startPosition, duration: track.durationSec ?? 0 });

  if (isTrackPlayerAvailable) {
    await TrackPlayer.reset();
    await TrackPlayer.add({ ...track, duration: track.durationSec });
    if (rate !== 1) await TrackPlayer.setRate(rate);
    if (startPosition > 0) await TrackPlayer.seekTo(startPosition);
    await TrackPlayer.play();
    return;
  }

  if (!_Audio) return;
  await unloadSound();
  try {
    const { sound } = await _Audio.Sound.createAsync(
      { uri: track.url },
      {
        shouldPlay: true,
        progressUpdateIntervalMillis: 500,
        positionMillis: startPosition * 1000,
        rate,
        shouldCorrectPitch: false, // "Slowed" should sound slowed, not time-stretched
      },
      (status) => handleAvStatus(token, status)
    );
    if (token !== loadToken) {
      // A newer track started while this one was loading.
      await sound.unloadAsync().catch(() => {});
      return;
    }
    _sound = sound;
  } catch (err) {
    console.error('[audioPlayer] Failed to create sound:', err, 'URL:', track.url?.substring(0, 80));
    setPlayerState({ isLoading: false });
    throw err;
  }
}

export async function pausePlayback(): Promise<void> {
  setPlayerState({ isPlaying: false });
  if (isTrackPlayerAvailable) {
    await TrackPlayer.pause();
    return;
  }
  await _sound?.pauseAsync().catch(() => {});
}

export async function resumePlayback(): Promise<void> {
  setPlayerState({ isPlaying: true });
  if (isTrackPlayerAvailable) {
    await TrackPlayer.play();
    return;
  }
  await _sound?.playAsync().catch(() => {});
}

/** Seek to a position in seconds. */
export async function seekTo(positionSeconds: number): Promise<void> {
  setPlayerState({ currentPosition: positionSeconds });
  if (isTrackPlayerAvailable) {
    await TrackPlayer.seekTo(positionSeconds);
    return;
  }
  await _sound?.setPositionAsync(positionSeconds * 1000).catch(() => {});
}

export async function setRate(rate: number): Promise<void> {
  setPlayerState({ playbackRate: rate });
  if (isTrackPlayerAvailable) {
    await TrackPlayer.setRate(rate);
    return;
  }
  await _sound?.setRateAsync(rate, false).catch(() => {});
}

/** Stop and release all audio resources. */
export async function stopPlayback(): Promise<void> {
  loadToken += 1;
  setPlayerState({ isPlaying: false, isLoading: false });
  if (isTrackPlayerAvailable) {
    await TrackPlayer.reset();
    return;
  }
  await unloadSound();
}

/** True when running in a native build with full TrackPlayer support. */
export { isTrackPlayerAvailable };
