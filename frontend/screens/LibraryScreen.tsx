import React, { useMemo, useRef, useState } from 'react';
import {
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
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
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
  const sheetRef = useRef<BottomSheetModal>(null);

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
  const snapPoints = useMemo(() => ['35%'], []);

  const openCreateSheet = () => {
    sheetRef.current?.present();
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
      sheetRef.current?.dismiss();
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      Toast.show({ type: 'success', text1: 'Playlist created' });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not create playlist' });
    }
  };

  const handleOpenPlaylist = (playlistId: string) => {
    rootNavigation?.navigate('Playlist', { playlistId });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Library</Text>
        <Pressable onPress={() => rootNavigation?.navigate('Settings')} style={styles.iconButton}>
          <Ionicons name="settings-outline" size={22} color={Colors.onBackground} />
        </Pressable>
      </View>

      <Pressable onPress={() => rootNavigation?.navigate('LikedSongs')} style={styles.likedCard}>
        <LinearGradient
          colors={['#7C3AED', '#4C1D95']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.likedGradient}
        >
          <Ionicons name="heart" size={28} color={Colors.onBackground} />
          <View style={styles.likedCopy}>
            <Text style={styles.likedTitle}>Liked Songs</Text>
            <Text style={styles.likedSubtitle}>{likedCount} songs</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.onBackground} />
        </LinearGradient>
      </Pressable>

      <View style={styles.playlistsHeader}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <Pressable onPress={openCreateSheet} style={styles.iconButton}>
          <Ionicons name="add" size={22} color={Colors.onBackground} />
        </Pressable>
      </View>

      <FlashList
        data={playlists}
        keyExtractor={(item) => item.id}
        estimatedItemSize={90}
        contentContainerStyle={styles.playlistsList}
        renderItem={({ item }) => {
          const firstThumb = item.songs?.[0]?.thumbnail_url;
          const count = item.songs?.length ?? 0;
          return (
            <Pressable onPress={() => handleOpenPlaylist(item.id)} style={styles.playlistRow}>
              <Image source={firstThumb ? { uri: firstThumb } : undefined} style={styles.playlistThumb} />
              <View style={styles.playlistMeta}>
                <Text numberOfLines={1} style={styles.playlistTitle}>
                  {item.name}
                </Text>
                <Text style={styles.playlistSubtitle}>{count} songs</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
            </Pressable>
          );
        }}
      />

      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.sheetContainer}>
          <Text style={styles.sheetTitle}>New Playlist</Text>
          <TextInput
            value={playlistName}
            onChangeText={setPlaylistName}
            placeholder="Playlist name"
            placeholderTextColor={Colors.muted}
            style={styles.sheetInput}
          />
          <Pressable onPress={() => void handleCreatePlaylist()} style={styles.sheetButton}>
            <Text style={styles.sheetButtonText}>Create</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    marginTop: Spacing.sm,
  },
  title: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
  },
  iconButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  likedCard: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  likedGradient: {
    alignItems: 'center',
    flexDirection: 'row',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  likedCopy: {
    flex: 1,
  },
  likedTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
  },
  likedSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: Typography.fontSizeSm,
    marginTop: 4,
  },
  playlistsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
  },
  playlistsList: {
    paddingBottom: 120,
  },
  playlistRow: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  playlistThumb: {
    borderRadius: BorderRadius.sm,
    height: 52,
    width: 52,
    backgroundColor: Colors.border,
  },
  playlistMeta: {
    flex: 1,
    marginHorizontal: Spacing.sm,
  },
  playlistTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  playlistSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 4,
  },
  sheetBackground: {
    backgroundColor: Colors.surface,
  },
  sheetHandle: {
    backgroundColor: Colors.muted,
  },
  sheetContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  sheetTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    marginBottom: Spacing.md,
  },
  sheetInput: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  sheetButton: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.lg,
    paddingVertical: 12,
  },
  sheetButtonText: {
    color: Colors.onPrimary,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
  },
});
