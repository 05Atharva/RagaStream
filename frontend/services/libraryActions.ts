/**
 * libraryActions.ts
 *
 * Shared song/library mutations used by every screen and the global song menu,
 * so liking, saving and sharing behave the same everywhere. Each mutation
 * refreshes the React Query caches that display it.
 */
import { Share } from 'react-native';
import Toast from './toast';
import { apiClient } from './apiClient';
import { queryClient } from './queryClient';
import { ensureSongInCatalogue } from './songService';
import { logSongEvent } from './eventLog';
import * as recs from './recsService';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import type { SongInput } from './playbackController';
import type { Song } from '../hooks/useSongs';

export const queryKeys = {
  liked: ['liked'] as const,
  playlists: ['playlists'] as const,
  playlist: (id: string) => ['playlist', id] as const,
  containing: (youtubeId: string) => ['playlist-containing', youtubeId] as const,
};

/** Catalogue UUID for a song, saving it to the catalogue first if needed. */
export async function ensureSongId(song: SongInput): Promise<string> {
  if (song.id && song.id !== song.youtube_id) return song.id;
  return ensureSongInCatalogue({
    youtube_id: song.youtube_id,
    title: song.title,
    channel_name: song.channel_name || 'Unknown',
    thumbnail_url: song.thumbnail_url || '',
    duration_sec: song.duration_sec || 0,
  });
}

export function isSongLiked(youtubeId: string): boolean {
  const liked = queryClient.getQueryData<Song[]>(queryKeys.liked);
  return Boolean(liked?.some((s) => s.youtube_id === youtubeId));
}

/** Optimistically like/unlike; rolls back and toasts on failure. */
export async function setLiked(song: SongInput, liked: boolean): Promise<void> {
  const previous = queryClient.getQueryData<Song[]>(queryKeys.liked);
  queryClient.setQueryData<Song[]>(queryKeys.liked, (current = []) => {
    const without = current.filter((s) => s.youtube_id !== song.youtube_id);
    if (!liked) return without;
    return [
      {
        id: song.id || song.youtube_id,
        youtube_id: song.youtube_id,
        title: song.title,
        channel_name: song.channel_name,
        thumbnail_url: song.thumbnail_url,
        duration_sec: song.duration_sec,
      },
      ...without,
    ];
  });

  try {
    const songId = await ensureSongId(song);
    if (liked) {
      await apiClient.post('/liked', { song_id: songId });
    } else {
      await apiClient.delete(`/liked/${songId}`);
    }
    logSongEvent(liked ? 'like' : 'unlike', song);
    Toast.show({ type: 'success', text1: liked ? 'Added to Liked Songs' : 'Removed from Liked Songs' });
  } catch {
    queryClient.setQueryData(queryKeys.liked, previous);
    Toast.show({ type: 'error', text1: 'Could not update Liked Songs' });
  } finally {
    void queryClient.invalidateQueries({ queryKey: queryKeys.liked });
  }
}

export async function addSongToPlaylist(song: SongInput, playlistId: string): Promise<void> {
  const songId = await ensureSongId(song);
  try {
    await apiClient.post(`/playlists/${playlistId}/songs`, { song_id: songId });
  } catch (err: unknown) {
    // 409 = already there; for a "save" action that's the desired end state.
    if ((err as { response?: { status?: number } })?.response?.status !== 409) throw err;
  }
  logSongEvent('save', song);
}

export async function removeSongFromPlaylist(songId: string, playlistId: string): Promise<void> {
  await apiClient.delete(`/playlists/${playlistId}/songs/${songId}`);
}

export async function addSongsToPlaylist(songIds: string[], playlistId: string) {
  const { data } = await apiClient.post<{ added: number; skipped: number }>(
    `/playlists/${playlistId}/songs/bulk`,
    { song_ids: songIds }
  );
  return data;
}

