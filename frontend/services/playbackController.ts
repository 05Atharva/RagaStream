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
import { queryClient } from './queryClient';
import { ensureSongInCatalogue } from './songService';
import { recordPlayHistory } from './historyService';
import * as engine from './audioPlayer';
import {
  usePlayerStore,
  type PlaybackContext,
  type RepeatModeValue,
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

async function resolveStreamUrl(youtubeId: string, fresh = false): Promise<string> {
  const cached = streamCache.get(youtubeId);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.url;
  const pending = streamInflight.get(youtubeId);
  if (!fresh && pending) return pending;

  const request = apiClient
    .get<{ stream_url: string }>('/youtube/stream', { params: { id: youtubeId } })
    .then(({ data }) => {
      streamCache.set(youtubeId, { url: data.stream_url, expiresAt: Date.now() + STREAM_TTL_MS });
      return data.stream_url;
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
  const hidden = new Set(useSettingsStore.getState().hiddenYoutubeIds);
  return data.filter((r) => !hidden.has(r.youtube_id)).map(fromYouTube);
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
  set({
    currentTrack: track,
    currentIndex: index,
    playingFromUserQueue: fromUserQueue,
    isLoading: true,
    isPlaying: true,
    currentPosition: startPosition,
    duration: track.durationSec ?? 0,
  });
  const url = await resolveStreamUrl(getYoutubeId(track));
  if (token !== playToken) return;
  await engine.loadAndPlay({ ...track, url }, startPosition);
  if (token !== playToken) return;
  void onTrackStarted(track);
  prefetchUpcoming();
  void maybeExtendWithAutoplay();
}

/** Start a track; on failure, skip forward (bounded) instead of stalling. */
async function startOrSkip(track: Track, index: number, fromUserQueue: boolean, attempt = 0): Promise<void> {
  try {
    await startTrack(track, index, fromUserQueue);
  } catch {
    set({ isLoading: false });
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
  const tracks = songs.map((song) => songToTrack(song, context.name));
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
  const related = await fetchRadio(song.youtube_id, 30);
  await playSongs([song, ...related], 0, {
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
        await engine.pausePlayback();
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
    await engine.pausePlayback();
    Toast.show({ type: 'info', text1: 'Sleep timer ended', text2: 'Playback paused' });
    return;
  }
  if (auto && state.repeatMode === 'one') {
    await engine.seekTo(0);
    await engine.resumePlayback();
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
    await engine.pausePlayback();
  } else {
    await engine.resumePlayback();
  }
}

export async function seek(positionSeconds: number): Promise<void> {
  await engine.seekTo(positionSeconds);
}

export async function stop(): Promise<void> {
  await engine.stopPlayback();
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
  const track = songToTrack(song, 'Queue');
  if (!get().currentTrack) {
    await playSongs([song], 0, { type: 'queue', name: 'Queue' });
    return;
  }
  set((state) => ({ userQueue: [...state.userQueue, track] }));
  prefetchUpcoming();
}

/** "Play next": jumps to the front of "Next in queue". */
export async function playNext(song: SongInput): Promise<void> {
  const track = songToTrack(song, 'Queue');
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

async function addSmartRecommendations() {
  const state = get();
  const contextTracks = state.queue.filter((t) => !t.isRecommendation);
  const seeds = [state.currentTrack, ...shuffleArray(contextTracks).slice(0, 2)]
    .filter((t): t is Track => Boolean(t))
    .map(getYoutubeId);
  const uniqueSeeds = [...new Set(seeds)].slice(0, 3);

  const results = await Promise.allSettled(uniqueSeeds.map((id) => fetchRadio(id, 12)));
  const latest = get();
  if (latest.shuffleMode !== 'smart') return;

  const present = new Set(latest.queue.map(getYoutubeId));
  const picks: Track[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const song of result.value) {
      if (present.has(song.youtube_id)) continue;
      present.add(song.youtube_id);
      picks.push({ ...songToTrack(song, 'Smart Shuffle'), isRecommendation: true });
    }
  }

  const upcoming = latest.queue.slice(latest.currentIndex + 1);
  const wanted = Math.min(Math.ceil(upcoming.length / SMART_SHUFFLE_EVERY) || 3, 15);
  const recommendations = shuffleArray(picks).slice(0, wanted);
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
  useSettingsStore.getState().hideSong(getYoutubeId(track));
}

// ── Autoplay ──────────────────────────────────────────────────────────────────

let autoplayInflight: Promise<boolean> | null = null;

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

  autoplayInflight = (async () => {
    try {
      const recent = new Set(get().queue.map(getYoutubeId));
      const songs = (await fetchRadio(getYoutubeId(seed), 20)).filter((s) => !recent.has(s.youtube_id));
      if (songs.length === 0) return false;
      const tracks = songs.map((song) => ({ ...songToTrack(song, 'Autoplay'), isAutoplay: true }));
      set((s) => ({
        queue: [...s.queue, ...tracks],
        originalQueue: s.originalQueue ? [...s.originalQueue, ...tracks] : null,
      }));
      prefetchUpcoming();
      return true;
    } catch {
      return false;
    } finally {
      autoplayInflight = null;
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
    void engine.pausePlayback();
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
    await next({ auto: true });
    return;
  }

  recovering = true;
  lastRecoveryAt = Date.now();
  set({ showReconnecting: true });
  try {
    const url = await resolveStreamUrl(getYoutubeId(track), true);
    await engine.loadAndPlay({ ...track, url }, state.currentPosition);
  } catch {
    set({ isPlaying: false });
    Toast.show({ type: 'error', text1: 'Could not reconnect. Try playing again.' });
  } finally {
    recovering = false;
    set({ showReconnecting: false });
  }
}

engine.setEngineHandlers({
  onEnded: () => void next({ auto: true }),
  onError: () => void recoverFromError(),
});
