import React, { useRef } from 'react';
import type { View } from 'react-native';
import Toast from '../services/toast';
import SongOptionsSheet, { type SongAction } from './SongOptionsSheet';
import SaveToSheet from './SaveToSheet';
import { useSongMenuStore } from '../store/songMenuStore';
import { useIsLiked } from '../hooks/useLiked';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import { navigate } from '../navigation/navigationRef';
import * as playback from '../services/playbackController';
import {
  ensureSongId,
  invalidatePlaylists,
  removeSongFromPlaylist,
  setLiked,
  shareSong,
} from '../services/libraryActions';
import { successHaptic } from '../services/haptics';
import { launchFlight, type Rect } from '../motion/flight';

/**
 * App-level host for the song options sheet and the "Save to" sheet. Screens
 * call openSongMenu(song) instead of each owning their own copy, so every
 * song row in the app gets the same full set of actions.
 */
export default function SongActionsHost() {
  const { song, options, isMenuVisible, isSaveVisible, closeMenu, closeSave, openSave } = useSongMenuStore();
  const isLiked = useIsLiked(song?.youtube_id);
  const thumbRef = useRef<View>(null);
  const queueContainsTrack = usePlayerStore((state) =>
    Boolean(
      options.queueTrack?.queueId &&
        (state.userQueue.some((t) => t.queueId === options.queueTrack?.queueId) ||
          state.queue.slice(state.currentIndex + 1).some((t) => t.queueId === options.queueTrack?.queueId))
    )
  );

  if (!song) return null;

  // Run after the menu has started closing so sheets never stack.
  const run = (fn: () => void | Promise<void>) => () => {
    closeMenu();
    setTimeout(() => void fn(), 0);
  };

  // Queue actions measure the header artwork first, then send it gliding
  // into the mini player once the sheet is on its way out.
  const runWithFlight = (fn: () => Promise<void>) => () => {
    const image = song.thumbnail_url || playback.thumbnailFor(song.youtube_id);
    const go = (rect: Rect | null) => {
      closeMenu();
      setTimeout(() => {
        if (rect) launchFlight(rect, image);
        void fn();
      }, 60);
    };
    if (thumbRef.current) thumbRef.current.measureInWindow((x, y, width, height) => go({ x, y, width, height }));
    else go(null);
  };

  const actions: SongAction[] = [
    {
      key: 'save',
      label: 'Add to playlist',
      icon: 'add-circle-outline',
      onPress: () => {
        closeMenu();
        // Let the menu finish its exit animation before the next sheet enters.
        setTimeout(() => openSave(song), 280);
      },
    },
    {
      key: 'play-next',
      label: 'Play next',
      icon: 'play-forward-outline',
      onPress: runWithFlight(async () => {
        await playback.playNext(song);
        successHaptic();
        Toast.show({ type: 'success', text1: 'Playing next' });
      }),
    },
    {
      key: 'queue',
      label: 'Add to queue',
      icon: 'list-outline',
      onPress: runWithFlight(async () => {
        await playback.addToQueue(song);
        successHaptic();
        Toast.show({ type: 'success', text1: 'Added to queue' });
      }),
    },
    {
      key: 'radio',
      label: 'Go to song radio',
      icon: 'radio-outline',
      onPress: run(async () => {
        try {
          await playback.startRadio(song);
          navigate('NowPlaying');
        } catch {
          Toast.show({ type: 'error', text1: 'Could not start radio' });
        }
      }),
    },
  ];

  if (!options.hideGoToChannel && song.channel_name) {
    actions.push({
      key: 'channel',
      label: 'Go to channel',
      icon: 'person-circle-outline',
      onPress: run(() => navigate('Channel', { channelName: song.channel_name! })),
    });
  }

  actions.push({
    key: 'share',
    label: 'Share',
    icon: 'share-social-outline',
    onPress: run(() => shareSong(song)),
  });

  if (options.playlistId) {
    const playlistId = options.playlistId;
    actions.push({
      key: 'remove-playlist',
      label: 'Remove from this playlist',
      icon: 'remove-circle-outline',
      destructive: true,
      onPress: run(async () => {
        try {
          const songId = await ensureSongId(song);
          await removeSongFromPlaylist(songId, playlistId);
          invalidatePlaylists([playlistId], song.youtube_id);
          Toast.show({ type: 'success', text1: 'Removed from playlist' });
        } catch {
          Toast.show({ type: 'error', text1: 'Could not remove song' });
        }
      }),
    });
  }

  const queueTrack = options.queueTrack;
  if (queueTrack && queueContainsTrack) {
    const isPick = queueTrack.isRecommendation || queueTrack.isAutoplay;
    actions.push({
      key: 'remove-queue',
      label: isPick ? 'Remove recommendation' : 'Remove from queue',
      icon: 'close-circle-outline',
      destructive: true,
      onPress: run(() => {
        if (isPick) playback.removeRecommendation(queueTrack);
        else if (queueTrack.queueId) playback.removeFromQueue(queueTrack.queueId);
      }),
    });
  } else {
    actions.push({
      key: 'hide',
      label: 'Hide from radio & autoplay',
      icon: 'eye-off-outline',
      onPress: run(() => {
        useSettingsStore.getState().hideSong(song.youtube_id);
        Toast.show({ type: 'info', text1: "We won't recommend this song" });
      }),
    });
  }

  return (
    <>
      <SongOptionsSheet
        isVisible={isMenuVisible}
        onClose={closeMenu}
        thumbnail={song.thumbnail_url}
        title={song.title}
        channel={song.channel_name ?? ''}
        isLiked={isLiked}
        onToggleLike={() => {
          successHaptic();
          void setLiked(song, !isLiked);
        }}
        actions={actions}
        thumbRef={thumbRef}
      />
      <SaveToSheet isVisible={isSaveVisible} onClose={closeSave} song={song} />
    </>
  );
}
