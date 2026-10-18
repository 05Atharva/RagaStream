import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import LikeButton from './LikeButton';
import { Colors, TypeScale } from '../constants/theme';

export type SongAction = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  destructive?: boolean;
};

type SongOptionsSheetProps = {
  isVisible: boolean;
  onClose: () => void;
  thumbnail?: string | null;
  title: string;
  channel: string;
  isLiked: boolean;
  onToggleLike: () => void;
  actions: SongAction[];
};

export default function SongOptionsSheet({
  isVisible,
  onClose,
  thumbnail,
  title,
  channel,
  isLiked,
  onToggleLike,
  actions,
}: SongOptionsSheetProps) {
  const { height } = useWindowDimensions();

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={styles.container}>
        {/* Song context row */}
        <View style={styles.songInfo}>
          <View style={styles.thumbWrap}>
            {thumbnail ? (
              <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            ) : (
              <Ionicons name="musical-notes" size={22} color="rgba(255,255,255,0.3)" />
            )}
          </View>
          <View style={styles.songMeta}>
            <Text numberOfLines={1} style={styles.songTitle}>{title}</Text>
            <Text numberOfLines={1} style={styles.songChannel}>{channel}</Text>
          </View>
        </View>

        <View style={styles.separator} />

        <ScrollView style={{ maxHeight: height * 0.6 }} bounces={false} showsVerticalScrollIndicator={false}>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            onPress={onToggleLike}
          >
            <View style={styles.likeButtonWrap}>
              <LikeButton isLiked={isLiked} onToggle={onToggleLike} size={22} />
            </View>
            <Text style={styles.actionText}>{isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}</Text>
          </Pressable>

          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={action.onPress}
            >
              <Ionicons
                name={action.icon}
                size={22}
                color={action.destructive ? Colors.error : 'rgba(255,255,255,0.85)'}
              />
              <Text style={[styles.actionText, action.destructive && styles.actionTextDestructive]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </AnimatedBottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 16,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  songInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  thumbWrap: {
    alignItems: 'center',
    backgroundColor: '#262828',
    borderRadius: 8,
    flexShrink: 0,
    height: 52,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 52,
  },
  songMeta: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: Colors.onBackground,
    fontSize: TypeScale.body,
    fontWeight: '600',
  },
  songChannel: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  separator: {
    backgroundColor: Colors.border,
    height: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  action: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 4,
    paddingVertical: 13,
  },
  actionPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  likeButtonWrap: {
    marginHorizontal: -9,
  },
  actionText: {
    color: Colors.onBackground,
    fontSize: TypeScale.body,
  },
  actionTextDestructive: {
    color: Colors.error,
  },
});
