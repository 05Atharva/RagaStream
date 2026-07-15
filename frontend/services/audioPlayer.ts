/**
 * audioPlayer.ts
 *
 * Unified audio playback service.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  Native build (EAS / expo run:android)                  │
 * │    → react-native-track-player (lock screen, BT, queue) │
 * │                                                         │
 * │  Expo Go                                                │
 * │    → expo-av Audio.Sound (basic stream playback)        │
 * └─────────────────────────────────────────────────────────┘
 */
import { NativeModules } from 'react-native';
import { usePlayerStore, type Track } from '../store/playerStore';
import TrackPlayer, { isTrackPlayerAvailable } from './trackPlayerShim';

// ── expo-av setup (Expo Go only) ──────────────────────────────────────────────
type SoundType = import('expo-av').Audio.Sound;
type AudioModule = typeof import('expo-av').Audio;

let _Audio: AudioModule | null = null;
let _currentSound: SoundType | null = null;
let _isPlaying = false;
let _onPlaybackStatusUpdate: ((isPlaying: boolean, position: number, duration: number) => void) | null = null;

// Only initialise expo-av when RNTP is absent (i.e. in Expo Go)
if (!isTrackPlayerAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Audio } = require('expo-av') as typeof import('expo-av');
    _Audio = Audio;
    // Allow audio to play in silent mode / background
    void Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
  } catch {
    _Audio = null;
  }
}

async function _stopCurrentSound() {
  if (_currentSound) {
    try {
      await _currentSound.stopAsync();
      await _currentSound.unloadAsync();
    } catch {
      // ignore
    }
    _currentSound = null;
  }
  _isPlaying = false;
}

// Expo Go (expo-av) has no built-in queue, so track-completion — repeat one,
// repeat all, and plain auto-advance — has to be driven manually here.
// react-native-track-player handles all of this natively, so this is a
// no-op on that path.
async function _handleTrackFinished(): Promise<void> {
  const { repeatMode, queue, currentTrack } = usePlayerStore.getState();

  if (repeatMode === 'one') {
    if (_currentSound) {
      await _currentSound.setPositionAsync(0).catch(() => {});
      await _currentSound.playAsync().catch(() => {});
    }
    return;
  }

  const currentIndex = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;
  let nextIndex = currentIndex + 1;
  if (nextIndex >= queue.length) {
    if (repeatMode === 'all' && queue.length > 0) {
      nextIndex = 0;
    } else {
      return;
    }
  }

  const nextTrack = queue[nextIndex];
  if (!nextTrack) return;

  usePlayerStore.setState({ currentTrack: nextTrack, isPlaying: true, currentPosition: 0 });
  await playTrack(nextTrack);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Play a track. Uses RNTP in native builds, expo-av in Expo Go. */
export async function playTrack(track: Track): Promise<void> {
  if (isTrackPlayerAvailable) {
    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    await TrackPlayer.play();
    return;
  }

  if (!_Audio) return;

  await _stopCurrentSound();

  try {
    const { sound } = await _Audio.Sound.createAsync(
      { uri: track.url },
      { shouldPlay: true, progressUpdateIntervalMillis: 1000 },
      (status) => {
        if (status.isLoaded) {
          _isPlaying = status.isPlaying;
          if (_onPlaybackStatusUpdate) {
            _onPlaybackStatusUpdate(
              status.isPlaying,
              (status.positionMillis ?? 0) / 1000,
              (status.durationMillis ?? 0) / 1000
            );
          }
          if (status.didJustFinish) {
            void _handleTrackFinished();
          }
        }
      }
    );
    _currentSound = sound;
    _isPlaying = true;
  } catch (err) {
    console.error('[audioPlayer] Failed to create sound:', err, 'URL:', track.url?.substring(0, 80));
    throw err;
  }
}

/** Pause current playback. */
export async function pausePlayback(): Promise<void> {
  if (isTrackPlayerAvailable) {
    await TrackPlayer.pause();
    return;
  }
  if (_currentSound) {
    await _currentSound.pauseAsync().catch(() => {});
    _isPlaying = false;
  }
}

/** Resume current playback. */
export async function resumePlayback(): Promise<void> {
  if (isTrackPlayerAvailable) {
    await TrackPlayer.play();
    return;
  }
  if (_currentSound) {
    await _currentSound.playAsync().catch(() => {});
    _isPlaying = true;
  }
}

/** Toggle play/pause. Returns the new isPlaying state. */
export async function togglePlayback(): Promise<boolean> {
  if (isTrackPlayerAvailable) {
    const state = await TrackPlayer.getPlaybackState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playing = (state as any).state === 'playing';
    if (playing) {
      await TrackPlayer.pause();
      return false;
    }
    await TrackPlayer.play();
    return true;
  }

  if (_isPlaying) {
    await pausePlayback();
    return false;
  }
  await resumePlayback();
  return true;
}

/** Seek to a position in seconds. */
export async function seekTo(positionSeconds: number): Promise<void> {
  if (isTrackPlayerAvailable) {
    await TrackPlayer.seekTo(positionSeconds);
    return;
  }
  if (_currentSound) {
    await _currentSound.setPositionAsync(positionSeconds * 1000).catch(() => {});
  }
}

/** Stop and release all audio resources. */
export async function stopPlayback(): Promise<void> {
  if (isTrackPlayerAvailable) {
    await TrackPlayer.stop();
    return;
  }
  await _stopCurrentSound();
}

/** Register a callback for playback progress updates (Expo Go only). */
export function onPlaybackProgress(
  cb: (isPlaying: boolean, position: number, duration: number) => void
) {
  _onPlaybackStatusUpdate = cb;
}

/** Whether audio is currently playing. */
export function getIsPlaying(): boolean {
  return _isPlaying;
}

/** True when running in a native build with full TrackPlayer support. */
export { isTrackPlayerAvailable };
