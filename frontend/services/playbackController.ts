/**
 * playbackController.ts
 *
 * The single place that decides *what* plays. Screens call playSongs() /
 * startRadio() / addToQueue(); the controller resolves stream URLs lazily,
 * walks the queue, and hands one track at a time to the audio engine.
 *
 * Queue model (mirrors Spotify):
 *   queue / currentIndex  — the context being played (playlist, liked, radio…)
 *   userQueue             — "Next in queue": plays before the context continues
 *   isAutoplay tracks     — appended from song radio when the context runs out
 *   isRecommendation      — Smart Shuffle picks mixed into the upcoming context
 */
import Toast from './toast';
import { apiClient } from './apiClient';
import { RateLimitedError, isRateLimited, retryAfterSeconds, waitPhrase } from './rateLimit';
import { queryClient } from './queryClient';
import { ensureSongInCatalogue } from './songService';
import { recordPlayHistory } from './historyService';
import * as engine from './audioPlayer';
import * as recs from './recsService';
import { flushEvents, logEvent, logSongEvent } from './eventLog';
import { hideSong } from './libraryActions';
import {
  usePlayerStore,
  type PlaybackContext,
  type RepeatModeValue,
  type Surface,
  type Track,
} from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';

export type SongInput = {
  id?: string | null; // catalogue UUID when known
  youtube_id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
  /** Set when a /recs call produced the song: its slate, the reason to show, where it was served. */
  recId?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  surface?: Surface;
};

/** Shape returned by /youtube/search and /youtube/radio. */
export type YouTubeResult = {
  youtube_id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
};

const get = usePlayerStore.getState;
const set = usePlayerStore.setState;

const PREVIOUS_RESTART_THRESHOLD_SEC = 3;
const SMART_SHUFFLE_EVERY = 3;
const MAX_SKIP_ATTEMPTS = 3;
const COMPLETE_RATIO = 0.8; // listened this much = a complete, not a skip
const QUICK_SKIP_RATIO = 0.5; // a skip before this counts against the recommendation
const STEER_GUARD_MS = 60_000;
const RECS_ID_CAP = 200;

/** Where a song came from, by the context it was played in. */
const CONTEXT_SURFACE: Record<PlaybackContext['type'], Surface> = {
  playlist: 'playlist',
  liked: 'liked',
  search: 'search',
  channel: 'channel',
  home: 'home',
  radio: 'radio',
  queue: 'queue',
};

// ── Conversions ───────────────────────────────────────────────────────────────

let queueIdCounter = 0;
const nextQueueId = () => `q${Date.now().toString(36)}${(queueIdCounter++).toString(36)}`;

export const getYoutubeId = (track: Pick<Track, 'youtubeId' | 'youtube_id'>) =>
  track.youtubeId || track.youtube_id || '';

