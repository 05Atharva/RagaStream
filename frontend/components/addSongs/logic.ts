/**
 * Pure helpers for the "Add songs" sheet (US-11): which songs count as in the
 * playlist, how many were added this session, and what the Liked tab offers.
 */

export type HasYoutubeId = { youtube_id: string };

/** What the user has toggled in the sheet, by YouTube id: true = in, false = out. */
export type Overrides = ReadonlyMap<string, boolean>;

/** The sheet's own toggles win; otherwise the playlist as the cache has it. */
export function isInPlaylist(youtubeId: string, base: ReadonlySet<string>, overrides: Overrides): boolean {
  const toggled = overrides.get(youtubeId);
  return toggled !== undefined ? toggled : base.has(youtubeId);
}

/** Songs now in the playlist that were not there when the sheet opened. */
export function netAddedCount(initial: ReadonlySet<string>, overrides: Overrides): number {
  let count = 0;
  overrides.forEach((isIn, youtubeId) => {
    if (isIn && !initial.has(youtubeId)) count += 1;
  });
  return count;
}

/** Liked songs that were not in the playlist at open. Added ones stay so they can be undone. */
export function likedToOffer<T extends HasYoutubeId>(liked: readonly T[] | undefined, initial: ReadonlySet<string>): T[] {
  return (liked ?? []).filter((s) => !initial.has(s.youtube_id));
}

/** Suggestions without anything that was already in the playlist, and without repeats. */
export function suggestionsToOffer<T extends HasYoutubeId>(recs: readonly T[], initial: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  return recs.filter((s) => {
    if (initial.has(s.youtube_id) || seen.has(s.youtube_id)) return false;
    seen.add(s.youtube_id);
    return true;
  });
}

export function addedToast(count: number, playlistName: string): string {
  return `Added ${count} ${count === 1 ? 'song' : 'songs'} to ${playlistName}`;
}
