/**
 * audioPlayer.ts
 *
 * Low-level audio engine: plays exactly one track at a time and reports
 * progress / end-of-track / errors. Queue logic lives in playbackController,
 * so skip, repeat, autoplay and "Play next" behave the same everywhere.
 *
 * One engine for Expo Go and installed builds: expo-audio's AudioPlayer.
 * (react-native-track-player was removed: it doesn't support the New
 * Architecture, which is the only one since SDK 55.) In a build, the player is
 * registered for lock-screen / notification controls, which also keeps Android
 * from stopping background playback after ~3 minutes.
 */
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import { usePlayerStore, type Track } from '../store/playerStore';

type EngineHandlers = {
  onEnded: () => void;
  onError: (error: unknown) => void;
  /** Paused or resumed from outside the app: lock screen, headphones, a phone call. */
  onExternalPlayChange?: (playing: boolean) => void;
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

type ExpoAudio = typeof import('expo-audio');

/** A stream that hasn't loaded by then counts as failed, so the controller retries with a fresh link. */
const LOAD_TIMEOUT_MS = 20_000;

let _audio: ExpoAudio | null = null;
let _player: AudioPlayer | null = null;
let _subscription: { remove: () => void } | null = null;
/** What the app last asked for, so a pause we didn't ask for can be told apart. */
let _wantPlaying = false;
let _reportedPlaying: boolean | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _audio = require('expo-audio') as ExpoAudio;
  void _audio
    .setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix', // a music app takes audio focus; required for lock-screen controls
    })
    .catch(() => {});
} catch {
  _audio = null;
}

function releasePlayer() {
  const player = _player;
  _player = null;
  _subscription?.remove();
  _subscription = null;
  _reportedPlaying = null;
  if (!player) return;
  try {
    player.clearLockScreenControls();
  } catch {
    // not active, or not supported here
  }
  try {
    player.pause();
    player.remove();
  } catch {
    // already released
  }
}

function handleStatus(token: number, status: AudioStatus) {
  if (token !== loadToken) return;
  if (status.error) {
    handlers.onError(status.error);
    return;
  }
  if (!status.isLoaded) return;
  setPlayerState({
    isPlaying: status.playing,
    isLoading: status.isBuffering && !status.playing,
    currentPosition: status.currentTime || 0,
    duration: status.duration || 0,
  });
  if (status.didJustFinish) {
    notifyEnded(token);
    return;
  }
  // A settled play/pause change the app didn't ask for came from outside.
  if (!status.isBuffering && status.playing !== _reportedPlaying) {
    _reportedPlaying = status.playing;
    if (status.playing !== _wantPlaying) {
      _wantPlaying = status.playing;
      handlers.onExternalPlayChange?.(status.playing);
    }
  }
}

/** Resolves once the stream is ready, rejects on a load error or after LOAD_TIMEOUT_MS. */
function waitUntilLoaded(player: AudioPlayer): Promise<void> {
  if (player.isLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Audio took too long to load'));
    }, LOAD_TIMEOUT_MS);
    const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.error || status.isLoaded) {
        clearTimeout(timer);
        sub.remove();
        if (status.error) reject(new Error(status.error));
        else resolve();
      }
    });
  });
}

/** Lock screen / notification controls. Best effort: Expo Go and some devices may not support it. */
function showOnLockScreen(player: AudioPlayer, track: Track) {
  try {
    player.setActiveForLockScreen(
      true,
      { title: track.title, artist: track.artist, albumTitle: track.album, artworkUrl: track.artwork || undefined },
      { showSeekForward: false, showSeekBackward: false },
    );
  } catch {
    // lock-screen controls unavailable: playback still works
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Load a track (its url must be resolved) and start playing it. */
export async function loadAndPlay(track: Track, startPosition = 0): Promise<void> {
  const token = ++loadToken;
  const rate = usePlayerStore.getState().playbackRate;
  setPlayerState({ isLoading: true, currentPosition: startPosition, duration: track.durationSec ?? 0 });

  if (!_audio) return;
  releasePlayer();
  const player = _audio.createAudioPlayer({ uri: track.url }, { updateInterval: 500 });
  _player = player;
  try {
    await waitUntilLoaded(player);
    if (token !== loadToken) return; // a newer track took over (it already released this player)
    player.shouldCorrectPitch = false; // "Slowed" should sound slowed, not time-stretched
    if (rate !== 1) player.setPlaybackRate(rate);
    if (startPosition > 0) await player.seekTo(startPosition);
    if (token !== loadToken) return;
    _subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => handleStatus(token, status));
    _wantPlaying = true;
    player.play();
    showOnLockScreen(player, track);
  } catch (err) {
    if (token !== loadToken) return;
    console.error('[audioPlayer] Failed to load audio:', err, 'URL:', track.url?.substring(0, 80));
    releasePlayer();
    setPlayerState({ isLoading: false });
    throw err;
  }
}

export async function pausePlayback(): Promise<void> {
  _wantPlaying = false;
  setPlayerState({ isPlaying: false });
  _player?.pause();
}

export async function resumePlayback(): Promise<void> {
  _wantPlaying = true;
  setPlayerState({ isPlaying: true });
  _player?.play();
}

/** Seek to a position in seconds. */
export async function seekTo(positionSeconds: number): Promise<void> {
  setPlayerState({ currentPosition: positionSeconds });
  await _player?.seekTo(positionSeconds).catch(() => {});
}

export async function setRate(rate: number): Promise<void> {
  setPlayerState({ playbackRate: rate });
  if (!_player) return;
  _player.shouldCorrectPitch = false;
  _player.setPlaybackRate(rate);
}

/** Stop and release all audio resources. */
export async function stopPlayback(): Promise<void> {
  loadToken += 1;
  _wantPlaying = false;
  setPlayerState({ isPlaying: false, isLoading: false });
  releasePlayer();
}

/** False when no track is loaded (released, failed, or never started). */
export function hasLoadedTrack(): boolean {
  return _player !== null;
}