export const thumbnailFor = (youtubeId: string) => `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

export function fromYouTube(result: YouTubeResult): SongInput {
  return {
    youtube_id: result.youtube_id,
    title: result.title,
    channel_name: result.channel,
    thumbnail_url: result.thumbnail,
    duration_sec: result.duration,
  };
}

export function songToTrack(song: SongInput, album = 'RagaStream'): Track {
  const thumbnail = song.thumbnail_url || thumbnailFor(song.youtube_id);
  const channel = song.channel_name || 'Unknown';
  return {
    id: song.id || song.youtube_id,
    title: song.title,
    artist: channel,
    album,
    artwork: thumbnail,
    url: '',
    source: 'youtube',
    youtubeId: song.youtube_id,
    channelName: channel,
    thumbnailUrl: thumbnail,
    durationSec: song.duration_sec || undefined,
    queueId: nextQueueId(),
    surface: song.surface,
    recId: song.recId || undefined,
    reason: song.reason || undefined,
  };
}

export function trackToSong(track: Track): SongInput {
  const youtubeId = getYoutubeId(track);
  return {
    id: track.id !== youtubeId ? track.id : null,
    youtube_id: youtubeId,
    title: track.title,
    channel_name: track.channelName || track.channel_name || track.artist,
    thumbnail_url: track.thumbnailUrl || track.thumbnail_url || track.artwork,
    duration_sec: track.durationSec ?? null,
    recId: track.recId,
    reason: track.reason,
    surface: track.surface,
  };
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── Stream URLs (resolved lazily, cached, prefetched one ahead) ──────────────

const STREAM_TTL_MS = 60 * 60 * 1000; // YouTube URLs live ~6h; stay well inside
const streamCache = new Map<string, { url: string; expiresAt: number }>();
const streamInflight = new Map<string, Promise<string>>();
/** Until this time (ms) the server is rate-limited by YouTube; set from its Retry-After. */
let streamBusyUntil = 0;

/**
 * Players read audio from our backend relay rather than YouTube directly:
 * YouTube locks each URL to the extracting IP, so a phone that drifts onto
 * mobile data mid-song would get a 403. The backend signs each relay link
 * (players can't send our auth header), valid for 12h. `bust` defeats
 * player-side caching after a fresh extraction.
 */
function relayUrl(audioPath: string, bust = false) {
  const base = (apiClient.defaults?.baseURL ?? '').replace(/\/$/, '');
  return `${base}${audioPath}${bust ? `&v=${Date.now()}` : ''}`;
}

/**
 * Validates the video and warms the backend's extraction cache (fast failure
 * for unavailable songs), then returns the signed relay URL the engine should load.
 */
async function resolveStreamUrl(youtubeId: string, fresh = false): Promise<string> {
  const cached = streamCache.get(youtubeId);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.url;
  const pending = streamInflight.get(youtubeId);
  if (!fresh && pending) return pending;
  // The server said YouTube is rate-limiting it: don't ask again until the wait is over.
  const waitMs = streamBusyUntil - Date.now();
  if (waitMs > 0) throw new RateLimitedError(Math.ceil(waitMs / 1000));

  const request = apiClient
    .get<{ audio_path: string }>('/youtube/stream', { params: { id: youtubeId, fresh: fresh || undefined } })
    .then(({ data }) => {
      const url = relayUrl(data.audio_path, fresh);
      streamCache.set(youtubeId, { url, expiresAt: Date.now() + STREAM_TTL_MS });
      return url;
    })
    .catch((error: unknown) => {
      if (isRateLimited(error)) {
        const wait = retryAfterSeconds(error);
        streamBusyUntil = Date.now() + wait * 1000;
        throw new RateLimitedError(wait);
      }
      throw error;
    })
    .finally(() => streamInflight.delete(youtubeId));
  streamInflight.set(youtubeId, request);
  return request;
}

function upNextTrack(): Track | undefined {
  const { userQueue, queue, currentIndex } = get();
  return userQueue[0] ?? queue[currentIndex + 1];
}

function prefetchUpcoming() {
  const next = upNextTrack();
  if (next) void resolveStreamUrl(getYoutubeId(next)).catch(() => {});
}

// ── Radio ─────────────────────────────────────────────────────────────────────

export async function fetchRadio(youtubeId: string, limit = 25): Promise<SongInput[]> {
  const { data } = await apiClient.get<YouTubeResult[]>('/youtube/radio', {
    params: { id: youtubeId, limit },
  });
  return data.filter((r) => !recs.isHiddenLocally(r.youtube_id, r.channel)).map(fromYouTube);
}

/** Radio from the recommendation engine; falls back to YouTube's own radio on any error. */
async function radioSongs(youtubeId: string, limit: number): Promise<SongInput[]> {
  try {
    const songs = recs.slateSongs(await recs.fetchRadioSlate(youtubeId, limit));
    if (songs.length > 0) return songs;
  } catch {
    // fall through to YouTube radio
  }
  return fetchRadio(youtubeId, limit);
}

/** Every youtube_id queued or played in this session, newest last (for `exclude`). */
function queuedIds(): string[] {
  const { queue, userQueue } = get();
  return [...new Set([...queue, ...userQueue].map(getYoutubeId))].slice(-RECS_ID_CAP);
}

// ── Listening events ──────────────────────────────────────────────────────────
// start when a track really begins; skip or complete when it is left; complete
// when the engine reports the end. previous() restarting the same track is none of these.

type Listen = { track: Track; maxPos: number };
let listen: Listen | null = null;
let recSkipStreak = 0;
let lastSteerAt = -Infinity;

function emitListen(event: 'start' | 'skip' | 'complete', track: Track, listenedSec?: number, durationSec?: number) {
  const youtubeId = getYoutubeId(track);
  logEvent({
    youtube_id: youtubeId,
    event,
    surface: track.surface,
    context_id: get().context?.id,
    rec_id: track.recId,
    song_id: track.id !== youtubeId ? track.id : undefined,
    listened_sec: listenedSec === undefined ? undefined : Math.round(listenedSec * 10) / 10,
    duration_sec: durationSec || undefined,
  });
}

function beginListen(track: Track) {
  listen = { track, maxPos: 0 };
  emitListen('start', track, undefined, track.durationSec ?? get().duration);
}

/** The listener moved on: a skip, or a complete if they heard at least 80%. */
function closeListen() {
  const l = listen;
  if (!l) return;
  listen = null;
  const state = get();
  const same = state.currentTrack?.queueId === l.track.queueId;
  const listened = Math.max(l.maxPos, same ? state.currentPosition : 0);
  const duration = l.track.durationSec || (same ? state.duration : 0) || 0;
  const ratio = listened / (duration > 0 ? duration : 180);
  const done = ratio >= COMPLETE_RATIO;
  emitListen(done ? 'complete' : 'skip', l.track, listened, duration);
  noteOutcome(l.track, !done, ratio);
}

/** The engine reported the end of the track on its own. */
function completeListen() {
  const l = listen;
  if (!l) return;
  listen = null;
  const duration = l.track.durationSec || get().duration || 0;
  emitListen('complete', l.track, Math.max(l.maxPos, duration), duration);
  recSkipStreak = 0;
}

usePlayerStore.subscribe((state) => {
  if (!listen || state.currentTrack?.queueId !== listen.track.queueId) return;
  const limit = listen.track.durationSec || state.duration;
  if (limit > 0 && state.currentPosition > limit + 1) return; // stale progress from another track
  if (state.currentPosition > listen.maxPos) listen.maxPos = state.currentPosition;
});

// ── Steering ──────────────────────────────────────────────────────────────────

/** Two quick skips in a row of recommended tracks mean the picks are off: re-pick. */
function noteOutcome(track: Track, skipped: boolean, ratio: number) {
  const isPick = Boolean(track.isAutoplay || track.isRecommendation);
  recSkipStreak = isPick && skipped && ratio < QUICK_SKIP_RATIO ? recSkipStreak + 1 : 0;
  if (recSkipStreak >= 2) void steerQueue();
}

/** Unplayed picks after the current track: Autoplay always, Smart Shuffle only in smart mode. */
function replaceablePicks(state: ReturnType<typeof get>) {
  const upcoming = state.queue.slice(state.currentIndex + 1);
  return {
    autoplay: upcoming.filter((t) => t.isAutoplay),
    smart: state.shuffleMode === 'smart' ? upcoming.filter((t) => t.isRecommendation) : [],
  };
}

async function steerQueue(): Promise<void> {
  const before = replaceablePicks(get());
  if (before.autoplay.length + before.smart.length === 0) return;
  if (Date.now() - lastSteerAt < STEER_GUARD_MS) return;
  lastSteerAt = Date.now();
  recSkipStreak = 0;

  try {
    // The backend reads the session from the skip events, so send them first.
    await flushEvents().catch(() => {});
    const seed = get().currentTrack;
    if (!seed) return;
    const taken = new Set(queuedIds());
    const songs = recs
      .slateSongs(await recs.fetchNext(getYoutubeId(seed), [...taken]))
      .filter((s) => !taken.has(s.youtube_id));
    if (songs.length === 0) return;

    const latest = get();
    const picks = replaceablePicks(latest);
    if (picks.autoplay.length + picks.smart.length === 0) return;
    const smartTracks = songs
      .slice(0, picks.smart.length)
      .map((song) => ({ ...songToTrack(song, 'Smart Shuffle'), isRecommendation: true, surface: 'smart_shuffle' as Surface }));
    const autoTracks = songs
      .slice(smartTracks.length, smartTracks.length + picks.autoplay.length)
      .map((song) => ({ ...songToTrack(song, 'Autoplay'), isAutoplay: true, surface: 'autoplay' as Surface }));

    const drop = new Set(picks.autoplay.map((t) => t.queueId));
    const smartSlots = new Set(picks.smart.map((t) => t.queueId));
    const fresh = [...smartTracks];
    const played = latest.queue.slice(0, latest.currentIndex + 1);
    const upcoming: Track[] = [];
    latest.queue.slice(latest.currentIndex + 1).forEach((t) => {
      if (drop.has(t.queueId)) return;
      if (smartSlots.has(t.queueId)) {
        const replacement = fresh.shift();
        if (replacement) upcoming.push(replacement);
        return;
      }
      upcoming.push(t);
    });
    set({
      queue: [...played, ...upcoming, ...autoTracks],
      originalQueue: latest.originalQueue
        ? [...latest.originalQueue.filter((t) => !drop.has(t.queueId)), ...autoTracks]
        : null,
    });
    prefetchUpcoming();
    Toast.show({ type: 'info', text1: 'Tuning your queue' });
  } catch {
    // keep the current picks
  }
}

// ── Track lifecycle ───────────────────────────────────────────────────────────

function patchTrack(queueId: string | undefined, patch: Partial<Track>) {
  if (!queueId) return;
  const apply = (t: Track) => (t.queueId === queueId ? { ...t, ...patch } : t);
  set((state) => ({
    queue: state.queue.map(apply),
    userQueue: state.userQueue.map(apply),
    originalQueue: state.originalQueue?.map(apply) ?? null,
    currentTrack: state.currentTrack ? apply(state.currentTrack) : null,
  }));
}

/** Catalogue the song (so it can be liked / playlisted) and record the play. */
async function onTrackStarted(track: Track) {
  const youtubeId = getYoutubeId(track);
  let songId = track.id;
  if (songId === youtubeId) {
    try {
      songId = await ensureSongInCatalogue({
        youtube_id: youtubeId,
        title: track.title,
        channel_name: track.channelName || track.artist,
        thumbnail_url: track.thumbnailUrl || track.artwork || '',
        duration_sec: track.durationSec ?? 0,
      });
      patchTrack(track.queueId, { id: songId });
    } catch {
      return;
    }
  }
  if (useSettingsStore.getState().privateSession) return;
  void recordPlayHistory(songId).then(() => {
    void queryClient.invalidateQueries({ queryKey: ['history'] });
  });
}

let playToken = 0;

async function startTrack(track: Track, index: number, fromUserQueue = false, startPosition = 0) {
  const token = ++playToken;
  closeListen();
  beginTrackWatch();
  set({
    currentTrack: track,
    currentIndex: index,
    playingFromUserQueue: fromUserQueue,
    isLoading: true,
    isPlaying: true,
    currentPosition: startPosition,
    duration: track.durationSec ?? 0,
  });
  const youtubeId = getYoutubeId(track);
  const url = await resolveStreamUrl(youtubeId);
  if (token !== playToken) return;
  try {
    await engine.loadAndPlay({ ...track, url }, startPosition);
  } catch {
    // Cached links can go stale or be rejected by YouTube (403). Fetch a
    // fresh one, bypassing both caches, and try once more before giving up.
    if (token !== playToken) return;
    streamCache.delete(youtubeId);
    const freshUrl = await resolveStreamUrl(youtubeId, true);
    if (token !== playToken) return;
    await engine.loadAndPlay({ ...track, url: freshUrl }, startPosition);
  }
  if (token !== playToken) return;
  beginListen(track);
  void onTrackStarted(track);
  prefetchUpcoming();
  void maybeExtendWithAutoplay();
}

/** The server is rate-limited by YouTube: say so, and when to try again. */
function toastRateLimited(error: unknown) {
  Toast.show({
    type: 'info',
    text1: 'YouTube is busy',
    text2: `It's limiting requests right now. Try again in ${waitPhrase(retryAfterSeconds(error))}.`,
  });
}

