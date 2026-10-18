import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import Toast from '../services/toast';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import PlaylistCover from './PlaylistCover';
import Button from './ui/Button';
import CheckMark from './ui/CheckMark';
import SheetRow, { SheetHeader } from './ui/SheetRow';
import Text from './ui/Text';
import { Radius, Space, Type } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';
import { usePlaylists, usePlaylistsContaining } from '../hooks/usePlaylists';
import { useIsLiked } from '../hooks/useLiked';
import {
  addSongToPlaylist,
  createPlaylist,
  ensureSongId,
  invalidatePlaylists,
  removeSongFromPlaylist,
  setLiked,
} from '../services/libraryActions';
import { successHaptic, tapHaptic } from '../services/haptics';
import type { SongInput } from '../services/playbackController';

type SaveToSheetProps = {
  isVisible: boolean;
  onClose: () => void;
  song: SongInput | null;
};

/**
 * "Save to": Liked Songs and every playlist, ticked where the song already
 * lives. Toggle any number, then Done applies the difference, so duplicates
 * are impossible by construction (US-09).
 */
export default function SaveToSheet({ isVisible, onClose, song }: SaveToSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const { height } = useWindowDimensions();
  const youtubeId = song?.youtube_id;
  const isLiked = useIsLiked(youtubeId);
  const playlistsQuery = usePlaylists(isVisible);
  const containingQuery = usePlaylistsContaining(youtubeId, isVisible);

  const [likedSelected, setLikedSelected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialised, setInitialised] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const initialSelected = useMemo(() => new Set(containingQuery.data ?? []), [containingQuery.data]);

  useEffect(() => {
    if (!isVisible) {
      setInitialised(false);
      setIsCreating(false);
      setNewName('');
      return;
    }
    if (!initialised && (containingQuery.isSuccess || containingQuery.isError)) {
      setLikedSelected(isLiked);
      setSelected(new Set(initialSelected));
      setInitialised(true);
    }
  }, [isVisible, initialised, containingQuery.isSuccess, containingQuery.isError, initialSelected, isLiked]);

  const toggle = (playlistId: string) => {
    tapHaptic();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const playlist = await createPlaylist(name);
      setSelected((current) => new Set(current).add(playlist.id));
      setIsCreating(false);
      setNewName('');
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't create the playlist", text2: 'Check your connection and try again.' });
    }
  };

  const handleDone = async () => {
    if (!song) return;
    const toAdd = [...selected].filter((id) => !initialSelected.has(id));
    const toRemove = [...initialSelected].filter((id) => !selected.has(id));
    const likeChanged = likedSelected !== isLiked;
    if (!toAdd.length && !toRemove.length && !likeChanged) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      if (likeChanged) await setLiked(song, likedSelected);
      if (toAdd.length || toRemove.length) {
        const songId = await ensureSongId(song);
        await Promise.all([
          ...toAdd.map((id) => addSongToPlaylist({ ...song, id: songId }, id)),
          ...toRemove.map((id) => removeSongFromPlaylist(songId, id)),
        ]);
        invalidatePlaylists([...toAdd, ...toRemove], song.youtube_id);
        const names = (playlistsQuery.data ?? []).filter((p) => toAdd.includes(p.id)).map((p) => p.name);
        Toast.show({
          type: 'success',
          text1: toAdd.length === 1 && !toRemove.length ? `Saved to ${names[0]}` : 'Changes saved',
        });
      }
      successHaptic();
      onClose();
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't save your changes", text2: 'Nothing was changed. Try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const playlists = playlistsQuery.data ?? [];

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={styles.container}>
        <SheetHeader
          title="Save to"
          subtitle={song?.title}
          right={<Button label="New playlist" icon="add" size="sm" variant="secondary" onPress={() => setIsCreating((v) => !v)} />}
        />

        {isCreating ? (
          <View style={styles.createRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Name your playlist"
              placeholderTextColor={colors.textTertiary}
              style={styles.createInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleCreate()}
              accessibilityLabel="New playlist name"
            />
            <Button label="Create" size="md" onPress={() => void handleCreate()} disabled={!newName.trim()} />
          </View>
        ) : null}

        {!initialised ? (
          <ActivityIndicator color={colors.accentInk} style={styles.loader} />
        ) : (
          <ScrollView style={{ maxHeight: height * 0.5 }} showsVerticalScrollIndicator={false}>
            <SheetRow
              label="Liked Songs"
              detail="Your favourites"
              onPress={() => {
                tapHaptic();
                setLikedSelected((v) => !v);
              }}
              leading={<PlaylistCover variant="liked" size={44} borderRadius={Radius.sm} />}
              trailing={<CheckMark checked={likedSelected} />}
            />
            {playlists.map((playlist) => (
              <SheetRow
                key={playlist.id}
                label={playlist.name}
                detail={`${playlist.song_count ?? 0} songs`}
                onPress={() => toggle(playlist.id)}
                leading={<PlaylistCover thumbnails={playlist.cover_thumbnails} size={44} borderRadius={Radius.sm} />}
                trailing={<CheckMark checked={selected.has(playlist.id)} />}
              />
            ))}
            {playlists.length === 0 ? (
              <Text variant="caption" color="textSecondary" align="center" style={styles.empty}>
                No playlists yet. Tap New playlist to start one.
              </Text>
            ) : null}
          </ScrollView>
        )}

        <Button label="Done" size="lg" onPress={() => void handleDone()} loading={isSaving} disabled={!initialised} fullWidth style={styles.done} />
      </View>
    </AnimatedBottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  container: { paddingBottom: Space[3], paddingHorizontal: Space[3] },
  createRow: { alignItems: 'center', flexDirection: 'row', gap: Space[2], marginBottom: Space[3], paddingHorizontal: Space[2] },
  createInput: {
    ...Type.body,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: Radius.sm,
    color: t.colors.text,
    flex: 1,
    height: 44,
    paddingHorizontal: Space[3],
  },
  loader: { marginVertical: Space[8] },
  empty: { paddingVertical: Space[4] },
  done: { marginHorizontal: Space[2], marginTop: Space[4] },
}));
