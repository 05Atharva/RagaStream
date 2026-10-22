/**
 * eventLog.ts
 *
 * Listening events for the recommendation engine. logEvent() queues; the queue
 * is sent in chunks (at 10 events, after 20 s, or when the app leaves the
 * foreground) and kept in AsyncStorage so offline events survive a restart.
 * Telemetry never blocks or throws into the UI.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { apiClient } from './apiClient';
import { useAuthStore } from '../store/authStore';
import { usePlayerStore, type Surface } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';

export type EventName = 'start' | 'skip' | 'complete' | 'like' | 'unlike' | 'save' | 'queue' | 'hide';

export type LogEvent = {
  youtube_id: string;
  event: EventName;
  surface?: Surface;
  context_id?: string;
  rec_id?: string;
  song_id?: string;
  listened_sec?: number;
  duration_sec?: number;
  local_hour?: number;
  at?: string;
};

const OUTBOX_KEY = 'ragastream-event-outbox';
const MAX_OUTBOX = 500;
const CHUNK = 50;
const FLUSH_AT = 10;
const FLUSH_AFTER_MS = 20_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** Dropped in a private session; likes, saves and queueing still count. */
const LISTENING: ReadonlySet<EventName> = new Set(['start', 'skip', 'complete']);

let pending: LogEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let failures = 0;
let nextAttemptAt = 0;

// ── Outbox on the phone ──────────────────────────────────────────────────────

let writeChain: Promise<void> = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(pending);
  writeChain = writeChain
    .then(() => AsyncStorage.setItem(OUTBOX_KEY, snapshot))
    .catch(() => {});
}

const hydrated: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const stored = raw ? (JSON.parse(raw) as LogEvent[]) : [];
    if (Array.isArray(stored) && stored.length > 0) {
      pending = [...stored, ...pending].slice(-MAX_OUTBOX);
      schedule(FLUSH_AFTER_MS);
    }
  } catch {
    // unreadable outbox: start clean
  }
})();

// ── Sending ──────────────────────────────────────────────────────────────────

function schedule(ms: number) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushEvents();
  }, ms);
}

function cancelTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

const statusOf = (err: unknown) => (err as { response?: { status?: number } })?.response?.status;

/** Sends everything queued, 50 at a time. Resolves once the queue is empty or a send failed. */
export function flushEvents(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    await hydrated;
    try {
      while (pending.length > 0) {
        if (!useAuthStore.getState().session) {
          await clearEventOutbox();
          return;
        }
        if (Date.now() < nextAttemptAt) return;
        cancelTimer();
        const chunk = pending.slice(0, CHUNK);
        try {
          await apiClient.post('/events', { events: chunk });
          failures = 0;
        } catch (err) {
          const status = statusOf(err);
          // Other 4xx: the server won't accept these events, so drop them. Network
          // errors, timeouts, rate limits and 5xx: keep them and retry later.
          const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
          if (retryable) {
            failures += 1;
            const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
            nextAttemptAt = Date.now() + delay;
            schedule(delay);
            return;
          }
        }
        const sent = new Set(chunk);
        pending = pending.filter((e) => !sent.has(e));
        persist();
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget queued events (sign-out), so the next account never receives them. */
export async function clearEventOutbox(): Promise<void> {
  pending = [];
  failures = 0;
  nextAttemptAt = 0;
  cancelTimer();
  await hydrated;
  pending = [];
  writeChain = writeChain.then(() => AsyncStorage.removeItem(OUTBOX_KEY)).catch(() => {});
  await writeChain;
}

// ── Logging ──────────────────────────────────────────────────────────────────

/** Queue one event. No-op when signed out; listening events are dropped in a private session. */
export function logEvent(partial: LogEvent): void {
  if (!useAuthStore.getState().session) return;
  if (LISTENING.has(partial.event) && useSettingsStore.getState().privateSession) return;
  const now = new Date();
  pending.push({
    ...partial,
    surface: partial.surface ?? 'other',
    local_hour: partial.local_hour ?? now.getHours(),
    at: partial.at ?? now.toISOString(),
  });
  if (pending.length > MAX_OUTBOX) pending = pending.slice(-MAX_OUTBOX);
  void hydrated.then(persist);
  if (pending.length >= FLUSH_AT) void flushEvents();
  else schedule(FLUSH_AFTER_MS);
}

type ActedSong = { youtube_id: string; id?: string | null; recId?: string | null; surface?: Surface };

/**
 * Event for something the listener did to a song (like, save, queue). When the
 * song is the playing track it carries that track's slate and surface;
 * otherwise the song's own, falling back to the library.
 */
export function logSongEvent(event: EventName, song: ActedSong): void {
  const state = usePlayerStore.getState();
  const track = state.currentTrack;
  const isCurrent = Boolean(track && (track.youtubeId || track.youtube_id) === song.youtube_id);
  const surface = (isCurrent ? track?.surface : song.surface) ?? 'library';
  const recId = (isCurrent ? track?.recId : song.recId) ?? song.recId ?? undefined;
  logEvent({
    youtube_id: song.youtube_id,
    event,
    surface,
    rec_id: recId || undefined,
    context_id: isCurrent ? state.context?.id : undefined,
  });
}

// Signed out: the next account must not receive this one's queued events.
useAuthStore.subscribe((state, prev) => {
  if (!state.session && prev.session) void clearEventOutbox();
});

// Don't lose a batch when the app is backgrounded or swiped away.
try {
  AppState.addEventListener('change', (status) => {
    if (status !== 'active') void flushEvents();
  });
} catch {
  // AppState unavailable (tests)
}
