/**
 * queryClient.ts
 *
 * Shared react-query client instance.
 * Exported separately so any module (screens, services) can call
 * queryClient.invalidateQueries() after mutations without needing
 * the useQueryClient() hook (which requires a component context).
 *
 * The library part of the cache is also saved to the phone, so the app opens
 * with your Liked Songs, playlists and history already on screen and refreshes
 * them quietly in the background.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, onlineManager, type Query } from '@tanstack/react-query';
import type { PersistedClient, PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(state.isConnected !== false);
  })
);

const DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Library data only changes through our own actions, and those update or
      // invalidate the cache directly (services/libraryActions.ts; history is
      // invalidated after every play). So data stays fresh for 5 minutes.
      staleTime: 5 * 60 * 1000,
      // Must be at least the persist maxAge, or saved queries are dropped from
      // memory before they can be written to disk.
      gcTime: DAY,
    },
  },
});

// ── Saved to the phone ───────────────────────────────────────────────────────

/** Bump to discard every saved cache after a breaking change to response shapes. */
const CACHE_VERSION = '1';
const STORAGE_KEY = 'ragastream-query-cache';

/** Query families worth saving: your library and slow, stable lookups. */
const SAVED = new Set(['liked', 'playlists', 'playlist', 'history', 'songs', 'lyrics', 'artwork-color', 'genre-home']);
/** Kept when the saved cache grows too big: what makes the app open full. */
const ESSENTIAL = new Set(['liked', 'playlists', 'playlist', 'history']);

// Android's AsyncStorage can't read back a single value much over 2MB, so stay
// well under it: drop the nice-to-haves (lyrics, colours, genre lists) first.
const MAX_SAVED_CHARS = 1_500_000;

function serialize(client: PersistedClient): string {
  const full = JSON.stringify(client);
  if (full.length <= MAX_SAVED_CHARS) return full;
  const queries = client.clientState.queries.filter((q) => ESSENTIAL.has(String(q.queryKey[0])));
  return JSON.stringify({ ...client, clientState: { ...client.clientState, queries } });
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: STORAGE_KEY,
  throttleTime: 2000,
  serialize,
});

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: 7 * DAY,
  buster: CACHE_VERSION,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) => query.state.status === 'success' && SAVED.has(String(query.queryKey[0])),
  },
};

/**
 * Forget all cached data, in memory and on the phone. Called on sign-out (so
 * the next account never sees the previous one's library) and from Settings.
 */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