export async function createPlaylist(name: string, description = ''): Promise<{ id: string; name: string }> {
  const { data } = await apiClient.post<{ id: string; name: string }>('/playlists', { name, description });
  void queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
  return data;
}

export function invalidatePlaylists(playlistIds: string[] = [], youtubeId?: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
  playlistIds.forEach((id) => void queryClient.invalidateQueries({ queryKey: queryKeys.playlist(id) }));
  if (youtubeId) void queryClient.invalidateQueries({ queryKey: queryKeys.containing(youtubeId) });
}

/** Native share sheet (WhatsApp, Instagram, copy link…). */
export async function shareSong(song: Pick<SongInput, 'youtube_id' | 'title' | 'channel_name'>) {
  const url = `https://youtu.be/${song.youtube_id}`;
  try {
    await Share.share({
      title: song.title,
      message: `${song.title}${song.channel_name ? ` · ${song.channel_name}` : ''}\n${url}`,
      url,
    });
  } catch {
    Toast.show({ type: 'error', text1: 'Could not open share sheet' });
  }
}

// ── Hiding (recommendation feedback) ─────────────────────────────────────────
// The settings store keeps an offline mirror; /feedback is the source of truth
// the engine reads. A failed upload clears `feedbackSynced`, so the mirror is
// uploaded again on the next launch.

function refreshFeedback() {
  void queryClient.invalidateQueries({ queryKey: ['feedback'] });
  void queryClient.invalidateQueries({ queryKey: ['recs-home'] });
}

/** Keep a song out of radio, Autoplay, Smart Shuffle and Home. */
export async function hideSong(song: Pick<SongInput, 'youtube_id' | 'title'>): Promise<void> {
  useSettingsStore.getState().hideSong(song.youtube_id);
  try {
    await recs.postFeedback('song', song.youtube_id, song.title);
  } catch {
    useSettingsStore.getState().setFeedbackSynced(false);
  }
  refreshFeedback();
}

/** Keep every song from a channel out of recommendations. */
export async function hideChannel(channelName: string): Promise<void> {
  useSettingsStore.getState().hideChannel(channelName);
  try {
    await recs.postFeedback('channel', channelName, channelName);
  } catch {
    useSettingsStore.getState().setFeedbackSynced(false);
  }
  refreshFeedback();
}

/** Show everything hidden again. Throws (and keeps the mirror) if the server call fails. */
export async function clearAllFeedback(): Promise<void> {
  await recs.clearFeedback();
  useSettingsStore.setState({ hiddenYoutubeIds: [], hiddenChannels: [], feedbackSynced: true });
  refreshFeedback();
}

let uploadingHides = false;

/** One-time: upload hides saved on this phone before /feedback existed. */
export async function uploadLocalHides(): Promise<void> {
  const settings = useSettingsStore.getState();
  if (uploadingHides || settings.feedbackSynced || !useAuthStore.getState().session) return;
  uploadingHides = true;
  try {
    const jobs = [
      ...settings.hiddenYoutubeIds.map((id) => recs.postFeedback('song', id)),
      ...settings.hiddenChannels.map((name) => recs.postFeedback('channel', name, name)),
    ];
    await Promise.all(jobs);
    useSettingsStore.getState().setFeedbackSynced(true);
    refreshFeedback();
  } catch {
    // stays unsynced; tried again next launch
  } finally {
    uploadingHides = false;
  }
}

function maybeUploadHides() {
  if (useSettingsStore.persist.hasHydrated()) void uploadLocalHides();
}
useAuthStore.subscribe((state, prev) => {
  if (state.session && !prev.session) maybeUploadHides();
  // Signed out: the next account must not inherit (or upload) this one's hides.
  if (!state.session && prev.session) {
    useSettingsStore.setState({ hiddenYoutubeIds: [], hiddenChannels: [], feedbackSynced: true });
  }
});
useSettingsStore.persist.onFinishHydration(maybeUploadHides);
maybeUploadHides();
