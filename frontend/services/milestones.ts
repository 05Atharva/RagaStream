/**
 * Riyaz milestones (US-13). Musicians count their riyaz — daily practice.
 * RagaStream quietly notices when someone has *built* something and marks it
 * once. Each milestone has a stable id so it is only ever celebrated once.
 */
import type { Playlist } from '../hooks/usePlaylists';
import type { TopSong } from '../hooks/useHistory';

export type Milestone = {
  id: string;
  title: string;
  body: string;
};

const PLAYLIST_SIZES: Array<[number, string]> = [
  [10, 'Ten songs in. It has a sound of its own now.'],
  [25, 'Twenty-five songs, every one picked by you.'],
  [50, 'Fifty songs. This one is a journey.'],
];

const LIKED_COUNTS: Array<[number, string]> = [
  [10, 'Your taste is taking shape.'],
  [50, 'Fifty songs you love, all in one place.'],
  [100, 'A hundred favourites. That is a library.'],
];

type Inputs = {
  playlists: Playlist[];
  likedCount: number;
  onRepeat: TopSong[];
};

/** Every milestone the user has currently reached, in the order to celebrate them. */
export function reachedMilestones({ playlists, likedCount, onRepeat }: Inputs): Milestone[] {
  const reached: Milestone[] = [];

  if (playlists.length > 0) {
    const first = [...playlists].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0];
    reached.push({
      id: 'first-playlist',
      title: 'Your first playlist',
      body: `"${first.name}" is yours. Add a few songs and watch it take shape.`,
    });
  }

  for (const playlist of playlists) {
    for (const [size, body] of PLAYLIST_SIZES) {
      if ((playlist.song_count ?? 0) >= size) {
        reached.push({ id: `playlist-${playlist.id}-${size}`, title: `"${playlist.name}" reached ${size} songs`, body });
      }
    }
  }

  for (const [count, body] of LIKED_COUNTS) {
    if (likedCount >= count) {
      reached.push({ id: `liked-${count}`, title: `${count} songs you love`, body });
    }
  }

  const repeated = onRepeat.find((song) => song.plays >= 10);
  if (repeated) {
    reached.push({
      id: `repeat-${repeated.youtube_id}`,
      title: `${repeated.plays} plays of "${repeated.title}"`,
      body: "It's officially on repeat.",
    });
  }

  return reached;
}
