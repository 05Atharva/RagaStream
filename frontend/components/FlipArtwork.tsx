import { useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { activeLineIndex, type Lyrics } from '../hooks/useLyrics';
import { usePlayerStore } from '../store/playerStore';
import { Elevation, Motion, Radius, Space } from '../constants/theme';
import Rise from '../motion/Rise';
import Text from './ui/Text';

const FLIP_MS = 560;
/** The top-right square of the back face that opens full-screen lyrics (hit-tested by the deck). */
export const EXPAND_HIT = 72;

type FlipArtworkProps = {
  thumbnail?: string;
  size: number;
  flipped: boolean;
  lyrics: Lyrics | null | undefined;
  lyricsLoading: boolean;
  lyricsError: boolean;
  /** Back face fill and the inks that read on it (artwork-derived). */
  background: string;
  ink: string;
  dim: string;
};

/** The sung line, big, with one line of context above and two below. */
function SyncedLines({ lyrics, ink, dim }: { lyrics: Lyrics; ink: string; dim: string }) {
  const position = usePlayerStore((s) => s.currentPosition);
  const active = activeLineIndex(lyrics.lines, position);
  const prev = active > 0 ? lyrics.lines[active - 1]?.text : '';
  const current = active >= 0 ? lyrics.lines[active]?.text || '♪' : '♪';
  const next = lyrics.lines.slice(active + 1, active + 3).map((l) => l.text || '♪');

  return (
    // Keyed by line: each new line rises in (the Rise vocabulary), so the
    // lyric reads as arriving on the beat rather than swapping.
    <Rise key={active} style={{ gap: Space[3] }}>
      {prev ? <Text variant="body" color={dim} numberOfLines={2}>{prev}</Text> : null}
      <Text variant="headline" color={ink} numberOfLines={4}>{current}</Text>
      {next.map((line, i) => (
        <Text key={i} variant="body" color={dim} numberOfLines={2}>{line}</Text>
      ))}
    </Rise>
  );
}

/**
 * Album art that turns over to reveal the lyrics. A real 3D turn (rotateY
 * with perspective) on the glide curve, dipping to 95% at the halfway point
 * so the card feels like it has weight (solid drawing + arcs). Each face hides
 * past 90° so it works whether or not the platform honours backface culling.
 */
export default function FlipArtwork({
  thumbnail,
  size,
  flipped,
  lyrics,
  lyricsLoading,
  lyricsError,
  background,
  ink,
  dim,
}: FlipArtworkProps) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(flipped ? 180 : 0);
  const lift = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      turn.value = withTiming(flipped ? 180 : 0, { duration: Motion.duration.quick });
      return;
    }
    turn.value = withTiming(flipped ? 180 : 0, { duration: FLIP_MS, easing: Motion.easing.glide });
    lift.value = withSequence(
      withTiming(0.95, { duration: FLIP_MS / 2, easing: Motion.easing.in }),
      withTiming(1, { duration: FLIP_MS / 2, easing: Motion.easing.out })
    );
  }, [flipped, lift, reduced, turn]);

  const frontStyle = useAnimatedStyle(() => ({
    opacity: reduced ? interpolate(turn.value, [0, 180], [1, 0]) : turn.value < 90 ? 1 : 0,
    transform: reduced ? [] : [{ perspective: 1200 }, { rotateY: `${turn.value}deg` }, { scale: lift.value }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: reduced ? interpolate(turn.value, [0, 180], [0, 1]) : turn.value >= 90 ? 1 : 0,
    transform: reduced ? [] : [{ perspective: 1200 }, { rotateY: `${turn.value - 180}deg` }, { scale: lift.value }],
  }));

  const plainLines = useMemo(() => (lyrics && !lyrics.synced ? (lyrics.plain ?? '').split('\n') : []), [lyrics]);
  const face = { width: size, height: size, borderRadius: Radius.lg, backfaceVisibility: 'hidden' as const };

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[face, Elevation.art, { position: 'absolute' }, frontStyle]}>
        <Image
          source={thumbnail ? { uri: thumbnail } : undefined}
          style={{ width: size, height: size, borderRadius: Radius.lg }}
          contentFit="cover"
          transition={Motion.duration.glide}
        />
        {lyrics && !lyricsLoading ? (
          <View pointerEvents="none" style={hintStyle}>
            <Ionicons name="text" size={12} color="#FFFFFF" />
            <Text variant="label" color="#FFFFFF">Tap for lyrics</Text>
          </View>
        ) : null}
      </Animated.View>

      <Animated.View
        pointerEvents={flipped ? 'auto' : 'none'}
        style={[face, Elevation.art, { position: 'absolute', backgroundColor: background, padding: Space[5] }, backStyle]}
      >
        <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: Space[3] }}>
          <Text variant="label" color={dim}>Lyrics</Text>
          {lyrics ? (
            <View pointerEvents="none" style={{ alignItems: 'center', borderColor: dim, borderRadius: Radius.pill, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 }}>
              <Ionicons name="expand" size={16} color={ink} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {lyricsLoading ? (
            <ActivityIndicator color={ink} />
          ) : !lyrics ? (
            <Text variant="title" color={ink} align="center">
              {lyricsError ? "Lyrics couldn't load right now." : "No lyrics for this one yet."}
            </Text>
          ) : lyrics.synced ? (
            <SyncedLines lyrics={lyrics} ink={ink} dim={dim} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text variant="title" color={ink}>{plainLines.join('\n')}</Text>
            </ScrollView>
          )}
        </View>
        <Text variant="caption" color={dim} align="center" style={{ marginTop: Space[3] }}>Tap to turn back</Text>
      </Animated.View>
    </View>
  );
}

// Sits on the artwork, so white on an ink scrim (allowed on artwork surfaces).
const hintStyle = {
  alignItems: 'center' as const,
  backgroundColor: 'rgba(11,15,26,0.55)',
  borderRadius: Radius.pill,
  bottom: Space[3],
  flexDirection: 'row' as const,
  gap: Space[1],
  left: Space[3],
  paddingHorizontal: Space[3],
  paddingVertical: Space[1] + 2,
  position: 'absolute' as const,
};