/** Start a track; on failure, skip forward (bounded) instead of stalling. */
async function startOrSkip(track: Track, index: number, fromUserQueue: boolean, attempt = 0): Promise<void> {
  try {
    await startTrack(track, index, fromUserQueue);
  } catch (error) {
    set({ isLoading: false });
    // Rate-limited: every next track would fail the same way, and each try
    // adds to the limit. Stop here and say when to try again.
    if (isRateLimited(error)) {
      set({ isPlaying: false });
      toastRateLimited(error);
      return;
    }
    if (attempt + 1 >= MAX_SKIP_ATTEMPTS) {
      set({ isPlaying: false });
      Toast.show({ type: 'error', text1: 'Playback stopped', text2: 'Several tracks in a row were unavailable.' });
      return;
    }
    Toast.show({ type: 'info', text1: `Skipped "${track.title}"`, text2: 'This track is unavailable.' });
    await advance(attempt + 1);
  }
}

// ── Public API: starting playback ────────────────────────────────────────────

type PlayOptions = {
  /** true = "Shuffle play" (random first track); false = force in-order. */
  shuffle?: boolean;
  /** Artwork shown for this context under "Jump back in". */
  thumbnail?: string | null;
};

export async function playSongs(
  songs: SongInput[],
  startIndex: number,
  context: PlaybackContext,
  options: PlayOptions = {}
): Promise<void> {
  if (songs.length === 0) return;
  const tracks = songs.map((song) => ({
    ...songToTrack(song, context.name),
    surface: song.surface ?? CONTEXT_SURFACE[context.type],
  }));
  const start = Math.min(Math.max(startIndex, 0), tracks.length - 1);
  const previousMode = get().shuffleMode;
  const shuffleOn = options.shuffle ?? previousMode !== 'off';

  let queue = tracks;
  if (options.shuffle) {
    queue = shuffleArray(tracks);
  } else if (shuffleOn) {
    queue = [tracks[start], ...shuffleArray(tracks.filter((_, i) => i !== start))];
  }
  const index = shuffleOn ? 0 : start;

  set({
    queue,
    currentIndex: index,
    context,
    shuffleMode: shuffleOn ? (previousMode === 'smart' ? 'smart' : 'shuffle') : 'off',
    originalQueue: shuffleOn ? tracks : null,
  });

  if (context.type === 'playlist' || context.type === 'liked' || context.type === 'channel' || context.type === 'radio') {
    useSettingsStore.getState().recordContext({
      type: context.type,
      id: context.id ?? context.name,
      name: context.name,
      thumbnail: options.thumbnail ?? songs[0]?.thumbnail_url ?? null,
    });
  }

  try {
    await startTrack(queue[index], index);
  } catch (err) {
    set({ isLoading: false, isPlaying: false });
    throw err;
  }
  if (get().shuffleMode === 'smart') void addSmartRecommendations();
}

