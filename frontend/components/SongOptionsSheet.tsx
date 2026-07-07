import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import LikeButton from './LikeButton';

type SongOptionsSheetProps = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  thumbnail?: string;
  title: string;
  channel: string;
  isLiked?: boolean;
  onLike: () => void | Promise<void>;
  onAddToPlaylist: () => void | Promise<void>;
  onAddToQueue?: () => void | Promise<void>;
  onShare: () => void;
  snapPoints?: string[];
};

const DEFAULT_SNAP_POINTS = ['40%', '54%'];

export default function SongOptionsSheet({
  sheetRef,
  thumbnail,
  title,
  channel,
  isLiked = false,
  onLike,
  onAddToPlaylist,
  onAddToQueue,
  onShare,
  snapPoints = DEFAULT_SNAP_POINTS,
}: SongOptionsSheetProps) {
  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      backgroundStyle={styles.bg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.container}>
        {/* Song context row */}
        <View style={styles.songInfo}>
          <View style={styles.thumbWrap}>
            {thumbnail ? (
              <Image
                source={{ uri: thumbnail }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
              />
            ) : (
              <Ionicons name="musical-notes" size={24} color="rgba(255,255,255,0.3)" />
            )}
          </View>
          <View style={styles.songMeta}>
            <Text numberOfLines={1} style={styles.songTitle}>{title}</Text>
            <Text numberOfLines={1} style={styles.songChannel}>{channel}</Text>
          </View>
        </View>

        <View style={styles.separator} />

        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={() => void onLike()}
        >
          <View style={styles.likeButtonWrap}>
            <LikeButton isLiked={isLiked} onToggle={() => void onLike()} size={24} />
          </View>
          <Text style={styles.actionText}>{isLiked ? 'Liked' : 'Like'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={() => void onAddToPlaylist()}
        >
          <Ionicons name="musical-notes-outline" size={24} color="rgba(255,255,255,0.85)" />
          <Text style={styles.actionText}>Add to Playlist</Text>
        </Pressable>

        {onAddToQueue && (
          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            onPress={() => void onAddToQueue()}
          >
            <Ionicons name="add-outline" size={24} color="rgba(255,255,255,0.85)" />
            <Text style={styles.actionText}>Add to Queue</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={onShare}
        >
          <Ionicons name="share-social-outline" size={24} color="rgba(255,255,255,0.85)" />
          <Text style={styles.actionText}>Share YouTube link</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  bg: {
    backgroundColor: '#1a1c1c',
  },
  handle: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  container: {
    flex: 1,
    paddingBottom: 20,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  songInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  thumbWrap: {
    alignItems: 'center',
    backgroundColor: '#333535',
    borderRadius: 10,
    flexShrink: 0,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 64,
  },
  songMeta: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: '#e2e2e2',
    fontSize: 18,
    fontWeight: '600',
  },
  songChannel: {
    color: 'rgba(204,195,216,0.85)',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },
  separator: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    height: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  action: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  actionPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  likeButtonWrap: {
    marginHorizontal: -8,
  },
  actionText: {
    color: '#e2e2e2',
    fontSize: 16,
    fontWeight: '500',
  },
});
