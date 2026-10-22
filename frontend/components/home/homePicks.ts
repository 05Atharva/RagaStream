/**
 * Pure helpers that decide which engine sections Home shows. Kept free of React
 * and native imports so the rules can be tested on their own.
 *
 * Calm rule: the engine replaces or merges into Home's rows, it never piles on.
 * At most 3 mixes, exactly one discovery row (rotating daily), one hour card.
 */
import type { HomeRecs, HomeSection } from '../../services/recsService';

export const MAX_MIXES = 3;
export const MAX_DISCOVERY_ITEMS = 10;

const DISCOVERY_KINDS: ReadonlyArray<HomeSection['kind']> = ['because', 'discover', 'rediscover'];

export type HomePicks = {
  /** Engine mixes for "Made for you" (empty means: fall back to channel mixes). */
  mixes: HomeSection[];
  /** The one discovery row for today, or null. */
  discovery: HomeSection | null;
  /** The hour set, or null. */
  hour: HomeSection | null;
  /** True when any engine row will be shown. */
  hasEngineRows: boolean;
};

/** 1-based day of the year in local time. Stable all day, changes at midnight. */
export function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime() - (date.getTimezoneOffset() - start.getTimezoneOffset()) * 60000;
  return Math.floor(diff / 86400000);
}

/** One discovery section by daily rotation over the ones available. */
export function pickDiscovery(sections: HomeSection[], day: number): HomeSection | null {
  const pool = DISCOVERY_KINDS.flatMap((kind) => sections.filter((s) => s.kind === kind && s.items.length > 0));
  if (pool.length === 0) return null;
  return pool[((day % pool.length) + pool.length) % pool.length];
}

export function pickHomeSections(data: HomeRecs | undefined | null, day: number): HomePicks {
  const sections = (data?.sections ?? []).filter((s) => s.items.length > 0);
  const mixes = sections.filter((s) => s.kind === 'mix').slice(0, MAX_MIXES);
  const discovery = pickDiscovery(sections, day);
  const hour = sections.find((s) => s.kind === 'hour') ?? null;
  return { mixes, discovery, hour, hasEngineRows: mixes.length > 0 || discovery !== null || hour !== null };
}

/** "7 pm", "12 am". */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
}

/** Featured moves below the engine rows only once there is history and engine rows. */
export function featuredBelow(hasHistory: boolean, hasEngineRows: boolean): boolean {
  return hasHistory && hasEngineRows;
}