/** Song radio: the song followed by related tracks. `name` overrides "<title> Radio" (e.g. mixes). */
export async function startRadio(song: SongInput, name?: string): Promise<void> {
  const related = await radioSongs(song.youtube_id, 30);
  await playSongs([{ ...song, surface: 'radio' as const }, ...related.map((r) => ({ ...r, surface: 'radio' as const }))], 0, {
    type: 'radio',
    name: name ?? `${song.title} Radio`,
    id: song.youtube_id,
  }, { shuffle: false, thumbnail: song.thumbnail_url });
}

// ── Public API: transport ────────────────────────────────────────────────────

async function advance(attempt = 0): Promise<void> {
  const state = get();
  if (state.userQueue.length > 0) {
    const [nextTrack, ...rest] = state.userQueue;
    set({ userQueue: rest });
    await startOrSkip(nextTrack, state.currentIndex, true, attempt);
    return;
  }

  let index = state.currentIndex + 1;
  if (index >= state.queue.length) {
    if (state.repeatMode === 'all' && state.queue.length > 0) {
      index = 0;
    } else {
      const extended = await maybeExtendWithAutoplay(true);
      index = get().currentIndex + 1;
      if (!extended || index >= get().queue.length) {
        await pause();
        return;
      }
    }
  }
  await startOrSkip(get().queue[index], index, false, attempt);
}

