/**
 * recsService.ts
 *
 * Typed calls for the recommendation engine (docs/RECOMMENDATIONS.md).
 * Callers decide how to fall back when a call fails; nothing here swallows errors.
 */
import { apiClient } from './apiClient';
import type { SongInput } from './playbackController';
import type { Surface } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';

export type ReasonCode =
  | 'seed' | 'session' | 'taste' | 'walk' | 'channel' | 'rediscover' | 'catalogue' | 'discover';

export type RecItem = {
  youtube_id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  reason: string;
  reason_code: ReasonCode;
};

export type Slate = { rec_id: string; surface: string; items: RecItem[] };

export type HomeSection = {
  id: string;
  kind: 'mix' | 'discover' | 'rediscover' | 'because' | 'hour';
  title: string;
  subtitle: string;
  seed: RecItem | null;
  rec_id: string;
  items: RecItem[];
};

export type HomeRecs = { generated_at: string; sections: HomeSection[] };

export type FeedbackTarget = 'song' | 'channel';

export type Feedback = {
  target_type: FeedbackTarget;
  target_id: string;
  kind: 'hide';
  label?: string | null;
  created_at?: string;
};

const MAX_IDS = 200;
const lastIds = (ids: string[]) => (ids.length > MAX_IDS ? ids.slice(-MAX_IDS) : ids);

// ── Calls ────────────────────────────────────────────────────────────────────

export async function fetchNext(seed: string, exclude: string[], limit = 15): Promise<Slate> {
  const { data } = await apiClient.get<Slate>('/recs/next', {
    params: { seed, exclude: lastIds(exclude).join(','), limit },
  });
  return data;
}

export async function fetchRadioSlate(seed: string, limit = 30): Promise<Slate> {
  const { data } = await apiClient.get<Slate>('/recs/radio', { params: { seed, limit } });
  return data;
}

export async function fetchShuffle(body: {
  current: string | null;
  context: string[];
  exclude: string[];
  limit?: number;
}): Promise<Slate> {
  const { data } = await apiClient.post<Slate>('/recs/shuffle', {
    current: body.current,
    context: lastIds(body.context),
    exclude: lastIds(body.exclude),
    limit: body.limit ?? 15,
  });
  return data;
}

export async function fetchPlaylistRecs(youtubeIds: string[], exclude: string[], limit = 15): Promise<Slate> {
  const { data } = await apiClient.post<Slate>('/recs/playlist', {
    youtube_ids: lastIds(youtubeIds),
    exclude: lastIds(exclude),
    limit,
  });
  return data;
}

export async function fetchHome(hour: number): Promise<HomeRecs> {
  const { data } = await apiClient.get<HomeRecs>('/recs/home', { params: { hour } });
  return data;
}

export async function getFeedback(): Promise<Feedback[]> {
  const { data } = await apiClient.get<Feedback[]>('/feedback');
  return data;
}

export async function postFeedback(targetType: FeedbackTarget, targetId: string, label?: string | null) {
  const { data } = await apiClient.post<Feedback>('/feedback', {
    target_type: targetType,
    target_id: targetId,
    kind: 'hide',
    label: label ?? undefined,
  });
  return data;
}

export async function deleteFeedback(targetType: FeedbackTarget, targetId: string): Promise<void> {
  await apiClient.delete(`/feedback/${targetType}/${encodeURIComponent(targetId)}`);
}

export async function clearFeedback(targetType?: FeedbackTarget): Promise<void> {
  await apiClient.delete('/feedback', { params: targetType ? { target_type: targetType } : undefined });
}

// ── Conversions ──────────────────────────────────────────────────────────────

/** Songs and channels the listener hid on this phone (offline mirror of /feedback). */
export function isHiddenLocally(youtubeId: string, channel?: string | null): boolean {
  const { hiddenYoutubeIds, hiddenChannels } = useSettingsStore.getState();
  return hiddenYoutubeIds.includes(youtubeId) || Boolean(channel && hiddenChannels.includes(channel));
}

/** A rec item as a playable song, carrying the slate's id and the reason to show. */
export function toSongInput(item: RecItem, recId?: string, surface?: Surface): SongInput {
  return {
    youtube_id: item.youtube_id,
    title: item.title,
    channel_name: item.channel,
    thumbnail_url: item.thumbnail,
    duration_sec: item.duration,
    recId,
    reason: item.reason,
    reasonCode: item.reason_code,
    surface,
  };
}

/** A slate as songs: hidden songs and channels removed, each tagged with the slate id. */
export function slateSongs(slate: Slate): SongInput[] {
  return (slate.items ?? [])
    .filter((item) => !isHiddenLocally(item.youtube_id, item.channel))
    .map((item) => toSongInput(item, slate.rec_id, slate.surface as Surface));
}
