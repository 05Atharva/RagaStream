import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import AnimatedBottomSheet from '../components/AnimatedBottomSheet';
import Animated, { Keyframe, SlideInLeft } from 'react-native-reanimated';

const likedCardIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.95 }, { translateY: -10 }] },
  100: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] },
});
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { useBottomPadding } from '../hooks/useBottomPadding';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Props = BottomTabScreenProps<BottomTabParamList, 'Library'>;

type PlaylistRecord = {
  id: string;
  name: string;
  songs?: Array<{
    id: string;
    title: string;
    channel_name?: string | null;
    thumbnail_url?: string | null;
    duration_sec?: number | null;
  }>;
};

export default function LibraryScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const rootNavigation = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const [playlistName, setPlaylistName] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [isCreateSheetVisible, setIsCreateSheetVisible] = useState(false);

  const likedQuery = useQuery({
    queryKey: ['liked'],
    queryFn: async () => {
      const { data } = await apiClient.get<Array<{ id: string }>>('/liked');
      return data;
    },
  });

  const playlistsQuery = useQuery({
    queryKey: ['playlists'],
    queryFn: async () => {
      const { data } = await apiClient.get<Array<{ id: string; name: string }>>('/playlists');
      const detailed = await Promise.all(
        data.map(async (playlist) => {
          const detail = await apiClient.get<PlaylistRecord>(`/playlists/${playlist.id}`);
          return detail.data;
        })
      );
      return detailed;
    },
  });

  const likedCount = likedQuery.data?.length ?? 0;
  const playlists = playlistsQuery.data ?? [];
  const bottomPadding = useBottomPadding();

  const hasAnimated = useRef(false);
  useEffect(() => { hasAnimated.current = true; }, []);
  const entering = !hasAnimated.current;

  const openCreateSheet = () => {
    setIsCreateSheetVisible(true);
  };

  const handleCreatePlaylist = async () => {
    const name = playlistName.trim();
    if (!name) {
      Toast.show({ type: 'error', text1: 'Enter a playlist name' });
      return;
    }
    try {
      await apiClient.post('/playlists', { name, description: '' });
      setPlaylistName('');
      setIsCreateSheetVisible(false);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      Toast.show({ type: 'success', text1: 'Playlist created' });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not create playlist' });
    }
  };

  const handleOpenPlaylist = (playlistId: string) => {
    rootNavigation?.navigate('Playlist', { playlistId });
  };

  const handleDeletePlaylist = (playlist: PlaylistRecord) => {
    Alert.alert(
      'Delete Playlist',
      `Are you sure you want to delete "${playlist.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/playlists/${playlist.id}`);
              await queryClient.invalidateQueries({ queryKey: ['playlists'] });
              Toast.show({ type: 'success', text1: 'Playlist deleted' });
            } catch {
              Toast.show({ type: 'error', text1: 'Could not delete playlist' });
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Your Library</Text>
        <Pressable
          onPress={() => rootNavigation?.navigate('Settings')}
          style={styles.iconCircleBtn}
          hitSlop={8}
        >
          <Ionicons name="settings-outline" size={20} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </View>

      {/* ── Liked Songs hero card ── */}
      <Animated.View entering={entering ? likedCardIn.duration(400) : undefined}>
      <Pressable
        onPress={() => rootNavigation?.navigate('LikedSongs')}
        style={({ pressed }) => [styles.likedCard, pressed && styles.cardPressed]}
      >
        <LinearGradient
          colors={['#7C3AED', '#4C1D95']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.likedGradient}
        >
          {/* Decorative ambient blobs */}
          <View style={styles.likedBlobTop} />
          <View style={styles.likedBlobBottom} />
          {/* Decorative background heart */}
          <Ionicons
            name="heart"
            size={68}
            color="rgba(255,255,255,0.15)"
            style={styles.likedBgHeart}
          />
          {/* Text at bottom-left */}
          <View style={styles.likedTextBlock}>
            <Text style={styles.likedTitle}>Liked Songs</Text>
            <Text style={styles.likedSubtitle}>{likedCount} songs</Text>
          </View>
        </LinearGradient>
      </Pressable>
      </Animated.View>

      {/* ── Playlists section ── */}
      <Animated.View entering={entering ? SlideInLeft.delay(150).duration(300) : undefined} style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <Pressable onPress={openCreateSheet} style={styles.newPlaylistBtn} hitSlop={8}>
          <Ionicons name="add" size={16} color="#7C3AED" />
          <Text style={styles.newPlaylistText}>New</Text>
        </Pressable>
      </Animated.View>

      <FlashList
        data={playlists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPadding }]}
        renderItem={({ item }) => {
          const firstThumb = item.songs?.[0]?.thumbnail_url;
          const count = item.songs?.length ?? 0;
          return (
            <Swipeable
              renderRightActions={() => (
                <Pressable
                  onPress={() => handleDeletePlaylist(item)}
                  style={styles.deleteAction}
                >
                  <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
                </Pressable>
              )}
            >
              <Pressable
                onPress={() => handleOpenPlaylist(item.id)}
                style={({ pressed }) => [styles.playlistRow, pressed && styles.cardPressed]}
              >
                <View style={styles.playlistThumbWrap}>
                  <Image
                    source={firstThumb ? { uri: firstThumb } : undefined}
                    style={styles.playlistThumb}
                    contentFit="cover"
                  />
                  {!firstThumb && (
                    <Ionicons
                      name="musical-notes"
                      size={24}
                      color="rgba(255,255,255,0.35)"
                      style={StyleSheet.absoluteFillObject}
                    />
                  )}
                </View>
                <View style={styles.playlistMeta}>
                  <Text numberOfLines={1} style={styles.playlistTitle}>
                    {item.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.playlistSubtitle}>
                    Playlist · {count} songs
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
              </Pressable>
            </Swipeable>
          );
        }}
      />

      {/* ── Create playlist bottom sheet ── */}
      <AnimatedBottomSheet
        isVisible={isCreateSheetVisible}
        onClose={() => setIsCreateSheetVisible(false)}
        backgroundColor="#1E2020"
      >
        <View style={styles.sheetContainer}>
          {/* Sheet header: close button + title */}
          <View style={styles.sheetHeaderRow}>
            <Pressable
              onPress={() => setIsCreateSheetVisible(false)}
              hitSlop={8}
              style={styles.sheetCloseBtn}
            >
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
            </Pressable>
            <Text style={styles.sheetTitle}>New Playlist</Text>
            {/* spacer keeps title centered */}
            <View style={styles.sheetTitleSpacer} />
          </View>

          {/* Cover art placeholder — decorative */}
          <View style={styles.coverArtWrap}>
            <View style={styles.coverArtBox}>
              <Ionicons name="musical-notes" size={44} color="rgba(255,255,255,0.3)" />
              <Text style={styles.coverArtLabel}>Add Cover Art</Text>
            </View>
          </View>

          {/* Playlist name input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Playlist name</Text>
            <TextInput
              value={playlistName}
              onChangeText={setPlaylistName}
              placeholder="My playlist"
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={[styles.sheetInput, inputFocused && styles.sheetInputFocused]}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              returnKeyType="done"
              onSubmitEditing={() => void handleCreatePlaylist()}
            />
          </View>

          {/* Create CTA */}
          <Pressable
            onPress={() => void handleCreatePlaylist()}
            style={[
              styles.createBtn,
              playlistName.trim().length === 0 && styles.createBtnDisabled,
            ]}
            disabled={playlistName.trim().length === 0}
          >
            <Text
              style={[
                styles.createBtnText,
                playlistName.trim().length === 0 && styles.createBtnTextDisabled,
              ]}
            >
              Create
            </Text>
          </Pressable>
        </View>
      </AnimatedBottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
    paddingHorizontal: 20,
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    marginTop: 8,
  },
  screenTitle: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
  },
  iconCircleBtn: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },

  // ── Liked Songs hero card ──
  likedCard: {
    borderRadius: 12,
    marginBottom: 24,
    overflow: 'hidden',
  },
  likedGradient: {
    justifyContent: 'flex-end',
    minHeight: 140,
    padding: 20,
  },
  likedBlobTop: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    height: 128,
    position: 'absolute',
    right: -20,
    top: -32,
    width: 128,
  },
  likedBlobBottom: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 999,
    bottom: -28,
    height: 96,
    left: -16,
    position: 'absolute',
    width: 96,
  },
  likedBgHeart: {
    position: 'absolute',
    right: 16,
    top: 16,
  },
  likedTextBlock: {
    // column, at the bottom of the gradient via justifyContent: flex-end on parent
  },
  likedTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  likedSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Playlists section header ──
  sectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#e2e2e2',
    fontSize: 18,
    fontWeight: '600',
  },
  newPlaylistBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  newPlaylistText: {
    color: '#7C3AED',
    fontSize: 14,
    fontWeight: '500',
  },

  // ── Playlist rows (flat #121414) ──
  listContent: {
    // paddingBottom injected dynamically
  },
  playlistRow: {
    alignItems: 'center',
    backgroundColor: '#121414',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
    padding: 12,
  },
  playlistThumbWrap: {
    alignItems: 'center',
    backgroundColor: '#333535',
    borderRadius: 8,
    flexShrink: 0,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 56,
  },
  playlistThumb: {
    ...StyleSheet.absoluteFillObject,
  },
  playlistMeta: {
    flex: 1,
    minWidth: 0,
  },
  playlistTitle: {
    color: '#e2e2e2',
    fontSize: 16,
    fontWeight: '600',
  },
  playlistSubtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 3,
  },
  deleteAction: {
    alignItems: 'center',
    backgroundColor: '#C62828',
    borderRadius: 16,
    justifyContent: 'center',
    marginBottom: 8,
    paddingHorizontal: 24,
  },

  // ── Create playlist sheet ──
  sheetContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  sheetHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 24,
  },
  sheetCloseBtn: {
    alignItems: 'flex-start',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  sheetTitle: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  sheetTitleSpacer: { width: 36 },
  coverArtWrap: {
    alignItems: 'center',
    marginBottom: 28,
  },
  coverArtBox: {
    alignItems: 'center',
    backgroundColor: '#333535',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 8,
    height: 152,
    justifyContent: 'center',
    width: 152,
  },
  coverArtLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sheetInput: {
    backgroundColor: '#1a1c1c',
    borderBottomColor: '#333535',
    borderBottomWidth: 2,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    color: '#FFFFFF',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sheetInputFocused: {
    borderBottomColor: '#7C3AED',
    backgroundColor: '#282a2b',
  },
  createBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    paddingVertical: 16,
  },
  createBtnDisabled: {
    backgroundColor: '#333535',
  },
  createBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  createBtnTextDisabled: {
    color: 'rgba(255,255,255,0.35)',
  },

  // ── Shared ──
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