/** Skip to the next track. `auto` = the current track finished on its own. */
export async function next({ auto = false }: { auto?: boolean } = {}): Promise<void> {
  const state = get();
  if (!state.currentTrack) return;

  if (auto && state.sleepTimer.endOfTrack) {
    cancelSleepTimer();
    await pause();
    Toast.show({ type: 'info', text1: 'Sleep timer ended', text2: 'Playback paused' });
    return;
  }
  if (auto && state.repeatMode === 'one') {
    await engine.seekTo(0);
    await engine.resumePlayback();
    beginListen(state.currentTrack);
    void onTrackStarted(state.currentTrack);
    return;
  }
  await advance();
}

export async function previous(): Promise<void> {
  const state = get();
  if (!state.currentTrack) return;
  const atContextStart = state.currentIndex <= 0 && !state.playingFromUserQueue;
  if (state.currentPosition > PREVIOUS_RESTART_THRESHOLD_SEC || atContextStart) {
    await engine.seekTo(0);
    return;
  }
  // From a user-queued track, "previous" returns to the context track we left.
  const index = state.playingFromUserQueue ? state.currentIndex : state.currentIndex - 1;
  await startOrSkip(state.queue[index], index, false);
}

export async function togglePlay(): Promise<void> {
  const state = get();
  if (!state.currentTrack) return;
  if (state.isPlaying) {
    // Pausing a song that had silently stalled: remember to reload on resume.
    if (isStalled()) needsReload = true;
    await pause();
    return;
  }
  if (needsReload || !engine.hasLoadedTrack()) {
    needsReload = false;
    await reloadCurrent();
    return;
  }
  setIntent(true);
  await engine.resumePlayback();
}

/** Pause and record that the user (or the app) chose silence. */
async function pause() {
  setIntent(false);
  await engine.pausePlayback();
}

/** Reload the current track at its position from a freshly extracted URL. */
async function reloadCurrent(): Promise<void> {
  const state = get();
  const track = state.currentTrack;
  if (!track) return;
  setIntent(true);
  set({ isLoading: true, isPlaying: true });
  try {
    const url = await resolveStreamUrl(getYoutubeId(track), true);
    await engine.loadAndPlay({ ...track, url }, state.currentPosition);
  } catch (error) {
    set({ isLoading: false, isPlaying: false });
    if (isRateLimited(error)) toastRateLimited(error);
    else Toast.show({ type: 'error', text1: "Couldn't resume this song", text2: 'Check your connection, then press play again.' });
  }
}

export async function seek(positionSeconds: number): Promise<void> {
  await engine.seekTo(positionSeconds);
}

export async function stop(): Promise<void> {
  setIntent(false);
  await engine.stopPlayback();
}

/**
 * Sign-out: stop the music and forget everything about the session. Silent
 * (no listening event is logged for the track that was playing: the listener
 * didn't choose to leave it, and the account is gone).
 */
