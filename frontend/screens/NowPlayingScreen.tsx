import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import { usePlayerStore } from '../store/playerStore';

type NowPlayingScreenProps = {
  onClose: () => void;
};

export default function NowPlayingScreen({ onClose }: NowPlayingScreenProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);

  if (!currentTrack) {
    return null;
  }

  const thumbnailSource = currentTrack.thumbnailUrl || currentTrack.artwork;
  const channelName = currentTrack.channelName || currentTrack.artist;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={onClose} style={styles.closeButton}>
          <Ionicons name="chevron-down" size={24} color={Colors.onBackground} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <Image
          source={thumbnailSource ? { uri: thumbnailSource } : undefined}
          style={styles.artwork}
          contentFit="cover"
        />
        <Text numberOfLines={2} style={styles.title}>
          {currentTrack.title}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {channelName}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  closeButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  artwork: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    height: 280,
    marginBottom: Spacing.xl,
    width: 280,
  },
  title: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
});
