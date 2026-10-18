import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type PlaylistCoverProps = {
  thumbnails?: (string | null | undefined)[];
  size: number;
  borderRadius?: number;
  /** Liked Songs uses a gradient tile with a heart instead of artwork. */
  variant?: 'playlist' | 'liked';
  style?: StyleProp<ViewStyle>;
};

/**
 * Spotify-style playlist art: a 2×2 mosaic once there are 4 songs, the first
 * thumbnail with 1–3 songs, and a music-note placeholder when empty.
 */
export default function PlaylistCover({
  thumbnails = [],
  size,
  borderRadius = 8,
  variant = 'playlist',
  style,
}: PlaylistCoverProps) {
  const frame = [{ width: size, height: size, borderRadius }, styles.frame, style];

  if (variant === 'liked') {
    return (
      <LinearGradient colors={['#4C1D95', '#7C3AED', '#A78BFA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={frame}>
        <Ionicons name="heart" size={size * 0.42} color="#FFFFFF" />
      </LinearGradient>
    );
  }

  const images = thumbnails.filter((t): t is string => Boolean(t));

  if (images.length === 0) {
    return (
      <View style={[frame, styles.placeholder]}>
        <Ionicons name="musical-notes" size={size * 0.38} color="rgba(255,255,255,0.35)" />
      </View>
    );
  }

  if (images.length < 4) {
    return (
      <View style={frame}>
        <Image source={{ uri: images[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      </View>
    );
  }

  const half = size / 2;
  return (
    <View style={[frame, styles.grid]}>
      {images.slice(0, 4).map((uri, index) => (
        <Image key={`${uri}-${index}`} source={{ uri }} style={{ width: half, height: half }} contentFit="cover" />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    backgroundColor: '#262828',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
