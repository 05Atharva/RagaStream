import { useCallback } from 'react';
import { Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Layout, Radius, Space, Type } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';
import { usePressMotion } from '../motion/primitives';
import PlayPauseIcon from '../motion/PlayPauseIcon';
import { tapHaptic } from '../services/haptics';
import IconButton from './ui/IconButton';

export const TOP_BAR_CONTENT_HEIGHT = 56;
const PLAY_SIZE = 56;

/** Scroll position as a shared value plus handlers for any list. */
export function useCollapsingHeader() {
  const scrollY = useSharedValue(0);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = event.nativeEvent.contentOffset.y;
    },
    [scrollY]
  );
  const onScrollOffset = useCallback(
    (offset: number) => {
      scrollY.value = offset;
    },
    [scrollY]
  );
  return { scrollY, onScroll, onScrollOffset };
}

type TopBarProps = {
  scrollY: SharedValue<number>;
  title: string;
  /** Solid colour the bar fades to once collapsed. */
  background: string;
  /** Icon/title colour that reads on both the hero and the collapsed bar. */
  ink: string;
  /** Scroll offset at which the hero title has scrolled away. */
  threshold: number;
  onBack: () => void;
};

/**
 * Transparent over the hero; once the big title scrolls away the bar fills
 * with the hero's colour and the title rises into it.
 */
export function CollapsingTopBar({ scrollY, title, background, ink, threshold, onBack }: TopBarProps) {
  const insets = useSafeAreaInsets();

  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [threshold - 80, threshold - 16], [0, 1], Extrapolation.CLAMP),
  }));
  const titleStyle = useAnimatedStyle(() => {
    const p = interpolate(scrollY.value, [threshold - 16, threshold + 16], [0, 1], Extrapolation.CLAMP);
    return { opacity: p, transform: [{ translateY: (1 - p) * 10 }] };
  });

  return (
    <View
      pointerEvents="box-none"
      style={{
        alignItems: 'center',
        flexDirection: 'row',
        height: insets.top + TOP_BAR_CONTENT_HEIGHT,
        left: 0,
        paddingHorizontal: Space[2],
        paddingTop: insets.top,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 10,
      }}
    >
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: background }, barStyle]} />
      <IconButton icon="chevron-back" onPress={onBack} accessibilityLabel="Back" color={ink} iconSize={26} />
      <Animated.Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={[Type.subtitle, { color: ink, flex: 1, marginLeft: Space[1], marginRight: PLAY_SIZE + Space[4] }, titleStyle]}
      >
        {title}
      </Animated.Text>
    </View>
  );
}

type PlayButtonProps = {
  scrollY: SharedValue<number>;
  /** Y of the hero actions row inside the scroll content (from onLayout). */
  anchorY: number;
  isPlaying: boolean;
  onPress: () => void;
  disabled?: boolean;
};

/** The screen's one primary action: rides with the hero, then pins under the bar. */
export function StickyPlayButton({ scrollY, anchorY, isPlaying, onPress, disabled }: PlayButtonProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const press = usePressMotion(0.92);
  const pinnedY = insets.top + TOP_BAR_CONTENT_HEIGHT - PLAY_SIZE / 2;

  const style = useAnimatedStyle(() => ({
    opacity: anchorY > 0 ? 1 : 0,
    transform: [{ translateY: Math.max(anchorY - scrollY.value, pinnedY) }],
  }));

  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', right: Layout.gutter, top: 0, zIndex: 11 }, style]}>
      <Pressable
        disabled={disabled}
        onPress={() => {
          tapHaptic();
          onPress();
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
      >
        <Animated.View
          style={[
            {
              alignItems: 'center',
              backgroundColor: colors.accent,
              borderRadius: Radius.pill,
              height: PLAY_SIZE,
              justifyContent: 'center',
              opacity: disabled ? 0.5 : 1,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
              width: PLAY_SIZE,
              elevation: 8,
            },
            press.style,
          ]}
        >
          <PlayPauseIcon playing={isPlaying} size={26} color={colors.onAccent} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** Reserves the play button's space at the end of the hero's actions row. */
export function PlayButtonSlot() {
  return <View style={{ height: PLAY_SIZE, width: PLAY_SIZE }} />;
}