export async function resetPlayback(): Promise<void> {
  playToken += 1; // any startTrack still resolving a URL gives up
  autoplayEpoch += 1;
  autoplayInflight = null;
  listen = null;
  recSkipStreak = 0;
  recovering = false;
  setIntent(false);
  cancelSleepTimer();
  streamCache.clear();
  streamInflight.clear();
  set({
    currentTrack: null,
    queue: [],
    userQueue: [],
    currentIndex: -1,
    playingFromUserQueue: false,
    context: null,
    originalQueue: null,
    isPlaying: false,
    isLoading: false,
    currentPosition: 0,
    duration: 0,
    showReconnecting: false,
  });
  try {
    await engine.stopPlayback();
  } catch {
    // nothing loaded, or the player is already gone
  }
}

/** Jump straight to an entry in the queue sheet. */
export async function playQueueItem(queueId: string): Promise<void> {
  const state = get();
  const userIndex = state.userQueue.findIndex((t) => t.queueId === queueId);
  if (userIndex >= 0) {
    const target = state.userQueue[userIndex];
    set({ userQueue: state.userQueue.slice(userIndex + 1) });
    await startOrSkip(target, state.currentIndex, true);
    return;
  }
  const index = state.queue.findIndex((t) => t.queueId === queueId);
  if (index >= 0) await startOrSkip(state.queue[index], index, false);
}

// ── Public API: queue editing ────────────────────────────────────────────────

/** Spotify "Add to queue": appended to "Next in queue". */
export async function addToQueue(song: SongInput): Promise<void> {
  logSongEvent('queue', song);
  const track = { ...songToTrack(song, 'Queue'), surface: 'queue' as const };
  if (!get().currentTrack) {
    await playSongs([song], 0, { type: 'queue', name: 'Queue' });
    return;
  }
  set((state) => ({ userQueue: [...state.userQueue, track] }));
  prefetchUpcoming();
}

/** "Play next": jumps to the front of "Next in queue". */
export async function playNext(song: SongInput): Promise<void> {
  logSongEvent('queue', song);
  const track = { ...songToTrack(song, 'Queue'), surface: 'queue' as const };
  if (!get().currentTrack) {
    await playSongs([song], 0, { type: 'queue', name: 'Queue' });
    return;
  }
  set((state) => ({ userQueue: [track, ...state.userQueue] }));
  prefetchUpcoming();
}

export function removeFromQueue(queueId: string) {
  set((state) => {
    const contextIndex = state.queue.findIndex((t) => t.queueId === queueId);
    // Only upcoming context tracks can be removed; history stays intact.
    const removeFromContext = contextIndex > state.currentIndex;
    return {
      userQueue: state.userQueue.filter((t) => t.queueId !== queueId),
      queue: removeFromContext ? state.queue.filter((t) => t.queueId !== queueId) : state.queue,
      originalQueue: state.originalQueue?.filter((t) => t.queueId !== queueId) ?? null,
    };
  });
}

export function clearUserQueue() {
  set({ userQueue: [] });
}

export function reorderUserQueue(tracks: Track[]) {
  set({ userQueue: tracks });
}

export function reorderUpcoming(tracks: Track[]) {
  set((state) => ({ queue: [...state.queue.slice(0, state.currentIndex + 1), ...tracks] }));
}

// ── Public API: modes ─────────────────────────────────────────────────────────

export function cycleRepeat() {
  const order: RepeatModeValue[] = ['off', 'all', 'one'];
  const current = get().repeatMode;
  set({ repeatMode: order[(order.indexOf(current) + 1) % order.length] });
}

/** Shuffle button cycles off → shuffle → Smart Shuffle → off. */
export async function cycleShuffle(): Promise<void> {
  const state = get();
  if (state.shuffleMode === 'off') {
    const played = state.queue.slice(0, state.currentIndex + 1);
    const upcoming = state.queue.slice(state.currentIndex + 1);
    set({
      shuffleMode: 'shuffle',
      originalQueue: state.queue,
      queue: [...played, ...shuffleArray(upcoming)],
    });
    return;
  }
  if (state.shuffleMode === 'shuffle') {
    set({ shuffleMode: 'smart' });
    void addSmartRecommendations();
    return;
  }

  // Back to off: drop recommendations and restore context order from the current track.
  const current = state.currentTrack;
  const original = (state.originalQueue ?? state.queue).filter((t) => !t.isRecommendation);
  let queue = original;
  let index = current ? original.findIndex((t) => t.queueId === current.queueId) : -1;
  if (index === -1) {
    const playedIds = new Set(state.queue.slice(0, state.currentIndex + 1).map((t) => t.queueId));
    const played = original.filter((t) => playedIds.has(t.queueId));
    const rest = original.filter((t) => !playedIds.has(t.queueId));
    queue = current ? [...played, current, ...rest] : original;
    index = current ? played.length : 0;
  }
  set({ shuffleMode: 'off', originalQueue: null, queue, currentIndex: index });
}

