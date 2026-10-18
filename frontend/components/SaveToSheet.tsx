import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import PlaylistCover from './PlaylistCover';
import { Colors, TypeScale } from '../constants/theme';
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
 * Spotify's "Saved in" sheet: Liked Songs and every playlist with a check
 * showing where the song already lives. Toggle any number, then Done applies
 * the difference — duplicates are impossible by construction.
 */
export default function SaveToSheet({ isVisible, onClose, song }: SaveToSheetProps) {
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

  // Seed local check state each time the sheet opens, once data is in.
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
      const nextSet = new Set(current);
      if (nextSet.has(playlistId)) nextSet.delete(playlistId);
      else nextSet.add(playlistId);
      return nextSet;
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
      Toast.show({ type: 'error', text1: 'Could not create playlist' });
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
      Toast.show({ type: 'error', text1: 'Could not save changes' });
    } finally {
      setIsSaving(false);
    }
  };

  const playlists = playlistsQuery.data ?? [];
  const isLoading = !initialised;

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Save to</Text>
          <Pressable onPress={() => setIsCreating((v) => !v)} style={styles.newButton} hitSlop={8}>
            <Ionicons name="add" size={18} color={Colors.onBackground} />
            <Text style={styles.newButtonText}>New playlist</Text>
          </Pressable>
        </View>

        {isCreating && (
          <View style={styles.createRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Playlist name"
              placeholderTextColor={Colors.textMuted}
              style={styles.createInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleCreate()}
            />
            <Pressable onPress={() => void handleCreate()} style={styles.createConfirm}>
              <Text style={styles.createConfirmText}>Create</Text>
            </Pressable>
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={Colors.primary} style={styles.loader} />
        ) : (
          <ScrollView style={{ maxHeight: height * 0.5 }} showsVerticalScrollIndicator={false}>
            <SaveRow
              title="Liked Songs"
              subtitle="Your favourites"
              checked={likedSelected}
              onPress={() => {
                tapHaptic();
                setLikedSelected((v) => !v);
              }}
              cover={<PlaylistCover variant="liked" size={48} />}
            />
            {playlists.map((playlist) => (
              <SaveRow
                key={playlist.id}
                title={playlist.name}
                subtitle={`${playlist.song_count ?? 0} songs`}
                checked={selected.has(playlist.id)}
                onPress={() => toggle(playlist.id)}
                cover={<PlaylistCover thumbnails={playlist.cover_thumbnails} size={48} />}
              />
            ))}
            {playlists.length === 0 && (
              <Text style={styles.emptyText}>No playlists yet — create one above.</Text>
            )}
          </ScrollView>
        )}

        <Pressable
          onPress={() => void handleDone()}
          disabled={isSaving || isLoading}
          style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
        >
          {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.doneText}>Done</Text>}
        </Pressable>
      </View>
    </AnimatedBottomSheet>
  );
}

function SaveRow({
  title,
  subtitle,
  checked,
  onPress,
  cover,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onPress: () => void;
  cover: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {cover}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={checked ? Colors.primary : 'rgba(255,255,255,0.45)'}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: Colors.onBackground,
    fontSize: TypeScale.title,
    fontWeight: '700',
  },
  newButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newButtonText: {
    color: Colors.onBackground,
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  createRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  createInput: {
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 8,
    color: Colors.onBackground,
    flex: 1,
    fontSize: TypeScale.body,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  createConfirm: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  createConfirmText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  loader: {
    marginVertical: 32,
  },
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: Colors.onBackground,
    fontSize: TypeScale.body,
  },
  rowSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  emptyText: {
    color: Colors.textMuted,
    paddingVertical: 16,
    textAlign: 'center',
  },
  doneButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    marginTop: 16,
    minWidth: 140,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  doneText: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
});
