import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Brand, Radius } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';

type PlaylistCoverProps = {
  thumbnails?: (string | null | undefined)[];
  size: number;
  borderRadius?: number;
  /** Liked Songs is a Kesar → Neel glide with a heart instead of artwork. */
  variant?: 'playlist' | 'liked';
  style?: StyleProp<ViewStyle>;
};

/**
 * Playlist art: a 2×2 mosaic once there are 4 songs (the moment a playlist
 * "becomes" something — US-10), the first thumbnail with 1–3 songs, and a
 * quiet placeholder when empty.
 */
export default function PlaylistCover({
  thumbnails = [],
  size,
  borderRadius = Radius.md,
  variant = 'playlist',
  style,
}: PlaylistCoverProps) {
  const colors = useColors();
  const frame: StyleProp<ViewStyle> = [
    { width: size, height: size, borderRadius, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    style,
  ];

  if (variant === 'liked') {
    return (
      <LinearGradient colors={[Brand.kesar, '#D9466B', Brand.neelDeep]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={frame}>
        <Ionicons name="heart" size={size * 0.4} color="#FFFFFF" />
      </LinearGradient>
    );
  }

  const images = thumbnails.filter((t): t is string => Boolean(t));

  if (images.length === 0) {
    return (
      <View style={[frame, { backgroundColor: colors.surfaceRaised }]}>
        <Ionicons name="musical-notes" size={size * 0.36} color={colors.textTertiary} />
      </View>
    );
  }

  if (images.length < 4) {
    return (
      <View style={frame}>
        <Image source={{ uri: images[0] }} style={{ width: size, height: size }} contentFit="cover" transition={150} />
      </View>
    );
  }

  const half = size / 2;
  return (
    <View style={[frame, { flexDirection: 'row', flexWrap: 'wrap' }]}>
      {images.slice(0, 4).map((uri, index) => (
        <Image key={`${uri}-${index}`} source={{ uri }} style={{ width: half, height: half }} contentFit="cover" transition={150} />
      ))}
    </View>
  );
}