/** Smart Shuffle candidates from the engine; falls back to YouTube radio around a few seeds. */
async function smartPool(state: ReturnType<typeof get>): Promise<SongInput[]> {
  const contextTracks = state.queue.filter((t) => !t.isRecommendation);
  try {
    const slate = await recs.fetchShuffle({
      current: state.currentTrack ? getYoutubeId(state.currentTrack) : null,
      context: contextTracks.map(getYoutubeId),
      exclude: queuedIds(),
      limit: 15,
    });
    const songs = recs.slateSongs(slate);
    if (songs.length > 0) return songs;
  } catch {
    // fall through to YouTube radio
  }
  const seeds = [state.currentTrack, ...shuffleArray(contextTracks).slice(0, 2)]
    .filter((t): t is Track => Boolean(t))
    .map(getYoutubeId);
  const uniqueSeeds = [...new Set(seeds)].slice(0, 3);
  const results = await Promise.allSettled(uniqueSeeds.map((id) => fetchRadio(id, 12)));
  const songs: SongInput[] = [];
  for (const result of results) if (result.status === 'fulfilled') songs.push(...result.value);
  return shuffleArray(songs);
}

async function addSmartRecommendations() {
  const pool = await smartPool(get());
  const latest = get();
  if (latest.shuffleMode !== 'smart') return;

  const present = new Set(latest.queue.map(getYoutubeId));
  const picks: Track[] = [];
  for (const song of pool) {
    if (present.has(song.youtube_id)) continue;
    present.add(song.youtube_id);
    picks.push({ ...songToTrack(song, 'Smart Shuffle'), isRecommendation: true, surface: 'smart_shuffle' });
  }

  const upcoming = latest.queue.slice(latest.currentIndex + 1);
  const wanted = Math.min(Math.ceil(upcoming.length / SMART_SHUFFLE_EVERY) || 3, 15);
  const recommendations = picks.slice(0, wanted);
  if (recommendations.length === 0) return;

  const mixed: Track[] = [];
  upcoming.forEach((track, i) => {
    mixed.push(track);
    if ((i + 1) % SMART_SHUFFLE_EVERY === 0 && recommendations.length) mixed.push(recommendations.shift()!);
  });
  mixed.push(...recommendations);
  set({ queue: [...latest.queue.slice(0, latest.currentIndex + 1), ...mixed] });
  Toast.show({ type: 'success', text1: 'Smart Shuffle on', text2: 'Recommendations added to your queue' });
}

/** Remove a Smart Shuffle / Autoplay pick and stop recommending it. */
export function removeRecommendation(track: Track) {
  if (track.queueId) removeFromQueue(track.queueId);
  void hideSong({ youtube_id: getYoutubeId(track), title: track.title });
}

// ── Autoplay ──────────────────────────────────────────────────────────────────

let autoplayInflight: Promise<boolean> | null = null;
/** Bumped by resetPlayback() so an autoplay fetch that was in flight drops its result. */
let autoplayEpoch = 0;

/**
 * When the last context track is playing (or `force`), append related songs so
 * music keeps going. Returns true if anything was added.
 */
async function maybeExtendWithAutoplay(force = false): Promise<boolean> {
  const state = get();
  if (!useSettingsStore.getState().autoplay || state.repeatMode === 'all') return false;
  if (!force && state.currentIndex < state.queue.length - 1) return false;
  if (autoplayInflight) return autoplayInflight;

  const seed = state.queue[state.queue.length - 1] ?? state.currentTrack;
  if (!seed) return false;

  const epoch = autoplayEpoch;
  autoplayInflight = (async () => {
    try {
      const recent = new Set(get().queue.map(getYoutubeId));
      let songs: SongInput[] = [];
      try {
        songs = recs
          .slateSongs(await recs.fetchNext(getYoutubeId(seed), queuedIds()))
          .filter((s) => !recent.has(s.youtube_id));
      } catch {
        // fall through to YouTube radio
      }
      if (songs.length === 0) {
        songs = (await fetchRadio(getYoutubeId(seed), 20)).filter((s) => !recent.has(s.youtube_id));
      }
      if (songs.length === 0 || epoch !== autoplayEpoch) return false;
      const tracks = songs.map((song) => ({
        ...songToTrack(song, 'Autoplay'),
        isAutoplay: true,
        surface: 'autoplay' as Surface,
      }));
      set((s) => ({
        queue: [...s.queue, ...tracks],
        originalQueue: s.originalQueue ? [...s.originalQueue, ...tracks] : null,
      }));
      prefetchUpcoming();
      return true;
    } catch {
      return false;
    } finally {
      if (epoch === autoplayEpoch) autoplayInflight = null;
    }
  })();
  return autoplayInflight;
}

// ── Sleep timer ───────────────────────────────────────────────────────────────

let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

export function setSleepTimer(minutes: number | 'endOfTrack') {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  sleepTimeout = null;
  if (minutes === 'endOfTrack') {
    set({ sleepTimer: { endsAt: null, endOfTrack: true } });
    Toast.show({ type: 'success', text1: 'Sleep timer set', text2: 'Playback will stop at the end of this track' });
    return;
  }
  const durationMs = minutes * 60 * 1000;
  set({ sleepTimer: { endsAt: Date.now() + durationMs, endOfTrack: false } });
  sleepTimeout = setTimeout(() => {
    cancelSleepTimer();
    void pause();
    Toast.show({ type: 'info', text1: 'Sleep timer ended', text2: 'Playback paused' });
  }, durationMs);
  Toast.show({ type: 'success', text1: `Sleep timer set for ${minutes} minutes` });
}

export function cancelSleepTimer() {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  sleepTimeout = null;
  set({ sleepTimer: { endsAt: null, endOfTrack: false } });
}

// ── Playback speed ────────────────────────────────────────────────────────────

export async function setPlaybackRate(rate: number): Promise<void> {
  useSettingsStore.getState().setPlaybackRate(rate);
  await engine.setRate(rate);
}

const applyStoredRate = () => set({ playbackRate: useSettingsStore.getState().playbackRate });
if (useSettingsStore.persist.hasHydrated()) applyStoredRate();
else useSettingsStore.persist.onFinishHydration(applyStoredRate);

// ── Engine wiring: track end + stream-expiry recovery ────────────────────────

let recovering = false;
let lastRecoveryAt = 0;

async function recoverFromError() {
  const state = get();
  const track = state.currentTrack;
  if (!track || recovering) return;

  // A second failure right after recovering means the track itself is broken.
  if (Date.now() - lastRecoveryAt < 15_000) {
    Toast.show({ type: 'error', text1: 'Could not reconnect', text2: 'Skipping to the next track.' });
    listen = null; // a broken stream says nothing about taste
    await next({ auto: true });
    return;
  }

  recovering = true;
  lastRecoveryAt = Date.now();
  setIntent(true);
  set({ showReconnecting: true });
  try {
    const url = await resolveStreamUrl(getYoutubeId(track), true);
    await engine.loadAndPlay({ ...track, url }, state.currentPosition);
  } catch (error) {
    set({ isPlaying: false });
    if (isRateLimited(error)) toastRateLimited(error);
    else Toast.show({ type: 'error', text1: 'Could not reconnect. Try playing again.' });
  } finally {
    recovering = false;
    set({ showReconnecting: false });
  }
}

// ── Stall watchdog ────────────────────────────────────────────────────────────
// A stream can stop delivering without the player reporting an error (it just
// buffers forever). If we intend to be playing, the song had started, and the
// position hasn't moved for STALL_MS, reconnect at the current position.

const STALL_MS = 9000;
let wantsToPlay = false;
let progressedThisTrack = false;
let needsReload = false;
let lastAdvanceAt = Date.now();
let lastSeenPosition = -1;

function setIntent(play: boolean) {
  wantsToPlay = play;
  lastAdvanceAt = Date.now();
}

function beginTrackWatch() {
  setIntent(true);
  progressedThisTrack = false;
  needsReload = false;
  lastSeenPosition = -1;
}

function isStalled() {
  return wantsToPlay && progressedThisTrack && Date.now() - lastAdvanceAt > STALL_MS;
}

usePlayerStore.subscribe((state) => {
  if (state.currentPosition === lastSeenPosition) return;
  if (state.currentPosition > lastSeenPosition && state.currentPosition > 0) progressedThisTrack = true;
  lastSeenPosition = state.currentPosition;
  lastAdvanceAt = Date.now();
});

const watchdog = setInterval(() => {
  if (isStalled() && !recovering) {
    lastAdvanceAt = Date.now();
    void recoverFromError();
  }
}, 3000);
// Node (tests) only: don't keep the process alive for the watchdog.
(watchdog as unknown as { unref?: () => void }).unref?.();

engine.setEngineHandlers({
  onEnded: () => {
    completeListen();
    void next({ auto: true });
  },
  onError: () => void recoverFromError(),
  // Lock screen, headphones or a call paused/resumed us: follow it, so the stall
  // watchdog doesn't mistake a deliberate pause for a stuck stream and restart.
  onExternalPlayChange: (playing) => setIntent(playing),
});
